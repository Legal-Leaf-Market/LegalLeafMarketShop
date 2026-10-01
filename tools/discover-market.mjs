/* tools/discover-market.mjs — find the shops in a city, and say how sure you are.
 *
 *   node tools/discover-market.mjs --market detroit --out data/detroit.json
 *   node tools/discover-market.mjs --market lansing --seeds seeds.txt --probe
 *
 * ---------------------------------------------------------------------------
 * WHAT THIS IS FOR. Coldwater's seven stores were each read off the shop's own
 * page source by hand. That does not scale to Detroit, but the STANDARD does not
 * move: nothing reaches api/markets.js invented. So this produces LEADS with
 * their evidence attached, and a human or a later probe promotes them.
 *
 * THREE STATES, and keeping them apart is the whole job:
 *
 *   candidate  a name and a url from somewhere public. Not verified. Never live.
 *   confirmed  its own page was fetched and it looks like a dispensary in this
 *              city -- a menu platform identified, or the city named on the page.
 *   dead       fetched and wrong: 404, parked domain, a different town, closed.
 *              Recorded WITH ITS REASON rather than dropped, so the next sweep
 *              does not rediscover it and re-add it.
 *
 * A REFUSAL IS NOT A DEATH, and the first live sweep proved why it matters.
 * Utopia Gardens -- open, licensed, written up in the Metro Times -- answered
 * 403 and was filed `dead`. That is the one status here that is sticky ON
 * PURPOSE, so a wrong `dead` is not a bad row: it is a real shop permanently
 * removed from consideration, quietly. 401/403/429/503 now land as `candidate`
 * on the manual lane, beside a detected challenge, because a server declining an
 * automated client is a routing decision and never a finding about whether the
 * business exists.
 *
 * IT REFUSES TO GUESS. A shop whose page cannot be reached stays `candidate`
 * forever rather than being promoted on the strength of a plausible url. An
 * entry that cannot prove which city it is in is the Coldwater/Monroe failure
 * with a bigger blast radius.
 *
 * ---------------------------------------------------------------------------
 * EGRESS. This will do nothing useful from a container whose proxy refuses
 * dispensary hosts -- every fetch fails and every candidate stays a candidate,
 * which is the correct behaviour but not a useful afternoon. Run it from a
 * machine with normal network access. It says which mode it is in on the first
 * line rather than leaving you to infer it from a wall of failures.
 *
 * SAME COURTESIES AS EVERYTHING ELSE HERE: a descriptive User-Agent with a
 * contact url, one request per host per run, spacing between them, and no
 * attempt to look like anything other than what it is. A challenged host is
 * recorded as challenged and handed to the operator's own browser -- the same
 * split the harvester makes, for the same reason.
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { MARKETS, marketKey } from "../api/markets.js";

const UA = "LegalLeafMarket/1.0 (+https://legal-leafmarket.com/coldwater; price comparison; store discovery; contact via site)";
const sleep = ms => new Promise(r => setTimeout(r, ms));

function args(argv) {
  const o = { spacingMs: 1200, timeoutMs: 15000, probe: false };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i], next = () => argv[++i];
    if (a === "--market") o.market = next();
    else if (a === "--out") o.out = next();
    else if (a === "--seeds") o.seeds = next();
    else if (a === "--probe") o.probe = true;
    else if (a === "--spacing") o.spacingMs = Number(next()) || 1200;
    else if (a === "--help" || a === "-h") o.help = true;
  }
  return o;
}

/* ------------------------------------------------------------- platforms --- */
/* The signatures Coldwater's seven taught us, plus the two the statewide sweep
   is most likely to add. Order matters only for reporting; a page can carry more
   than one and all of them are recorded. */
const PLATFORM_SIGNS = [
  ["dutchie",   /dutchie\.com|embedded-menu|dutchiePlus/i],
  ["jane",      /iheartjane\.com|jane-frame|\bjaneDM\b/i],
  ["flowhub",   /dispensary\.shop|flowhub|greenlight/i],
  ["tymber",    /tymber|blaze\.me|tymber-blaze/i],
  ["cannavate", /cannavate|shophcc/i],
  ["lume",      /lume\.com/i],
  ["woocommerce", /wp-json\/wc\/store|woocommerce/i],
  ["shopify",   /cdn\.shopify\.com|Shopify\.theme/i],
  ["leafly",    /leafly\.com\/embed|leafly-menu/i],
  ["weedmaps",  /weedmaps\.com\/embed|wm-embed/i],
  ["dispense",  /dispenseapp|\bdispense\.\w/i],
  ["meadow",    /getmeadow|meadow\.menu/i],
];

/* Text markers only; a challenge is served as 200 more often than not. Same list
   the harvester and the readability sweep use -- three copies that drift would
   file the same shop three different ways. */
const CHALLENGE = [
  "just a moment", "checking your browser", "cf-challenge", "cf_chl",
  "attention required", "verify you are human", "px-captcha", "perimeterx",
  "unusual traffic", "enable javascript and cookies", "access denied",
];

