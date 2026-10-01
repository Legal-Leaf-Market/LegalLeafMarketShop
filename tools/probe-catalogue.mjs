/* tools/probe-catalogue.mjs — ask every shop for its actual products.
 *
 *   node tools/probe-catalogue.mjs --market detroit [--json out.json]
 *   node tools/probe-catalogue.mjs --market all --concurrency 3
 *
 * ---------------------------------------------------------------------------
 * WHY THIS EXISTS, AND WHAT WAS WRONG WITHOUT IT.
 *
 * Reported by the owner, and correct: "I'm a little confused why you're not
 * attempting to pull live from the stores yourself... we're supposed to be
 * triangulating approaches and I don't think we're really currently pulling
 * that off."
 *
 * Measured at the time: ONE store in the entire system had enabled:true. Lume,
 * in Coldwater. Detroit 0 of 9, Grand Rapids 0 of 8. Every shelf was 100%
 * operator's-browser, and every other store carried a platform guessed from a
 * homepage signature or left at "" -- a classification nobody had ever tested
 * by asking the shop for a product.
 *
 * The two tools that existed answer adjacent questions and neither answers this
 * one. discover-market.mjs asks "does this url look like a dispensary in this
 * city". readability-sweep.mjs asks "would a person have to do this by hand".
 * BOTH READ THE PAGE AND NEITHER READS A CATALOGUE, so "dutchie" on fifteen
 * stores was one observation about Coldwater generalised to fourteen shops
 * nobody had contacted.
 *
 * THE TRIANGULATION THIS COMPLETES. The manual lane already answers "what is on
 * this shelf" through the operator's browser. This is a SECOND, INDEPENDENT
 * answer to the same question from a plain server request -- so where both
 * work they can be compared, and where they disagree that is a finding rather
 * than a mystery. A lane you have never run is not a lane you have.
 *
 * IT DOES NOT DEFEAT ANYTHING, and that is the whole discipline (CLAUDE.md, the
 * collector section). Every request is one a browser would make, with our own
 * name on it. A challenge is an OUTCOME that gets recorded and routed to the
 * operator, never something to get around: no stealth headers, no fingerprint
 * work, no solver, no retry-with-a-different-UA. A shop is entitled to refuse
 * an automated reader.
 *
 * EVERY ATTEMPT IS RECORDED, not just the winning one. "This store is dutchie"
 * is exactly the kind of confident summary that got us here; what is useful
 * later is that the Woo endpoint 404'd, Shopify 404'd, and the page carried 312
 * products in __NEXT_DATA__ -- because the next person can tell "we did not
 * look" from "we looked and it was not there".
 *
 * COURTESIES, same as everything else here: a descriptive User-Agent with a
 * contact url, spacing between requests, a small fixed number of requests per
 * store, no crawling beyond the endpoints listed, and nothing stored.
 * ---------------------------------------------------------------------------
 */
import { STORES } from "../api/market-stores.js";
import { MARKETS } from "../api/markets.js";
import { writeFileSync } from "node:fs";

const UA = "LegalLeafMarket/1.0 (+https://legal-leafmarket.com/coldwater; price comparison; catalogue probe; contact via site)";

const opts = { market: "", json: "", spacingMs: 1500, timeoutMs: 20000, concurrency: 1 };
for (let i = 2; i < process.argv.length; i++) {
  const a = process.argv[i];
  if (a === "--market") opts.market = String(process.argv[++i] || "").toLowerCase();
  else if (a === "--json") opts.json = process.argv[++i];
  else if (a === "--spacing") opts.spacingMs = Number(process.argv[++i]) || 1500;
  else if (a === "--concurrency") opts.concurrency = Math.max(1, Number(process.argv[++i]) || 1);
}
if (!opts.market) {
  console.log("usage: node tools/probe-catalogue.mjs --market <slug|all> [--json out.json]");
  process.exit(2);
}

/* Same list the harvester, the readability sweep and discover-market use. Text
   markers rather than status codes, because a challenge is served as 200 more
   often than not. */
const CHALLENGE = [
  "just a moment", "checking your browser", "cf-challenge", "cf_chl",
  "attention required", "verify you are human", "px-captcha", "perimeterx",
  "unusual traffic", "enable javascript and cookies", "access denied",
];
const REFUSAL = new Set([401, 403, 406, 409, 418, 429, 451, 503]);

const wait = ms => new Promise(r => setTimeout(r, ms));

