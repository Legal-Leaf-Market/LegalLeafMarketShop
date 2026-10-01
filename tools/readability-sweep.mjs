/* tools/readability-sweep.mjs — how much of the state can be read without a person.
 *
 *   node tools/readability-sweep.mjs --stores stores.json [--json out.json] [--concurrency 4]
 *
 * ---------------------------------------------------------------------------
 * THE NUMBER THIS EXISTS TO PRODUCE.
 *
 * Every plan for going statewide rests on one ratio -- how many shops answer a
 * plain server request with a menu, and how many need the operator's own browser
 * -- and that ratio has never been measured past the seven Coldwater shops. Four
 * readable to three walled is an extrapolation from a sample of seven, and the
 * difference between 60% and 95% automated is the difference between a cron job
 * and a second full-time job.
 *
 * So this asks each store ONE question, cheaply, and reports what came back. It
 * fetches nothing but the page a browser would be given, parses no catalogue,
 * and stores nothing.
 *
 * WHY IT IS NOT PART OF THE HARVESTER. The harvester spends a real browser and
 * 10-20s per store; this spends one fetch and a few hundred milliseconds, so it
 * can cover a statewide roster in minutes and be re-run whenever a platform
 * changes. It also answers a different question: not "what is on this menu" but
 * "would anything have to be done by hand here".
 *
 * FOUR OUTCOMES, and the point is that three of them are invisible from a row
 * count of zero -- the same lesson api/coldwater.js learned when Banzen's
 * timeout read as a wall:
 *
 *   server-readable  the menu is IN the page a plain GET returns. Adapter lane.
 *   render-needed    a real page, but the catalogue arrives over a later call.
 *                    Headless lane; no per-platform adapter needed.
 *   walled           a bot challenge. Operator's lane, permanently.
 *   unreachable      DNS, TLS, timeout, 404. A fault to fix, not a lane.
 *
 * It reads only what a shop serves to anyone. Same courtesies as everything else
 * here: a descriptive User-Agent with a contact URL, one request per store,
 * spacing between them, and no attempt whatsoever to look like something else.
 * A challenged store is recorded as challenged.
 * ---------------------------------------------------------------------------
 */
import { readFileSync, writeFileSync } from "node:fs";

const UA = "LegalLeafMarket/1.0 (+https://legal-leafmarket.com/coldwater; price comparison; readability probe; contact via site)";
const sleep = ms => new Promise(r => setTimeout(r, ms));

function args(argv) {
  const o = { concurrency: 4, spacingMs: 900, timeoutMs: 20000 };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i], next = () => argv[++i];
    if (a === "--stores") o.storesFile = next();
    else if (a === "--site") o.site = next();
    else if (a === "--json") o.json = next();
    else if (a === "--concurrency") o.concurrency = Math.max(1, Math.min(8, Number(next()) || 4));
    else if (a === "--spacing") o.spacingMs = Number(next()) || 900;
    else if (a === "--help" || a === "-h") o.help = true;
  }
  return o;
}

/* Text markers, not status codes: a challenge is served as 200 more often than
   not. Same list the harvester uses, and it should stay the same list -- two
   copies that drift would put a store in different lanes depending on which
   tool looked. */
const CHALLENGE = [
  "just a moment", "checking your browser", "cf-challenge", "cf_chl", "attention required",
  "verify you are human", "px-captcha", "perimeterx", "unusual traffic",
  "enable javascript and cookies", "access denied", "request unsuccessful",
];

/* Does the page CONTAIN a catalogue, as opposed to the shell that will fetch
   one? Prices are the tell that survives every platform, because a menu without
   them is not a menu. The threshold is deliberately low: this is asking "is the
   catalogue in here at all", not "how big is it". */
function readability(body) {
  const prices = (body.match(/\$\s?\d{1,4}(?:\.\d{2})?/g) || []).length;
  /* The shapes a server-rendered catalogue actually arrives in here. */
  const nextData = /__NEXT_DATA__/.test(body);
  const rsc = /self\.__next_f\.push/.test(body);
  const jsonLd = /"@type"\s*:\s*"(Product|Offer)"/i.test(body);
  const shopify = /\/products\.json|Shopify\.theme/.test(body);
  const woo = /wp-json\/wc\/store|woocommerce/i.test(body);
  const embed = /dutchie\.com\/api\/v2\/embedded-menu|iheartjane\.com|tymber|dispensary\.shop|cannavate/i.test(body);
  return { prices, nextData, rsc, jsonLd, shopify, woo, embed };
}

