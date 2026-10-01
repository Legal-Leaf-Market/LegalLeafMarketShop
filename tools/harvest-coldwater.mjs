/* tools/harvest-coldwater.mjs — the scheduled headless lane.
 *
 * Drives a real Chromium at each shop's own menu page, injects the SAME
 * collector the operator's bookmarklet uses (public/coldwater-collector.js),
 * lets its autoScan settle, and posts the rows to /api/coldwater/ingest with
 * lane:"headless".
 *
 *   node tools/harvest-coldwater.mjs --site https://legal-leafmarket.com \
 *        --token "$LL_ADMIN_TOKEN" [--only lume,dude] [--concurrency 3] [--dry]
 *
 * ---------------------------------------------------------------------------
 * WHAT THIS IS AND IS NOT.
 *
 * It is a browser reading pages that are served to browsers. It is the same
 * reader, on the same markup, as the human path -- the only difference is who
 * pressed go.
 *
 * It is NOT a way past the walls. Dutchie and Jane answer automated clients with
 * a bot challenge, and plain headless Chromium is precisely what that challenge
 * is built to catch. Nothing here spoofs a fingerprint, rotates an address, or
 * solves anything: a challenged store is REPORTED as challenged and left to the
 * operator's own browser, which is the only lane that reaches it. That is the
 * standing rule in CLAUDE.md and it is not a dial.
 *
 * ZERO DEPENDENCIES, because the deployed site has none and this repo's suites
 * already drive Chromium over raw CDP with spawn(). No Playwright import, no
 * package.json change, nothing to install in CI beyond a Chromium binary.
 *
 * THE COURTESIES ARE NOT OPTIONAL AND SCALE MAKES THEM MORE IMPORTANT, NOT
 * LESS. api/coldwater.js states them: one pass per store per run, sequential
 * with spacing, a descriptive User-Agent carrying a contact URL so anyone who
 * wants us to stop can find us without guessing, and a per-store kill switch.
 * This honours all four. At 836 stores they are the difference between a
 * survivable read and a week from an IP ban.
 * ---------------------------------------------------------------------------
 */
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
/* The publish guards live in their own module so a suite can check them with no
   browser and no network -- this file starts a browser at import time. They are
   the only decisions in this lane that decide what reaches the shelf. */
import { guards, policyFor, nameSet } from "./harvest-guards.mjs";

import { CHROME, CANDIDATES } from "./chrome-path.mjs";
const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..");

/* Same UA the server path uses, with the lane named. A shop reading its logs
   should be able to tell what this was and how to make it stop. */
const UA = "LegalLeafMarket/1.0 (+https://legal-leafmarket.com/coldwater; price comparison; scheduled reader; contact via site)";

/* WHERE THE BROWSER IS, ASKED IN ONE PLACE. This used to be its own candidate
   list with a PINNED Playwright build in it (chromium-1194), duplicated across
   nine suites -- so the day that number changes, whichever copies were not
   updated stop finding a browser, and a suite that cannot start one fails in a
   way that reads like the page being at fault. chrome-path.mjs reads the
   directory instead of guessing a version. */

/* ------------------------------------------------------------------ args --- */
function args(argv) {
  /* market DEFAULTS TO THE PILOT so every existing invocation keeps meaning what
     it meant -- the nightly cron, the workflow, and anything anybody has in a
     shell history. It is the only value that was ever harvested. */
  const o = { concurrency: 2, spacingMs: 1500, settleMs: 45000, pagedMs: 300000, only: "", market: "coldwater", dry: false, force: false };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    const next = () => argv[++i];
    if (a === "--site") o.site = next();
    else if (a === "--market") o.market = String(next() || "").toLowerCase() || "coldwater";
    /* CLEARING A STORE IS AN OPERATOR ACTION AND IT NEEDED A ROUTE. The collect
       page has a per-store Clear button, which is the right control for a
       person standing in front of it -- but a capture published by the
       SCHEDULED lane is noticed in a log, by whoever reads the run, and telling
       them to go and press a button in a browser is how a bad row stays on the
       shelf overnight. The endpoint has always taken {reset:true}; this is the
       same call with the token the workflow already holds. */
    else if (a === "--clear") o.clear = String(next() || "").split(",").map(x => x.trim()).filter(Boolean);
    else if (a === "--token") o.token = next();
    else if (a === "--only") o.only = next();
    else if (a === "--concurrency") o.concurrency = Math.max(1, Math.min(8, Number(next()) || 2));
    else if (a === "--spacing") o.spacingMs = Number(next()) || 1500;
    else if (a === "--settle") o.settleMs = Number(next()) || 45000;
    /* A PAGED MENU IS N SCANS, NOT ONE. Sapura is seven pages at ~25s each, so
       the single-page cap would guillotine it two pages in -- and a truncated
       scan does not fail loudly, it publishes. */
    else if (a === "--paged-settle") o.pagedMs = Number(next()) || 300000;
    else if (a === "--stores") o.storesFile = next();
    else if (a === "--dry") o.dry = true;
    /* PUBLISH PAST A FAILED GUARD. Deliberately awkward to type and reported
       loudly, because it disables every guard at once. */
    else if (a === "--force") o.force = true;
    else if (a === "--help" || a === "-h") o.help = true;
  }
  return o;
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