async function get(url, extra) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), opts.timeoutMs);
  const started = Date.now();
  try {
    const r = await fetch(url, {
      signal: ctl.signal, redirect: "follow",
      headers: { "user-agent": UA, accept: "application/json,text/html,*/*", ...(extra || {}) },
    });
    const body = await r.text();
    const low = body.slice(0, 8000).toLowerCase();
    return {
      ok: r.ok, status: r.status, bytes: body.length, body,
      ms: Date.now() - started,
      ctype: r.headers.get("content-type") || "",
      challenged: CHALLENGE.find(m => low.indexOf(m) >= 0) || "",
      refused: REFUSAL.has(r.status),
    };
  } catch (e) {
    return { ok: false, status: 0, bytes: 0, body: "", ms: Date.now() - started,
             error: String((e && e.name === "AbortError") ? "timeout" : (e && e.message) || e) };
  } finally { clearTimeout(t); }
}

/* ---- counting products, without a per-platform parser ---------------------
   The generic reader is the valuable one: it needs no knowledge of the shop and
   it is the same question api/coldwater.js's own readers ask. A thing is
   product-shaped if it has a name AND some price, anywhere in it. Deliberately
   loose -- this counts, it does not import. */
function looksProduct(o) {
  if (!o || typeof o !== "object" || Array.isArray(o)) return false;
  const k = Object.keys(o);
  const name = k.find(x => /^(name|title|productName|product_name)$/i.test(x));
  if (!name || typeof o[name] !== "string" || !o[name].trim()) return false;
  const priced = k.some(x => /price|cost|amount/i.test(x) && o[x] != null && o[x] !== "");
  const varied = k.some(x => /variant|option|weight|size|price/i.test(x) && Array.isArray(o[x]) && o[x].length);
  return priced || varied;
}

/* Largest product-shaped array anywhere in a JSON tree, plus a few names.
   Depth 14 for the reason public/coldwater-collector.js uses it: Remix buries
   loader data nine levels down and a depth-8 walk cut the menu off rather than
   failing to parse it. */
function biggestProductArray(root) {
  let best = [];
  const seen = new Set();
  const walk = (v, d) => {
    if (!v || typeof v !== "object" || d > 14) return;
    if (seen.has(v)) return;
    seen.add(v);
    if (Array.isArray(v)) {
      const hits = v.filter(looksProduct);
      if (hits.length > best.length) best = hits;
      for (const x of v) walk(x, d + 1);
      return;
    }
    for (const k of Object.keys(v)) walk(v[k], d + 1);
  };
  try { walk(root, 0); } catch {}
  return best;
}

function fromHtml(body) {
  const roots = [];
  const nd = body.match(/<script[^>]+id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/i);
  if (nd) { try { roots.push(JSON.parse(nd[1])); } catch {} }
  const tags = body.match(/<script[^>]+type="application\/(ld\+)?json"[^>]*>([\s\S]*?)<\/script>/gi) || [];
  for (const t of tags.slice(0, 40)) {
    const m = t.match(/>([\s\S]*?)<\/script>/i);
    if (m) { try { roots.push(JSON.parse(m[1])); } catch {} }
  }
  /* APOLLO'S CACHE IS A MAP, NOT AN ARRAY, which is why every "largest array"
     scan walks straight past it. Reported live from a Dutchie menu:
     __APOLLO_CLIENT__.cache.extract() held 145 fully structured products while
     the DOM had ~100 partial cards and bestArray was 0. The SSR form is
     __APOLLO_STATE__ in the page, so it can be read server-side too --
     normalised entries keyed "Product:abc", which become an array here. */
  const ap = body.match(/__APOLLO_STATE__\s*=\s*({[\s\S]*?})\s*;?\s*<\/script>/);
  if (ap) { try { roots.push(Object.values(JSON.parse(ap[1]))); } catch {} }
  let best = [];
  for (const r of roots) { const b = biggestProductArray(r); if (b.length > best.length) best = b; }
  return best;
}

const nameOf = p => String(p.name || p.title || p.productName || p.product_name || "").slice(0, 48);

/* ---- the endpoints -------------------------------------------------------
   Each is a public catalogue url a shop's OWN front end calls. Nothing here is
   private, guessed-at-scale, or authenticated. */
function endpointsFor(origin) {
  return [
    ["woocommerce", origin + "/wp-json/wc/store/v1/products?per_page=3"],
    ["shopify",     origin + "/products.json?limit=3"],
    ["dispense",    origin + "/api/v1/menu"],
    ["tymber",      origin + "/api/v2/products/?limit=3"],
    ["greenline",   origin + "/api/menu"],
  ];
}