/* Codes that mean "not to you" rather than "not here". A shop is entitled to
   refuse an automated reader; that is a routing decision (hand it to the
   operator's browser), never a finding about whether the business exists. */
const REFUSAL = new Set([401, 403, 406, 409, 418, 429, 451, 503]);

function readPage(body, market) {
  const hay = body.slice(0, 400000);
  const low = hay.slice(0, 8000).toLowerCase();
  const challenged = CHALLENGE.find(m => low.indexOf(m) >= 0) || "";
  const platforms = PLATFORM_SIGNS.filter(([, re]) => re.test(hay)).map(([n]) => n);

  /* THE CITY MUST BE ON THE PAGE. This is the guard that stops a chain's national
     site being filed as a Detroit shop because its url happened to contain the
     word. Same job as fromLume()'s expectLocation, one layer earlier. */
  const label = (MARKETS[market] && MARKETS[market].label) || "";
  const cityOnPage = label ? new RegExp("\\b" + label.replace(/\s+/g, "\\s+") + "\\b", "i").test(hay) : false;

  const prices = (hay.match(/\$\s?\d{1,4}(?:\.\d{2})?/g) || []).length;
  return { challenged, platforms, cityOnPage, prices, bytes: body.length };
}

async function probe(url, opts) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), opts.timeoutMs);
  const t0 = Date.now();
  try {
    const r = await fetch(url, {
      signal: ctl.signal, redirect: "follow",
      headers: { "user-agent": UA, accept: "text/html,application/xhtml+xml,*/*" },
    });
    const body = await r.text();
    return { ok: r.ok, status: r.status, ms: Date.now() - t0, body };
  } catch (e) {
    /* An abort is a TIMEOUT and is never reported as a wall -- Banzen's big
       server-rendered page aborted at 9s once and read as blocked, which writes
       off the most readable kind of store there is. */
    return { error: (e && e.name === "AbortError") ? "timeout" : String((e && e.message) || e).slice(0, 140), ms: Date.now() - t0 };
  } finally { clearTimeout(t); }
}

/* ------------------------------------------------------------------ main --- */
const opts = args(process.argv);
if (opts.help || !opts.market) {
  console.log(`
tools/discover-market.mjs — build a store registry for one city

  --market SLUG    a key from api/markets.js (detroit, grandrapids, lansing, ...)
  --seeds FILE     newline-separated urls or "Name|url" pairs to check
  --probe          fetch each candidate and classify it (needs real egress)
  --out FILE       write the registry JSON
  --spacing MS     between requests (default 1200)

Without --probe this only normalises and de-duplicates the seed list, which is
useful on a machine that cannot reach the shops.
`.trim());
  process.exit(opts.market ? 0 : 1);
}

const market = marketKey(opts.market);
if (market !== String(opts.market).toLowerCase().replace(/[^a-z]/g, "")) {
  console.error(`Unknown market "${opts.market}". Known: ${Object.keys(MARKETS).join(", ")}`);
  process.exit(1);
}
const def = MARKETS[market];

/* Say which mode this is, first line, rather than letting a wall of failures
   imply it. */
let egress = "unknown";
try {
  const r = await probe("https://example.com/", { timeoutMs: 8000 });
  egress = r.ok ? "open" : (r.error ? "BLOCKED (" + r.error + ")" : "http " + r.status);
} catch (e) { egress = "BLOCKED"; }
console.log(`market: ${def.label} (${market})   egress: ${egress}`);
if (opts.probe && egress !== "open") {
  console.log(`\n  --probe was asked for but egress is ${egress}.`);
  console.log(`  Every candidate will stay a candidate, which is correct and not useful.`);
  console.log(`  Run this from a machine with normal network access.\n`);
}

/* Seeds. A line is either a bare url or "Name|url". Nothing is invented: with no
   seed file this produces an empty registry rather than guessing store names. */