/* ------------------------------------------------------------------- cdp --- */
/* One browser, N tabs. Spawning a browser per store is the obvious shape and it
   is wrong: startup dominates the run and the memory ceiling arrives long
   before the concurrency ceiling does. */
async function launch(port) {
  const bin = CHROME;
  if (!bin) {
    throw new Error("No Chromium found. Set CHROME_PATH, or install one. Tried:\n  "
                  + CANDIDATES.join("\n  "));
  }
  const proc = spawn(bin, [
    `--remote-debugging-port=${port}`,
    "--headless=new", "--no-sandbox", "--disable-gpu", "--disable-dev-shm-usage",
    "--user-data-dir=/tmp/_ll_harvest",
    /* No stealth flags, deliberately. See the header: a challenged store is a
       reported store, not a puzzle. */
    `--user-agent=${UA}`,
    "about:blank",
  ], { stdio: "ignore" });

  for (let i = 0; i < 100; i++) {
    try {
      const r = await fetch(`http://127.0.0.1:${port}/json/version`);
      if (r.ok) return { proc, bin };
    } catch (e) { /* not up yet */ }
    await sleep(150);
  }
  try { proc.kill(); } catch (e) {}
  throw new Error("Chromium did not open a debugging port in 15s");
}

/* A CDP session over one target. Minimal on purpose: navigate, evaluate, close. */
async function openTab(port) {
  const r = await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: "PUT" });
  const target = await r.json();
  const ws = new globalThis.WebSocket(target.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = () => rej(new Error("cdp socket failed")); });

  let id = 0;
  const waiting = new Map();
  ws.onmessage = m => {
    let msg; try { msg = JSON.parse(m.data); } catch (e) { return; }
    if (msg.id && waiting.has(msg.id)) { waiting.get(msg.id)(msg); waiting.delete(msg.id); }
  };
  /* THE CDP TIMEOUT IS A PARAMETER, AND HARDCODING IT AT 60s WAS A CEILING ON
     THE WHOLE LANE.
   *
     The row-collection call awaits a promise the collector resolves when its
     scan settles, and that scan is capped at --paged-settle, which defaults to
     300000. So any shop whose menu legitimately took more than a minute to read
     was cut off HERE and reported as "Runtime.evaluate timed out" -- language
     that names the transport and blames the shop, when what actually happened
     is that the harness stopped waiting for its own scan.
   *
     Measured on the first live Detroit run: hod-detroit 84s, pleasantrees 66s,
     utopiagardens 80s, naturesremedy 124s, all filed as errors; the two that
     succeeded took 26s and 18s. And the deeper consequence is that a PAGED scan
     could never have finished at all -- seven pages at ~25s is three minutes
     against a sixty-second ceiling -- so --paged-settle has been inert since it
     was written, which is exactly the truncated-menu-published-as-a-whole-one
     failure its own comment warns about. */
  const send = (method, params, timeoutMs) => new Promise((res, rej) => {
    const n = ++id;
    const timer = setTimeout(() => { waiting.delete(n); rej(new Error(method + " timed out")); },
                             timeoutMs || 60000);
    waiting.set(n, v => { clearTimeout(timer); res(v); });
    ws.send(JSON.stringify({ id: n, method, params: params || {} }));
  });
  const evaluate = async (expr, awaitPromise, timeoutMs) => {
    const r = await send("Runtime.evaluate",
      { expression: expr, returnByValue: true, awaitPromise: !!awaitPromise }, timeoutMs);
    if (r.result && r.result.exceptionDetails) {
      const e = r.result.exceptionDetails;
      throw new Error("page threw: " + ((e.exception && e.exception.description) || e.text || "unknown").slice(0, 300));
    }
    return r.result && r.result.result ? r.result.result.value : undefined;
  };
  const close = async () => {
    try { ws.close(); } catch (e) {}
    try { await fetch(`http://127.0.0.1:${port}/json/close/${target.id}`); } catch (e) {}
  };
  return { send, evaluate, close, targetId: target.id };
}

