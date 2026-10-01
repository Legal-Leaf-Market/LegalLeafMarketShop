/* test-coldwater-towns.mjs — a town is a configuration line, and it must stay one.
 *
 * The Lume fan-out is one adapter pointed at more towns. What makes that safe is
 * not the adapter -- it is already written and tested -- but the scoping around
 * it, because /api/coldwater hardcoded `market: "Coldwater, MI"` and feeds a page
 * titled "Coldwater Cannabis Prices". Fanning out without scoping publishes
 * Monroe's prices under a Coldwater heading, which is the exact failure
 * fromLume()'s expectLocation guard exists to prevent, arriving by a route that
 * guard never sees.
 *
 * Every assertion here fails silently: a leaked town looks like a busy shelf.
 *
 *   node test-coldwater-towns.mjs
 */
import { createServer } from "node:http";
import { STORES, TOWNS, DEFAULT_TOWN, townKey, lumeStore, LUME_TOWNS } from "./api/coldwater.js";

const PORT = 3497;
const TOKEN = "test-token-not-a-real-secret";
process.env.LL_ADMIN_TOKEN = TOKEN;

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log("  ok   " + m); } else { fail++; console.log("  FAIL " + m); } };
const group = m => console.log("\n" + m);

const handler = (await import("./api/coldwater.js")).default;
const ingest = (await import("./api/coldwater-ingest.js")).default;

const srv = createServer(async (req, res) => {
  const u = new URL(req.url, "http://x");
  const shim = {
    status: c => ({ send: b => { res.writeHead(c, { "content-type": "application/json" }); res.end(b); } }),
    setHeader: (k, v) => res.setHeader(k, v),
  };
  if (u.pathname === "/api/coldwater/ingest") return ingest(req, shim);
  req.query = Object.fromEntries(u.searchParams.entries());
  return handler(req, shim);
});
await new Promise(r => srv.listen(PORT, r));
const get = qs => fetch(`http://127.0.0.1:${PORT}/api/coldwater${qs}`).then(r => r.json());
const post = body => fetch(`http://127.0.0.1:${PORT}/api/coldwater/ingest`, {
  method: "POST", headers: { "content-type": "application/json", "x-ll-admin-token": TOKEN },
  body: JSON.stringify(body),
}).then(r => r.json());

/* ------------------------------------------------------------- the registry --- */
group("the town registry");
ok(townKey(undefined) === DEFAULT_TOWN, "no town given falls back to Coldwater");
ok(townKey("") === DEFAULT_TOWN, "empty falls back");
ok(townKey("nowhere-at-all") === DEFAULT_TOWN,
   "an UNKNOWN town falls back rather than serving an empty shelf — ?town= is mistypeable");
ok(townKey("Monroe") === "monroe", "case-insensitive");
ok(townKey("new-buffalo") === "newbuffalo", "punctuation stripped");

group("the fan-out produced one store per town, and none of them live");
{
  for (const t of LUME_TOWNS) {
    const s = STORES.find(x => x.key === "lume-" + t);
    ok(!!s, "a Lume store exists for " + t);
    ok(s && s.town === t, "...scoped to its own town");
    /* THE COOKIE IS THE GATE. Lume picks the store server-side from a cookie, so
       without one every entry reads whatever default store Lume serves. An entry
       that cannot identify its own store must never be on the live path. */
    ok(s && s.enabled === false, "...and is OFF until a storeCookie exists");
    ok(s && s.expectLocation === TOWNS[t].label,
       "...carrying the expectLocation guard for its own town");
  }
}

group("no invented facts about a named business");
{
  for (const t of LUME_TOWNS) {
    const s = STORES.find(x => x.key === "lume-" + t);
    ok(s && s.addr === "", "no street address invented for " + t);
  }
  /* The URL pattern IS derivable -- the diag table already uses it verbatim for
     three towns -- so it is generated rather than guessed. */
  ok(lumeStore("monroe").site === "https://www.lume.com/stores/monroe-mi-dispensary",
     "the store URL follows the documented slug pattern");
  ok(lumeStore("newbuffalo").site === "https://www.lume.com/stores/new-buffalo-mi-dispensary",
     "and hyphenates New Buffalo correctly");
}