async function probeStore(st) {
  const out = { key: st.key, name: st.name, town: st.town || "coldwater",
                declared: st.platform || "", enabled: !!st.enabled, attempts: [], verdict: "", found: 0, sample: [] };
  const target = st.menuUrl || st.site;
  if (!target) { out.verdict = "no url on the roster"; return out; }
  let origin = "";
  try { origin = new URL(target).origin; } catch { out.verdict = "unparseable url"; return out; }

  /* THE MENU PAGE, NOT THE FRONT DOOR, and the first live run is why this is
     here. Detroit's probe reported King of Budz "server-readable" with EIGHT
     products and High Club with TWO -- both true, and both nearly worthless,
     because a shop's landing page carries a specials carousel while its menu
     carries hundreds. Read as a verdict that is a confident wrong number of
     exactly the kind this file exists to stop producing.
     So where the roster names a menu url that is used; otherwise the common
     menu paths are tried before the front page, and the COUNT is graded rather
     than treated as a yes/no. */
  const candidates = st.menuUrl ? [st.menuUrl] : [];
  for (const p of ["/menu", "/shop", "/order-online", "/products"]) {
    try { candidates.push(new URL(p, target).href); } catch {}
  }
  candidates.push(target);

  let page = null, pageUrl = "";
  for (const u of candidates) {
    if (pageUrl) await wait(opts.spacingMs);
    const r = await get(u);
    out.attempts.push({ how: "page", url: u, status: r.status, bytes: r.bytes,
                        ms: r.ms, challenged: r.challenged || undefined, error: r.error });
    if (r.challenged) { out.verdict = "walled: " + r.challenged; return out; }
    if (r.ok && r.bytes) {
      const rows = fromHtml(r.body);
      out.attempts[out.attempts.length - 1].products = rows.length;
      /* PREFER A PAGE THAT LOADED, then prefer one with more rows. `rows.length
         > page.rows.length` alone is false at 0 > 0, so the FIRST attempt won
         whenever nothing was found -- and the first attempt is a GUESSED menu
         path. Measured on the first graded run: gage-detroit tried /menu, /shop,
         /order-online and /products (all 404), then its front page (200, 83KB),
         and was reported "unreachable: http 404". Eleven of sixteen Detroit
         shops came back unreachable that way while most of them had loaded
         perfectly -- a confident wrong verdict of exactly the kind this file
         exists to stop producing, in the file itself. */
      if (!page || !page.ok || rows.length > (page.rows || []).length) { page = r; page.rows = rows; pageUrl = u; }
      /* A REAL CATALOGUE STOPS THE SEARCH; a handful does not, because the next
         path may be the actual menu. 25 is a floor, not a threshold anybody
         should read meaning into -- it is "more than a carousel". */
      if (rows.length >= 25) break;
    } else if (!page) { page = r; page.rows = []; pageUrl = u; }
  }
  page = page || { ok: false, status: 0, bytes: 0, rows: [], error: "nothing tried" };
  if ((page.rows || []).length) {
    /* GRADED, because "server-readable" over eight rows is the sentence that
       made a specials carousel look like a shop. */
    const n = page.rows.length;
    out.verdict = (n >= 25 ? "server-readable (page state)" : "partial (page state, looks like a carousel not a menu)");
    out.found = n;
    out.sample = page.rows.slice(0, 3).map(nameOf);
    out.readAt = pageUrl;
    if (n >= 25) return out;
    /* A partial keeps going: an endpoint below may hold the whole thing. */
  }

  for (const [how, url] of endpointsFor(origin)) {
    await wait(opts.spacingMs);
    const r = await get(url);
    const a = { how, url, status: r.status, bytes: r.bytes, ms: r.ms,
                challenged: r.challenged || undefined, error: r.error };
    out.attempts.push(a);
    if (r.challenged) { out.verdict = "walled: " + r.challenged; return out; }
    if (!r.ok || !r.bytes) continue;
    let parsed = null;
    try { parsed = JSON.parse(r.body); } catch { continue; }
    const rows = biggestProductArray(parsed);
    a.products = rows.length;
    if (rows.length > out.found) {
      out.verdict = (rows.length >= 25 ? "server-readable (" + how + ")"
                                       : "partial (" + how + ", " + rows.length + " rows)");
      out.found = rows.length;
      out.sample = rows.slice(0, 3).map(nameOf);
      out.readAt = url;
      if (rows.length >= 25) return out;
    }
  }

  /* NOT ONE VERDICT BUT THREE, and telling them apart is the point. A page that
     rendered fine and simply holds its menu elsewhere is the headless lane; a
     page that would not load at all is a fault to fix; a refusal is the
     operator's. Collapsing these into "failed" is what made the last roster
     look uniform when it was nothing of the kind. */
  if (out.found) return out;                   // a partial is a real finding, keep it
  /* ASKED OF EVERY ATTEMPT, not of one of them. "Did anything here load" is the
     question that separates a shop needing a browser from a shop that is gone,
     and answering it from a single chosen response made a 404 on a guessed path
     outrank a 200 on the real one. */
  const anyLoaded = out.attempts.some(a => a.status === 200 && a.bytes > 0);
  if (out.attempts.some(a => a.status && REFUSAL.has(a.status))) out.verdict = "refused (server said not to you)";
  else if (anyLoaded) out.verdict = "render-needed (page loads, catalogue arrives later)";
  else out.verdict = "unreachable: " + (page.error || ("http " + page.status));
  return out;
}