async function probe(store, opts) {
  const url = store.menuUrl || store.site;
  const out = { key: store.key, name: store.name || "", url: url || "" };
  if (!url) { out.verdict = "unreachable"; out.why = "no menuUrl or site"; return out; }

  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), opts.timeoutMs);
  const t0 = Date.now();
  try {
    const r = await fetch(url, {
      signal: ctl.signal, redirect: "follow",
      headers: { "user-agent": UA, accept: "text/html,application/xhtml+xml,*/*" },
    });
    const body = await r.text();
    out.status = r.status;
    out.bytes = body.length;
    out.ms = Date.now() - t0;

    const hay = body.slice(0, 6000).toLowerCase();
    const marker = CHALLENGE.find(m => hay.indexOf(m) >= 0);
    if (marker) { out.verdict = "walled"; out.why = "challenge marker: " + marker; out.lane = "manual"; return out; }

    if (!r.ok) { out.verdict = "unreachable"; out.why = "http " + r.status; return out; }

    const sig = readability(body);
    out.signals = sig;

    /* A PRICE IN THE PAGE IS THE WHOLE TEST. Everything else is describing HOW
       it got there, which is useful for choosing an adapter and irrelevant to
       whether one is possible. Twelve is low on purpose -- a menu page carrying
       a dozen prices is carrying its catalogue, and demanding more would file a
       small shop as unreadable. */
    if (sig.prices >= 12) {
      out.verdict = "server-readable";
      out.lane = "adapter";
      out.why = [sig.nextData && "__NEXT_DATA__", sig.rsc && "rsc", sig.jsonLd && "json-ld",
                 sig.shopify && "shopify", sig.woo && "woo"].filter(Boolean).join("+") || "prices in html";
      return out;
    }

    /* A real page that simply has not fetched its menu yet. This is the lane the
       headless harvester exists for, and the useful part is that it needs NO
       per-platform work -- a browser renders it and the collector reads it. */
    out.verdict = "render-needed";
    out.lane = "headless";
    out.why = sig.embed ? "client-rendered embed" : (sig.prices ? "only " + sig.prices + " prices in html" : "no prices in html");
    return out;
  } catch (e) {
    out.ms = Date.now() - t0;
    out.verdict = "unreachable";
    /* An abort is a TIMEOUT and must not be filed as a wall. api/coldwater.js
       learned this from Banzen, whose big server-rendered page aborted at 9s and
       read as a block -- writing off the most readable kind of store there is. */
    out.why = (e && e.name === "AbortError") ? "timed out after " + opts.timeoutMs + "ms" : String((e && e.message) || e).slice(0, 160);
    return out;
  } finally { clearTimeout(timer); }
}

/* ------------------------------------------------------------------- main --- */
const opts = args(process.argv);
if (opts.help || (!opts.storesFile && !opts.site)) {
  console.log(`
tools/readability-sweep.mjs — measure how much of a roster is machine-readable

  --stores FILE   JSON array of {key,name,site,menuUrl}
  --site URL      read the roster from a live /api/coldwater?debug instead
  --json FILE     write the full result set
  --concurrency   parallel probes (default 4, max 8)
  --spacing       ms between probe starts (default 900)
`.trim());
  process.exit(opts.help ? 0 : 1);
}

let list;
if (opts.storesFile) {
  const raw = JSON.parse(readFileSync(opts.storesFile, "utf8"));
  list = Array.isArray(raw) ? raw : (raw.stores || []);
} else {
  const r = await fetch(opts.site.replace(/\/+$/, "") + "/api/coldwater?debug");
  const j = await r.json();
  list = (j && j.stores) || [];
}
list = list.filter(s => s && s.key && (s.menuUrl || s.site));
if (!list.length) { console.error("No stores to probe."); process.exit(1); }

console.log(`probing ${list.length} stores, concurrency ${opts.concurrency}\n`);

const results = [];
let cursor = 0;
async function worker() {
  while (cursor < list.length) {
    const s = list[cursor++];
    await sleep(opts.spacingMs);
    const r = await probe(s, opts);
    results.push(r);
    const tag = { "server-readable": "READABLE", "render-needed": "RENDER  ", walled: "WALLED  ", unreachable: "UNREACH " }[r.verdict];
    console.log(`${tag} ${String(r.key).padEnd(14)} ${String(r.bytes || 0).padStart(8)}b  ${r.why || ""}`);
  }
}
await Promise.all(Array.from({ length: Math.min(opts.concurrency, list.length) }, worker));

const by = v => results.filter(r => r.verdict === v).length;
const n = results.length;
const readable = by("server-readable"), render = by("render-needed"), walled = by("walled"), un = by("unreachable");
const pct = x => n ? Math.round((x / n) * 1000) / 10 : 0;

console.log(`
${n} stores probed

  server-readable  ${String(readable).padStart(4)}  ${String(pct(readable)).padStart(5)}%   adapter lane, one cheap fetch each
  render-needed    ${String(render).padStart(4)}  ${String(pct(render)).padStart(5)}%   headless lane, no per-platform work
  walled           ${String(walled).padStart(4)}  ${String(pct(walled)).padStart(5)}%   operator's lane, permanently
  unreachable      ${String(un).padStart(4)}  ${String(pct(un)).padStart(5)}%   a fault to fix, not a lane

AUTOMATABLE: ${readable + render} of ${n} (${pct(readable + render)}%)
BY HAND:     ${walled} of ${n} (${pct(walled)}%)`);

/* The number that actually decides the plan, stated in the unit the operator
   spends: hours per week, against the ~40-60 shops one person sustains at
   weekly freshness (MICHIGAN_EXPANSION.md section 5). */
if (walled) {
  const mins = Math.round(walled * 2);
  console.log(`\n${walled} walled shops is about ${mins} minutes per full manual pass` +
              (walled > 60 ? ` -- past what one person sustains weekly.` : `, inside one person's weekly budget.`));
}
if (un) console.log(`\nunreachable: ${results.filter(r => r.verdict === "unreachable").map(r => r.key + " (" + r.why + ")").join("; ")}`);

if (opts.json) {
  writeFileSync(opts.json, JSON.stringify({ probedCount: n, readable, render, walled, unreachable: un, results }, null, 2));
  console.log(`\nwrote ${opts.json}`);
}