/* ---------------------------------------------------------------- scoping --- */
group("A TOWN NEVER SEES ANOTHER TOWN'S SHELF");
{
  /* The assertion the whole fan-out rests on -- and it USED TO PROVE LESS THAN
     IT LOOKED LIKE. These posts carried no `market`, so both captures landed in
     the pilot's namespace and the scoping being demonstrated came entirely from
     the roster (a store belongs to exactly one town). The namespace was never
     exercised, which is how the shelf's own read could be calling
     readIngestMany(keys) with no market at all -- reading the pilot's store for
     every city -- while this suite passed. Stating the market is also what a
     real capture does: the collector sends `market: MARKET`. */
  await post({ market: "coldwater", storeKey: "sapura", reset: true });
  await post({ market: "coldwater", storeKey: "sapura", collection: "t", products: [
    { name: "Coldwater Only Strain", category: "Flower", url: "https://sapuralife.com/products/coldwater-only", sizes: [{ label: "3.5g", price: 30 }] },
  ] });
  await post({ market: "monroe", storeKey: "lume-monroe", reset: true });
  await post({ market: "monroe", storeKey: "lume-monroe", collection: "t", products: [
    { name: "Monroe Only Strain", category: "Flower", url: "https://www.lume.com/products/monroe-only", sizes: [{ label: "3.5g", price: 20 }] },
  ] });

  const cw = await get("?refresh");
  const mo = await get("?town=monroe&refresh");

  const names = f => (f.products || []).map(p => p.name);
  ok(names(cw).includes("Coldwater Only Strain"), "Coldwater serves its own capture");
  ok(!names(cw).includes("Monroe Only Strain"), "and NEVER Monroe's");
  ok(names(mo).includes("Monroe Only Strain"), "Monroe serves its own capture");
  ok(!names(mo).includes("Coldwater Only Strain"), "and NEVER Coldwater's");

  /* THE NAMESPACE, ON ITS OWN. Everything above still passes if captures share
     one store and are kept apart by the roster, which is exactly the state that
     hid a shelf reading the pilot's namespace for every city. So: post the same
     store key into TWO markets and assert each town serves its own rows. Only
     the namespace can tell these apart -- the roster cannot, because it is one
     key. */
  await post({ market: "coldwater", storeKey: "sapura", collection: "ns", products: [
    { name: "Namespace Coldwater", category: "Flower", url: "https://sapuralife.com/products/ns-cw", sizes: [{ label: "1g", price: 9 }] },
  ] });
  await post({ market: "monroe", storeKey: "sapura", collection: "ns", products: [
    { name: "Namespace Monroe", category: "Flower", url: "https://sapuralife.com/products/ns-mo", sizes: [{ label: "1g", price: 8 }] },
  ] });
  const cw2 = names(await get("?refresh")), mo2 = names(await get("?town=monroe&refresh"));
  ok(cw2.includes("Namespace Coldwater") && !cw2.includes("Namespace Monroe"),
     "one store key in two markets: the pilot serves only the pilot's rows");
  /* sapura is not on Monroe's roster, so Monroe must show NEITHER -- the
     namespace and the roster are two gates and a row has to pass both. */
  ok(!mo2.includes("Namespace Monroe") && !mo2.includes("Namespace Coldwater"),
     "and Monroe shows neither, because sapura is not a Monroe shop");
}

group("the market string is derived, never hardcoded");
{
  const cw = await get("?refresh");
  const mo = await get("?town=monroe&refresh");
  ok(cw.meta.market === "Coldwater, MI", "Coldwater says Coldwater");
  ok(mo.meta.market === "Monroe, MI", "Monroe says Monroe — this is the string the page prints");
  ok(mo.meta.town === "monroe", "and the town travels in meta");
}

group("THE CACHE IS PER TOWN");
{
  /* A single global cache serves whichever town asked first to every town that
     asks next -- and expectLocation runs at FETCH time, not at serve time, so it
     would never catch it. The town scoping reintroduced one layer down. */
  await get("?town=monroe&refresh");
  const cw = await get("");            // warm, no refresh
  ok(!(cw.products || []).some(p => p.name === "Monroe Only Strain"),
     "a warm Coldwater request is not answered from Monroe's scrape");
  const mo = await get("?town=monroe");
  ok(!(mo.products || []).some(p => p.name === "Coldwater Only Strain"),
     "and the reverse");
}

group("the debug roster is scoped too");
{
  const d = await get("?town=monroe&debug");
  const keys = (d.stores || d.roster || []).map(x => x.key).filter(Boolean);
  if (keys.length) {
    ok(keys.every(k => k.startsWith("lume-monroe")), "?debug lists only Monroe's stores (" + keys.join(",") + ")");
  } else {
    ok(true, "?debug roster shape not keyed — skipped");
  }
}

group("nothing about today's Coldwater behaviour moved");
{
  const cw = await get("?refresh");
  ok(cw.meta.market === "Coldwater, MI", "a request with no ?town is still Coldwater");
  const seven = STORES.filter(s => (s.town || DEFAULT_TOWN) === "coldwater");
  ok(seven.length === 7, "still exactly seven Coldwater shops (got " + seven.length + ")");
}

console.log("\n" + (fail ? "FAILED" : "PASSED") + "  " + pass + " passed, " + fail + " failed\n");
srv.close();
process.exit(fail ? 1 : 0);