let seeds = [];
if (opts.seeds && existsSync(opts.seeds)) {
  seeds = readFileSync(opts.seeds, "utf8").split(/\r?\n/)
    .map(l => l.trim()).filter(l => l && !l.startsWith("#"))
    .map(l => {
      const i = l.indexOf("|");
      return i > 0 ? { name: l.slice(0, i).trim(), url: l.slice(i + 1).trim() }
                   : { name: "", url: l };
    })
    .filter(x => /^https?:\/\//i.test(x.url));
}

/* De-duplicate by HOST, not by url: a chain's location pages and its menu page
   are one shop, and a seed list scraped from a directory is full of both. */
const byHost = new Map();
for (const s of seeds) {
  let host;
  try { host = new URL(s.url).host.replace(/^www\./, "").toLowerCase(); } catch (e) { continue; }
  if (!byHost.has(host)) byHost.set(host, { host, name: s.name, urls: [] });
  const e = byHost.get(host);
  if (!e.name && s.name) e.name = s.name;
  if (e.urls.indexOf(s.url) < 0) e.urls.push(s.url);
}
const cands = [...byHost.values()];
console.log(`seeds: ${seeds.length} urls -> ${cands.length} distinct hosts\n`);

const out = [];
for (let i = 0; i < cands.length; i++) {
  const c = cands[i];
  const entry = {
    key: c.host.replace(/\.[a-z.]+$/, "").replace(/[^a-z0-9]+/g, "").slice(0, 24) || ("shop" + i),
    name: c.name || c.host,
    town: market,
    site: c.urls[0],
    urls: c.urls,
    platform: "",            // "" is "nobody has looked", never "none"
    status: "candidate",
    enabled: false,          // only a confirmed entry may ever be flipped
    evidence: {},
  };

  if (opts.probe && egress === "open") {
    if (i) await sleep(opts.spacingMs);
    const r = await probe(c.urls[0], opts);
    if (r.error) {
      entry.evidence = { error: r.error, ms: r.ms };
    } else if (!r.ok && !REFUSAL.has(r.status)) {
      /* GONE, not merely unwilling: a 404 or a 410 is the url being wrong. */
      entry.status = "dead";
      entry.evidence = { reason: "http " + r.status, ms: r.ms };
    } else if (!r.ok) {
      /* A REFUSAL IS NOT A DEATH, and this cost a real shop on the first live
         sweep. Utopia Gardens -- open, licensed, written up in the Metro Times
         -- answered 403 and was filed `dead`, which is the ONE status this tool
         makes sticky on purpose: "KEPT, with its reason, because deleting it
         invites the next sweep to rediscover it and re-add it." So a wrong
         `dead` is not a bad row, it is a shop permanently removed from
         consideration, quietly.
         403/401/429/503 are a server declining an automated client, which is
         its right and is exactly what the manual lane exists for. Same landing
         place as a detected challenge, one layer earlier -- and the body IS
         read, because Cloudflare serves its "attention required" page with a
         403 and the marker is in there. */
      const read = readPage(r.body || "", market);
      entry.status = "candidate";
      entry.lane = "manual";
      entry.platform = read.platforms[0] || "";
      entry.evidence = {
        reason: "http " + r.status + " -- refused an automated client, not gone",
        refused: true, ms: r.ms, bytes: read.bytes,
        platforms: read.platforms, cityOnPage: read.cityOnPage,
        challenged: read.challenged || undefined,
      };
    } else {
      const read = readPage(r.body, market);
      entry.evidence = { status: r.status, ms: r.ms, bytes: read.bytes, prices: read.prices,
                         platforms: read.platforms, cityOnPage: read.cityOnPage };
      if (read.challenged) {
        /* Not dead and not confirmed. The shop is declining an automated client,
           which is its right; this one belongs to the operator's own browser. */
        entry.evidence.challenged = read.challenged;
        entry.platform = read.platforms[0] || "";
        entry.status = "candidate";
        entry.lane = "manual";
      } else if (read.cityOnPage) {
        /* CONFIRMED needs the CITY, not just a platform. A menu platform proves
           it is a dispensary; only the city name proves it is THIS city's. */
        entry.status = "confirmed";
        entry.platform = read.platforms[0] || "";
      } else {
        entry.evidence.reason = "page never names " + def.label;
        entry.status = "candidate";
      }
    }
  }

  out.push(entry);
  const tag = { confirmed: "CONFIRMED", candidate: "candidate", dead: "dead     " }[entry.status];
  console.log(`${tag}  ${entry.key.padEnd(20)} ${(entry.platform || "-").padEnd(12)} ${entry.evidence.challenged ? "WALLED" : (entry.evidence.reason || entry.evidence.error || "")}`);
}

const summary = {
  market, label: def.label, generatedFor: def.market,
  counts: {
    confirmed: out.filter(x => x.status === "confirmed").length,
    candidate: out.filter(x => x.status === "candidate").length,
    dead: out.filter(x => x.status === "dead").length,
    /* WALLED counts both shapes: a challenge page served with a 200 (the common
       one) and a bare refusal code with no body to read. Both mean the same
       thing operationally -- this shop is the operator's browser's job -- and
       counting only the first made a 403 look like a shop that did not exist. */
    walled: out.filter(x => x.evidence && (x.evidence.challenged || x.evidence.refused)).length,
  },
  /* The state's own number, where we have it, so a sweep can say how much of the
     city it actually found rather than reporting a bare count. */
  expectedStores: def.stores || null,
  stores: out,
};

console.log(`\n${summary.counts.confirmed} confirmed, ${summary.counts.candidate} candidate, ${summary.counts.dead} dead, ${summary.counts.walled} walled`);
if (def.stores) {
  console.log(`the state pays this city for ${def.stores} licences, so this sweep found ${summary.counts.confirmed}/${def.stores}`);
}
if (opts.out) {
  mkdirSync(dirname(opts.out), { recursive: true });
  writeFileSync(opts.out, JSON.stringify(summary, null, 2));
  console.log(`\nwrote ${opts.out}`);
}