/* ---- run ----------------------------------------------------------------- */
const wanted = opts.market === "all"
  ? STORES
  : STORES.filter(s => (s.town || "coldwater") === opts.market);
if (!wanted.length) {
  console.log(`No stores on the roster for "${opts.market}". Known markets: ${Object.keys(MARKETS).join(", ")}`);
  process.exit(1);
}

/* EGRESS IS CHECKED AND REPORTED, never assumed. The containers this repo is
   written in refuse every merchant host, so a run from there produces a page of
   timeouts that reads exactly like a page of dead shops -- which is how a
   roster of "unknown" got written in the first place. */
const probe0 = await get("https://example.com/");
const egress = probe0.ok ? "open" : "blocked (" + (probe0.error || probe0.status) + ")";
console.log(`\nCatalogue probe — ${wanted.length} shop(s), market=${opts.market}, egress ${egress}\n`);
if (!probe0.ok) {
  console.log("  Egress is blocked here, so every shop would report a timeout and that would");
  console.log("  be indistinguishable from a shop that is gone. Run this on a machine with");
  console.log("  ordinary network access -- .github/workflows/discover-market.yml does.\n");
  process.exit(3);
}

const results = [];
for (let i = 0; i < wanted.length; i += opts.concurrency) {
  const batch = wanted.slice(i, i + opts.concurrency);
  const got = await Promise.all(batch.map(probeStore));
  for (const g of got) {
    results.push(g);
    const flag = g.found ? "OK  " : (/walled/.test(g.verdict) ? "WALL" : (/render/.test(g.verdict) ? "REND" : "----"));
    console.log(`  ${flag} ${g.key.padEnd(22)} ${g.verdict}${g.found ? "  (" + g.found + " products: " + g.sample.join(" / ") + ")" : ""}`);
    for (const a of g.attempts) {
      console.log(`         · ${String(a.how).padEnd(12)} ${String(a.status).padEnd(4)} ${String(a.bytes).padEnd(8)} ${a.ms}ms` +
                  (a.products != null ? `  products=${a.products}` : "") +
                  (a.challenged ? `  CHALLENGE:${a.challenged}` : "") + (a.error ? `  ${a.error}` : ""));
    }
  }
  if (i + opts.concurrency < wanted.length) await wait(opts.spacingMs);
}

const readable = results.filter(r => r.found >= 25);
const partial = results.filter(r => r.found && r.found < 25);
const walled = results.filter(r => /walled|refused/.test(r.verdict));
const render = results.filter(r => /render/.test(r.verdict));
const dead = results.filter(r => /unreachable|no url|unparseable/.test(r.verdict));

console.log(`\n  ${readable.length} server-readable · ${partial.length} partial · ${render.length} render-needed · ${walled.length} walled or refused · ${dead.length} unreachable\n`);
if (partial.length) {
  /* NAMED SEPARATELY, because this is the most misleading state on the list: a
     page that answers with real products and not enough of them. Reported as
     "server-readable" it looks finished; reported as nothing it looks walled.
     It usually means the menu is one url further in. */
  console.log("  Answered with SOME products — probably a carousel, or the menu is one url deeper:");
  for (const r of partial) console.log(`    ${r.key.padEnd(22)} ${String(r.found).padStart(3)} rows at ${r.readAt || "?"}`);
  console.log("");
}

/* THE PROPOSED PATCH IS PRINTED, NEVER APPLIED. `enabled` means the live path
   will call this shop on every cold request, and one probe answering once is
   not proof an adapter works -- api/coldwater.js needs a reader that agrees
   with the shelf, which is a separate piece of work per platform. What this
   removes is the guessing about WHICH shops are worth that work. */
if (readable.length) {
  console.log("  Worth writing an adapter for (a plain GET returned a catalogue):");
  for (const r of readable) {
    console.log(`    ${r.key.padEnd(22)} ${r.verdict.padEnd(34)} declared="${r.declared}" found=${r.found}`);
  }
  const wrong = readable.filter(r => r.declared && !r.verdict.includes(r.declared));
  if (wrong.length) {
    console.log("\n  DECLARED PLATFORM DISAGREES WITH WHAT ANSWERED — the guess, measured:");
    for (const r of wrong) console.log(`    ${r.key.padEnd(22)} roster says "${r.declared}", answered via ${r.verdict}`);
  }
  console.log("");
}
if (walled.length) {
  console.log("  Operator's lane, permanently (recorded, not worked around):");
  for (const r of walled) console.log(`    ${r.key.padEnd(22)} ${r.verdict}`);
  console.log("");
}
if (opts.json) { writeFileSync(opts.json, JSON.stringify({ market: opts.market, results }, null, 2)); console.log(`  wrote ${opts.json}\n`); }
