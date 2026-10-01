/* Runs the real /api/coldwater handler against a REAL Lume Coldwater page.
 *
 * The fixture is a saved copy of what www.lume.com/shop/all served, so this
 * exercises the actual field mapping rather than a shape someone imagined --
 * which matters here, because dutchie.com and lume.com are both refused by the
 * proxy in the containers this repo is edited from and the adapters could not
 * otherwise be tested at all.
 *
 * Point LUME_FIXTURE at a saved page to re-run it after Lume changes their site:
 *   LUME_FIXTURE=/path/to/lume.html node test-coldwater-lume.mjs
 */
import { readFileSync, existsSync } from "node:fs";

const FIXTURE = process.env.LUME_FIXTURE
  || "/root/.claude/uploads/0f128057-2f3c-5deb-a45a-cc3ddb1b8e3a/3dd295b1-lume.html";

if (!existsSync(FIXTURE)) {
  console.log(`SKIP — no Lume fixture at ${FIXTURE}\n(set LUME_FIXTURE to a saved www.lume.com/shop/all page)`);
  process.exit(0);
}
const html = readFileSync(FIXTURE, "utf8");

const fails = [];
const ok = (n, c, x = "") => { console.log(`${c ? "  PASS" : "  FAIL"}  ${n}${x ? "   (" + x + ")" : ""}`); if (!c) fails.push(n); };

/* Serve the fixture for lume.com and refuse everything else, so a store that is
   meant to be off cannot quietly reach the network during a test run. */
const realFetch = globalThis.fetch;
let lumeHits = 0, otherHosts = [];
globalThis.fetch = async (url, init) => {
  const u = String(url);
  if (u.includes("lume.com")) {
    lumeHits++;
    return new Response(html, { status: 200, headers: { "content-type": "text/html" } });
  }
  otherHosts.push(u);
  return new Response("blocked by test", { status: 503 });
};

const mod = await import("./api/coldwater.js");
const { STORES } = mod;

const lume = STORES.find(s => s.key === "lume");
lume.enabled = true;                       // the fixture stands in for the cookie
STORES.filter(s => s.key !== "lume").forEach(s => { s.enabled = false; });

function run(query) {
  return new Promise(resolve => {
    const res = {
      statusCode: 200, headers: {},
      setHeader(k, v) { this.headers[k] = v; },
      status(c) { this.statusCode = c; return this; },
      send(body) { resolve({ status: this.statusCode, body }); return this; },
      json(o) { return this.send(JSON.stringify(o)); },
    };
    mod.default({ query }, res);
  });
}

console.log("\n/api/coldwater — Lume adapter against a real saved menu\n");

const { status, body } = await run({ refresh: "1" });
const data = JSON.parse(body);
ok("responds 200", status === 200);
ok("fetched lume.com exactly once", lumeHits === 1, `${lumeHits} hits`);
ok("no other host contacted", otherHosts.length === 0, otherHosts.slice(0, 2).join(","));
ok("did NOT fall back to the demo fixture", data.meta.demo === false, JSON.stringify(data.meta.stores));
ok("parsed the full catalogue", data.products.length > 900, `${data.products.length} products`);

const p = data.products.find(x => x.sizes[0][1] != null && x.potency);
ok("store attributed to Lume", p.store === "Lume Cannabis", p.store);
ok("price converted from cents", p.sizes[0][1] > 0 && p.sizes[0][1] < 1000, String(p.sizes[0][1]));
ok("potency carried", p.potency > 0 && p.potency <= 100, String(p.potency));
ok("product url absolute", /^https:\/\/www\.lume\.com\//.test(p.url), p.url.slice(0, 60));
ok("image url present", /^https:\/\//.test(p.image), p.image.slice(0, 50));

const withBatch = data.products.filter(x => x.batch);
ok("Metrc batch tag preserved", withBatch.length > 500, `${withBatch.length} of ${data.products.length}`);
ok("batch looks like a Metrc tag", /^1A[0-9A-Z]{10,}$/.test(withBatch[0].batch), withBatch[0].batch);
ok("packaged date preserved", data.products.filter(x => x.packagedDate).length > 500);

const grammed = data.products.filter(x => x.perG != null);
ok("per-gram computed where size is known", grammed.length > 100, `${grammed.length} products`);
ok("per-gram is plausible", grammed.every(x => x.perG > 0 && x.perG < 500));

const flagged = data.products.filter(x => x.subTags && x.subTags.trim);
console.log(`         (${flagged.length} rows flagged trim/shake)`);

ok("cannabinoid matches the engine's filter vocabulary",
   data.products.every(x => ["THCa", "CBD", "Botanical"].includes(x.cannabinoid)));
ok("every product carries a link back to the shop", data.products.every(x => !!x.url));

/* The guard that matters most: a wrong or missing store cookie must fail loudly
   rather than publish another town's prices under a Coldwater heading. */
lume.expectLocation = "Kalamazoo";
const wrong = JSON.parse((await run({ refresh: "1", debug: "1" })).body);
const err = (wrong.meta.stores[0] || {}).err || "";
ok("refuses a mismatched store", /wrong store/.test(err) || wrong.meta.demo === true, err.slice(0, 90));
lume.expectLocation = "Coldwater";

globalThis.fetch = realFetch;
console.log(`\n${fails.length ? "FAILED: " + fails.join(", ") : "All assertions passed."}\n`);
process.exit(fails.length ? 1 : 0);