/* -------------------------------------------------------------- challenge --- */
/* NAMING THE WALL IS THE WHOLE JOB HERE. A challenged store, an empty store and
   a slow store look identical from a row count of zero, and they need opposite
   responses: hand the first to the operator, investigate the second, wait on the
   third. api/coldwater.js learned this the hard way with Banzen's timeout being
   read as a block. */
const CHALLENGE_MARKERS = [
  "just a moment", "checking your browser", "cf-challenge", "cf_chl", "attention required",
  "verify you are human", "ray id", "px-captcha", "perimeterx", "access denied",
  "unusual traffic", "enable javascript and cookies",
];
async function challengeState(tab) {
  const probe = await tab.evaluate(`(function(){
    var t = (document.body && document.body.innerText || "").slice(0, 4000).toLowerCase();
    var ti = (document.title || "").toLowerCase();
    return { text: t, title: ti, len: (document.body && document.body.innerText || "").length };
  })()`);
  if (!probe) return { challenged: false, reason: "no document" };
  const hay = (probe.title + " " + probe.text);
  const hit = CHALLENGE_MARKERS.find(m => hay.indexOf(m) >= 0);
  return { challenged: !!hit, marker: hit || "", textLen: probe.len };
}

/* ---------------------------------------------------------------- harvest --- */
async function harvestStore(port, store, opts, collectorSrc) {
  const started = Date.now();
  /* THE MENU, NOT THE FRONT DOOR, and the first live run is what proved it
     matters. Seven of Detroit's sixteen shops came back "read the page but
     found nothing product-shaped" -- and most of their roster entries are a
     bare domain, because `site` is where a shop's HOMEPAGE lives. A homepage
     carries a hero image and a specials carousel; the catalogue is one click
     in. Reading nothing there is the correct answer to the wrong question.

     The catalogue probe learned this two commits earlier and this file had not.
     Same candidate list, same order, and the same reason for it: the roster's
     own menuUrl is authoritative where a shop has one, and the conventional
     paths are tried before falling back to the front page.

     ONE NAVIGATION EACH, not one browser each. The tab is reused across
     candidates and the first that yields rows wins, so the cost of trying four
     paths is four navigations rather than four Chromium instances -- and a shop
     whose menu IS its homepage still ends up there, one attempt later. */
  const candidates = [];
  const push = u => { if (u && candidates.indexOf(u) < 0) candidates.push(u); };
  if (store.menuUrl) {
    /* AN EXPLICIT menuUrl IS NOT A HINT, and the suite caught this being
       treated as one. Where the roster names a menu, that is somebody's stated
       answer to "where is this shop's catalogue"; wandering off it to try
       /menu and /shop is the same class of guessing that publishes one Lume
       town's prices under another's -- and it turned a shop the fixture calls
       EMPTY into a shop reporting rows from a different page. Searching is for
       a roster entry that has nothing but a bare domain, which is most of
       Detroit's, and never for one that has been told. */
    push(store.menuUrl);
  } else {
    for (const path of ["/menu", "/shop", "/order-online", "/products"]) {
      try { push(new URL(path, store.site).href); } catch (e) {}
    }
    push(store.site);
  }
  const url = candidates[0];
  const out = { key: store.key, name: store.name, url, products: 0, ms: 0, tried: [] };
  if (!url) { out.error = "no menuUrl or site"; return out; }

  let tab;
  try {
    tab = await openTab(port);
    await tab.send("Page.enable");
    await tab.send("Runtime.enable");
    /* Settle on the network rather than on a fixed sleep where we can, but cap
       it: a menu that never goes idle (analytics beacons, websockets) is normal
       and must not hang the run. */
    const settle = async () => {
      await Promise.race([
        new Promise(res => {
          const t0 = Date.now();
          const poll = setInterval(async () => {
            try {
              const st = await tab.evaluate("document.readyState");
              if (st === "complete" || Date.now() - t0 > 20000) { clearInterval(poll); res(); }
            } catch (e) { clearInterval(poll); res(); }
          }, 400);
        }),
        sleep(22000),
      ]);
    };

    /* WHICH OF THE CANDIDATES IS THE MENU, decided by looking rather than by
       guessing which path a shop uses. The test is deliberately crude and
       cheap: a page with many prices on it is a menu, a page with a few is a
       homepage. It runs BEFORE the collector is injected, so a wrong guess
       costs one navigation instead of a full autoAll settle -- which is the
       whole reason it is safe to try four paths at all.

       A CHALLENGE ENDS THE SEARCH IMMEDIATELY. Trying three more paths at a
       shop that has just declined an automated client is exactly the knocking
       this project does not do. */
    /* A PAGE THAT NEVER LOADED IS NOT AN EMPTY SHOP, and until this was
       measured it was reported as one. CDP's Page.navigate answers with an
       `errorText` when the navigation itself failed -- DNS, a refused proxy, a
       dead menu url -- and that result was being discarded, so the collector
       then scanned a browser error page, found nothing product-shaped, and the
       store was filed `empty`: the one verdict that means "go and look at the
       shop". This file's own header exists to keep walled, empty and errored
       apart because they need opposite responses; a fourth outcome was folded
       into the wrong one of them. Proven with no network at all -- seven
       Coldwater shops, six reported `empty` and one tripped the location guard,
       from a container that cannot resolve any of their hosts. */
    let priced = -1, chosen = null, navErr = "";
    for (const cand of candidates) {
      const nav = await tab.send("Page.navigate", { url: cand });
      const err = nav && nav.result && nav.result.errorText;
      if (err) {
        /* Recorded, not thrown: the next candidate may well be fine, and only a
           sweep where EVERY candidate failed is a run-level fault. */
        navErr = String(err);
        out.tried.push(cand.replace(/^https?:\/\//, "") + ":nav:" + navErr);
        continue;
      }
      navErr = "";
      await settle();
      const ch0 = await challengeState(tab);
      if (ch0.challenged) { chosen = cand; priced = -1; break; }
      let n = 0;
      try {
        n = Number(await tab.evaluate(
          '((document.body && document.body.innerText || "").match(/\\$\\s?\\d/g) || []).length')) || 0;
      } catch (e) {}
      out.tried.push(cand.replace(/^https?:\/\//, "") + ":" + n);
      if (n > priced) { priced = n; chosen = cand; }
      /* Twelve is "more than a carousel", the same floor the catalogue probe
         uses and for the same reason: it is not a threshold with meaning, it is
         the point past which this is obviously a list of things for sale. */
      if (n >= 12) break;
      if (opts.spacingMs) await sleep(Math.min(opts.spacingMs, 1500));
    }
    /* Land on the best candidate if the last one tried was not it. */
    if (chosen && chosen !== candidates[candidates.length - 1] || (chosen && priced >= 0)) {
      const nowAt = await tab.evaluate("location.href").catch(() => "");
      if (String(nowAt || "").indexOf(chosen) !== 0 && nowAt !== chosen) {
        await tab.send("Page.navigate", { url: chosen });
        await settle();
      }
    }
    out.url = chosen || url;
    out.pricesSeen = priced;

    /* EVERY candidate failed to load. Not walled (nothing declined us), not
       empty (nothing was read), and not something to hand to the operator's
       lane -- it is the run that is broken, which is what `error` means here. */
    if (!chosen && navErr) {
      out.error = "navigation failed: " + navErr;
      out.ms = Date.now() - started;
      return out;
    }

    const ch = await challengeState(tab);
    if (ch.challenged) {
      /* NOT AN ERROR AND NOT A ROW COUNT OF ZERO. This is the store declining an
         automated client, which is its right, and the answer is the operator's
         own browser -- not a retry, not a workaround. */
      out.challenged = true;
      out.marker = ch.marker;
      out.note = "served a bot challenge; this store belongs to the manual lane";
      out.ms = Date.now() - started;
      return out;
    }

    /* THE PAGE HAS TO SAY IT IS THE RIGHT SHOP, and only a chain needs asking.
       Lume runs ~38 Michigan stores on one origin and /shop/all is whichever
       store this profile last selected, so a capture of Monroe published as
       Coldwater is plausible, silent, and found by a shopper rather than by us.
       Checked BEFORE the collector runs: there is no point reading a menu we
       are about to refuse. */
    const policy = policyFor(store.key);
    if (policy.expectText) {
      const body = await tab.evaluate('(document.body && document.body.innerText || "").slice(0, 20000)');
      if (!policy.expectText.test(String(body || ""))) {
        out.error = `page does not mention ${policy.expectText} — wrong store selected for this chain?`;
        out.ms = Date.now() - started;
        return out;
      }
    }

    await tab.evaluate(collectorSrc);
    const has = await tab.evaluate("!!(window.__LL_COLLECT__ && window.__LL_COLLECT__.autoScan)");
    if (!has) { out.error = "collector did not expose __LL_COLLECT__"; out.ms = Date.now() - started; return out; }

    /* CLEAR THE BATCH BEFORE READING. The collector keeps its batch in
       localStorage so an operator can work through a paginated menu category by
       category and have the rows add up. A scheduled run wants the opposite: one
       page, one read, one post. Without this, two shops sharing an origin -- a
       chain under one domain, which is Lume's 38 stores exactly -- pool into one
       batch and the second store posts the first one's menu. Belt as well as
       braces alongside the path scoping in BATCH_KEY, because the scoping is a
       guess about someone else's URL layout and this is not. */
    await tab.evaluate("window.__LL_COLLECT__.reset && window.__LL_COLLECT__.reset()");

    /* autoScan owns the settle rule (scroll, re-harvest, count dry ticks) and
       autoPage owns the pager on top of it. The outer cap is a backstop for a
       page that never satisfies either.

       FEATURE-DETECTED, NOT FORKED. A deployed collector that predates autoPage
       still harvests correctly, it just stops at page one -- so this asks the
       page what it has rather than assuming, and the day the patched collector
       ships every paginated shop starts paging with no change here. The pager
       belongs beside autoScan in the collector so BOTH lanes agree on what a
       complete capture is; this file deliberately owns none of that logic.

       THE CAP FOLLOWS THE MODE. Seven pages under the single-page cap is a
       truncated menu published as a whole one. */
    const mode = await tab.evaluate(`(function(){
      var C = window.__LL_COLLECT__ || {};
      return typeof C.autoAll === 'function' ? 'all'
           : typeof C.autoPage === 'function' ? 'page'
           : 'scan';
    })()`);
    const cap = mode === "scan" ? (Number(opts.settleMs) || 45000) : (Number(opts.pagedMs) || 300000);
    out.mode = mode;
    const rows = await tab.evaluate(`new Promise(function(resolve){
      var done = false;
      var C = window.__LL_COLLECT__;
      var cap = setTimeout(function(){ if(!done){ done = true; resolve(C.batchList() || []); } }, ${cap});
      function finish(list){ if (done) return; done = true; clearTimeout(cap); resolve(list || []); }
      var opts = { settleMs: 2600, maxPages: 40, maxTabs: 25 };
      try {
        if (${JSON.stringify(mode)} === 'all') C.autoAll(function(){}, finish, opts);
        else if (${JSON.stringify(mode)} === 'page') C.autoPage(function(){}, finish, opts);
        else C.autoScan(function(){}, finish);
      } catch (e) { if(!done){ done = true; clearTimeout(cap); resolve([]); } }
    })`,
    true,
    /* THE TRANSPORT MUST OUTLAST THE SCAN IT IS WAITING FOR. `cap` above is the
       collector's own settle budget; the CDP call gets that plus headroom for
       the round trip and the JSON of a big menu, so a slow shop reports what it
       found instead of reporting the harness giving up on it. */
    cap + 30000);

    /* GUARDED, BECAUSE THE HANDLE IS NOT ALWAYS THERE. On a page with no menu
       the collector puts up its failure panel and returns before exposing
       __LL_COLLECT__ on some paths -- so this line threw "Cannot read
       properties of undefined (reading 'diag')" and the shop was filed as
       ERRORED. It is not an error; it is an empty menu, which is a completely
       different thing to do about (§ the three-outcomes note at the head of
       this file). Reading it defensively puts the shop back in the right bucket. */
    const diagRaw = await tab.evaluate(
      "JSON.stringify((window.__LL_COLLECT__ && window.__LL_COLLECT__.diag && window.__LL_COLLECT__.diag()) || {})");
    out.diag = (() => { try { return JSON.parse(diagRaw) || {}; } catch (e) { return {}; } })();
    out.via = out.diag.via || "";
    out.rows = Array.isArray(rows) ? rows : [];
    out.products = out.rows.length;
    out.ms = Date.now() - started;
    /* A zero here is a real finding and must not be posted as a capture: an
       empty harvest that overwrites nothing is fine, an empty harvest that
       REPLACES a good one is the destructive merge this project just spent a
       commit removing. The ladder protects against it, and so does this. */
    if (!out.products) out.note = "read the page but found nothing product-shaped";
    return out;
  } catch (e) {
    out.error = String((e && e.message) || e).slice(0, 300);
    out.ms = Date.now() - started;
    return out;
  } finally {
    if (tab) { try { await tab.close(); } catch (e) {} }
  }
}

/* ------------------------------------------------------------------ post --- */
async function postRows(opts, store, rows) {
  const body = {
    storeKey: store.key,
    /* THE MARKET IS THE ONE BEING HARVESTED, and this was a hardcoded
       "coldwater" -- the seventh instance in one night of the same bug family:
       a market literal in a file that had a real one available. Nothing would
       have failed. A Detroit harvest would have written perfectly into
       Coldwater's namespace, returned ok:true, and never appeared on either
       shelf, which is exactly what the third registry did to the operator's own
       captures. Kept as a per-store value rather than a run-level one because
       the roster is what knows, and --market only chooses which roster to ask
       for. */
    market: store.town || opts.market || "coldwater",
    /* THE LANE. Without it the ingest defaults to `manual`, which would put a
       robot's rows on top of the operator's -- the precise inversion the ladder
       exists to prevent. */
    lane: "headless",
    collection: "headless",
    source: "harvester/" + (store.menuUrl ? new URL(store.menuUrl).hostname : "site"),
    href: store.menuUrl || store.site || "",
    products: rows,
  };
  const r = await fetch(opts.site.replace(/\/+$/, "") + "/api/coldwater/ingest", {
    method: "POST",
    headers: { "content-type": "application/json", "x-ll-admin-token": opts.token },
    body: JSON.stringify(body),
  });
  const text = await r.text();
  let j = null; try { j = JSON.parse(text); } catch (e) {}
  if (!r.ok) throw new Error("ingest " + r.status + ": " + text.slice(0, 200));
  return j;
}

/* ----------------------------------------------------------------- roster --- */
/* The store list comes from the SITE, not from a copy kept here. api/coldwater
   already publishes its roster under ?debug for exactly this reason -- the
   collector install page reads it too, so the roster cannot drift out of step
   with STORES the way vercel.json and server.mjs once did. */
async function roster(opts) {
  if (opts.storesFile) {
    const raw = JSON.parse(readFileSync(opts.storesFile, "utf8"));
    return Array.isArray(raw) ? raw : (raw.stores || []);
  }
  /* ONE CITY'S ROSTER, NAMED. This asked /api/coldwater?debug with no ?town=,
     which resolves through the default -- so whatever city was passed on the
     command line, the shops fetched were the pilot's. Combined with the
     hardcoded market above, a Detroit run would have harvested Coldwater's
     seven shops and filed them under Coldwater: a complete no-op wearing the
     clothes of a successful run.
     &slim because this asks for a shop LIST and the full payload carries the
     whole catalogue -- megabytes to learn seven urls. */
  const base = opts.site.replace(/\/+$/, "");
  const mk = encodeURIComponent(opts.market || "coldwater");
  const r = await fetch(`${base}/api/market?debug&slim&town=${mk}`);
  if (!r.ok) throw new Error("roster fetch failed: " + r.status);
  const j = await r.json();
  const rows = (j && j.roster) || (j && j.stores) || (j && j.meta && j.meta.roster) || [];
  /* The town travels with each shop so postRows cannot disagree with the
     roster about which city a capture belongs to. */
  return rows.map(x => ({ ...x, town: x.town || opts.market || "coldwater" }));
}

/* ------------------------------------------------------------------- main --- */
const opts = args(process.argv);
if (opts.help || !opts.site) {
  console.log(`
tools/harvest-coldwater.mjs — scheduled headless lane

  --site         https://legal-leafmarket.com   (required)
  --market       coldwater | detroit | grandrapids | ...   (default coldwater)
  --clear        comma-separated store keys to EMPTY, then exit (needs --token)
  --token        admin token; required unless --dry
  --only         comma-separated store keys
  --stores       JSON file of stores instead of the live roster
  --concurrency  tabs in parallel (default 2, max 8)
  --spacing      ms between store starts (default 1500)
  --settle       ms cap on autoScan per store (default 45000)
  --paged-settle ms cap when the collector exposes autoPage (default 300000)
  --dry          harvest and report, post nothing
  --force        publish past a failed guard (disables ALL guards; say why)
`.trim());
  process.exit(opts.site ? 0 : 1);
}
if (!opts.token && !opts.dry) {
  console.error("--token is required unless --dry. Never commit it; pass it from the environment.");
  process.exit(1);
}

/* CLEAR AND EXIT, BEFORE A BROWSER IS EVER STARTED. Chromium is ~300MB and
   10-20s per store; emptying a collection is one POST. */
if (opts.clear && opts.clear.length) {
  if (!opts.token) { console.error("--clear needs --token."); process.exit(1); }
  let bad = 0;
  for (const key of opts.clear) {
    try {
      const r = await fetch(opts.site.replace(/\/+$/, "") + "/api/coldwater/ingest", {
        method: "POST",
        headers: { "content-type": "application/json", "x-ll-admin-token": opts.token },
        body: JSON.stringify({ storeKey: key, market: opts.market, reset: true }),
      });
      const t = await r.text();
      console.log((r.ok ? "cleared " : "FAILED  ") + key + " (" + opts.market + ")  " + t.slice(0, 160));
      if (!r.ok) bad++;
    } catch (e) { console.log("FAILED  " + key + "  " + ((e && e.message) || e)); bad++; }
  }
  process.exit(bad ? 1 : 0);
}

const collectorSrc = readFileSync(join(ROOT, "public", "coldwater-collector.js"), "utf8");

let list = await roster(opts);
if (opts.only) {
  const want = opts.only.split(",").map(s => s.trim().toLowerCase()).filter(Boolean);
  list = list.filter(s => want.indexOf(String(s.key).toLowerCase()) >= 0);
}
/* A store with no page to read is not a failure, it is not in this lane. */
list = list.filter(s => s && s.key && (s.menuUrl || s.site));

/* A BARE CHAIN DOMAIN SHARED BY TWO SHOPS IS NOT A MENU, AND HARVESTING IT
   PUBLISHES ONE SHOP'S ROWS UNDER ANOTHER'S NAME.
 *
   The first live run did exactly this: jars-detroit stored 15 rows read from
   jarscannabis.com, the chain's front door -- which JARS's Grand Rapids shop
   shares, and which is nobody's menu. The collector even said so
   ("notAListing, 1 distinct link") and the harvester published anyway, because
   that guard is warning-only for good reasons elsewhere.
 *
   This is the Sapura/Exclusive failure with a new coat: 693 rows under the
   wrong shop began the same way. So a store whose only url is a host ANOTHER
   store on this run also uses, with no path to tell them apart, is skipped and
   named. The fix is data -- give it a url whose path names the shop -- and the
   skip says so rather than leaving it to be noticed on the shelf. */
{
  const hostOf = u => { try { return new URL(u).hostname.replace(/^www\./i, ""); } catch { return ""; } };
  const pathOf = u => { try { return new URL(u).pathname.replace(/\/+$/, ""); } catch { return ""; } };
  const count = {};
  for (const s of list) { const h = hostOf(s.menuUrl || s.site); if (h) count[h] = (count[h] || 0) + 1; }
  const skipped = [];
  list = list.filter(s => {
    const u = s.menuUrl || s.site, h = hostOf(u), p = pathOf(u);
    if (h && count[h] > 1 && !p) { skipped.push(s.key + " (" + h + ")"); return false; }
    return true;
  });
  if (skipped.length) {
    console.log("skipped, shared chain domain with no path to identify the shop: " + skipped.join(", "));
    console.log("  give these a site/menuUrl whose PATH names this shop, then re-run.");
  }
}

if (!list.length) { console.error("No stores to harvest."); process.exit(1); }

const PORT = 9411 + (process.pid % 200);
const { proc, bin } = await launch(PORT);
console.log(`chromium: ${bin}`);
console.log(`stores:   ${list.length}   concurrency ${opts.concurrency}   ${opts.dry ? "DRY RUN" : "posting to " + opts.site}\n`);

const results = [];
/* Product names per shop already read in this run, for the cross-shop guard.
   BEST EFFORT UNDER CONCURRENCY, and worth being honest about: with N workers
   two shops can be in flight at once, so whichever finishes second is the only
   one that gets to compare. That still catches the Sapura/Exclusive case (one
   of the pair is always second) and it is why the guard reports the pair rather
   than deciding which of them is wrong. Run --concurrency 1 for a strict pass. */
const seenNames = Object.create(null);
let cursor = 0;
async function worker() {
  while (cursor < list.length) {
    const store = list[cursor++];
    /* Spacing is per START, so concurrency and courtesy compose rather than
       fighting: N tabs, but never N simultaneous first-hits on one host. */
    await sleep(opts.spacingMs);
    const res = await harvestStore(PORT, store, opts, collectorSrc);

    /* THE GUARDS RUN BEFORE THE POST, ALWAYS -- including on a dry run, because
       the point of a dry run is to find out what WOULD be published. */
    if (res.products) {
      const g = guards(store, res.rows, res.diag, seenNames);
      res.stats = g.stats;
      res.problems = g.problems;
      res.warnings = g.warnings;
      /* RECORDED EVEN WHEN BLOCKED. Guard 6 asks whether this shop's menu is
         really another shop's, and it can only ask that of shops already seen
         in this run -- so a blocked capture still has to teach the ones after
         it, or the second half of the roster loses the check entirely. */
      seenNames[store.key] = nameSet(res.rows);
      for (const w of g.warnings) console.log(`       ! ${store.key}: ${w}`);
      for (const p of g.problems) console.log(`       x ${store.key}: ${p}`);
      if (!g.ok && opts.force) console.log(`       ! ${store.key}: --force, publishing past ${g.problems.length} failed guard(s)`);
      res.blocked = !g.ok && !opts.force;
    }

    if (res.products && !res.blocked && !opts.dry) {
      try {
        const j = await postRows(opts, store, res.rows);
        res.posted = j && j.stored;
        res.via = (j && j.via) || res.via;
      } catch (e) { res.postError = String((e && e.message) || e).slice(0, 200); }
    }
    delete res.rows;
    results.push(res);
    const tag = res.challenged ? "WALLED " : res.error ? "ERROR  " : res.blocked ? "BLOCKED" : res.products ? "ok     " : "empty  ";
    const why = res.postError || res.error || (res.blocked ? res.problems.join("; ") : "") || res.note || res.via || "";
    console.log(`${tag} ${String(res.key).padEnd(12)} ${String(res.products).padStart(5)} rows  ${String(res.ms).padStart(6)}ms  ${res.mode && res.mode !== "scan" ? res.mode + " " : ""}${why}`);
  }
}
await Promise.all(Array.from({ length: Math.min(opts.concurrency, list.length) }, worker));

try { proc.kill(); } catch (e) {}

const walled = results.filter(r => r.challenged);
const errored = results.filter(r => r.error || r.postError);
const empty = results.filter(r => !r.products && !r.challenged && !r.error);
const blocked = results.filter(r => r.blocked);
const good = results.filter(r => r.products && !r.blocked);

console.log(`\n${good.length} read, ${walled.length} walled, ${empty.length} empty, ${blocked.length} blocked, ${errored.length} errored`);
if (blocked.length) {
  /* A BLOCKED CAPTURE IS A FINDING, NOT A CRASH. It read a page and got rows;
     the rows failed a question about their shape. Printed with the question so
     the next step is obvious without re-running anything. */
  console.log(`\nblocked by guards (nothing published for these):`);
  for (const r of blocked) console.log(`  ${r.key}: ${r.problems.join("; ")}`);
}
if (walled.length) {
  /* Printed as a WORKLIST, not as a failure list. These are the stores the
     operator's own browser has to cover, and that assignment is the output of
     this run rather than an exception in it. */
  console.log(`\nmanual lane (served a challenge): ${walled.map(r => r.key).join(", ")}`);
}
if (errored.length) console.log(`errors: ${errored.map(r => r.key + " (" + (r.error || r.postError) + ")").join("; ")}`);

process.exit(errored.length && !good.length ? 1 : 0);
