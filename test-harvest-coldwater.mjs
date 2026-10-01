/* test-harvest-coldwater.mjs — the scheduled headless lane, end to end.
 *
 * THE ROUND TRIP IS THE POINT. Every earlier check in this repo's history
 * stopped at "the endpoint accepts a POST", and a capture that stores fine but
 * never reaches the shelf is the failure /coldwater has already had twice in
 * other clothes (CLAUDE.md §10). So this drives the real harvester, against a
 * real Chromium, against a fake dispensary on a second port, and then reads the
 * rows back out of the ingest store.
 *
 * It also pins the thing that is unique to this lane and easy to get wrong: a
 * store serving a bot challenge must be reported as WALLED -- not as an error,
 * and above all not as an empty shop. Those three look identical from a row
 * count of zero and need opposite responses.
 *
 *   node test-harvest-coldwater.mjs
 */
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { readFileSync, writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const SITE_PORT = 3530, SHOP_PORT = 3531;
/* Deliberately never bound: this is the unreachable-shop fixture. */
const DEAD_PORT = 3543;
const TOKEN = "test-token-not-a-real-secret";
const fails = [];
const ok = (c, m) => { if (c) console.log("  ok   " + m); else { fails.push(m); console.log("  FAIL " + m); } };

process.env.LL_ADMIN_TOKEN = TOKEN;

/* ------------------------------------------------------------ fake shop --- */
/* A menu with prices in the light DOM, plus a virtualised-ish list, so the
   collector's normal path is what gets exercised rather than a special case. */
const MENU = Array.from({ length: 18 }, (_, i) => ({
  name: ["Blue Dream", "Gelato", "Wedding Cake", "GG4", "Zkittlez", "Runtz"][i % 6] + " " + (i + 1),
  brand: ["Drip", "Old School", "Six Labs"][i % 3],
  price: 20 + i,
  weight: ["1g", "3.5g", "7g", "28g"][i % 4],
  thc: 18 + (i % 12),
}));

const shopHtml = `<!doctype html><html><head><title>Fixture Dispensary Menu</title></head><body>
<h1>Menu</h1><div id="menu">
${MENU.map(p => `
  <article class="product-card">
    <h3 class="name">${p.name}</h3>
    <div class="brand">${p.brand}</div>
    <div class="strain">Hybrid</div>
    <div class="thc">THC ${p.thc}%</div>
    <div class="price">$${p.price}.00</div>
    <div class="weight">${p.weight}</div>
  </article>`).join("")}
</div></body></html>`;

/* A Cloudflare-style interstitial. Text markers only -- the harvester must not
   need a status code to recognise this, because a challenge is served as 200
   more often than not. */
const challengeHtml = `<!doctype html><html><head><title>Just a moment...</title></head>
<body><h1>Checking your browser before accessing</h1>
<p>Please verify you are human. Ray ID: 8fbe000000000000</p></body></html>`;

const shop = createServer((req, res) => {
  const path = (req.url || "/").split("?")[0];
  if (path === "/walled") { res.writeHead(200, { "content-type": "text/html" }); return res.end(challengeHtml); }
  if (path === "/empty") { res.writeHead(200, { "content-type": "text/html" }); return res.end("<!doctype html><html><body><h1>Coming soon</h1></body></html>"); }
  res.writeHead(200, { "content-type": "text/html" });
  res.end(shopHtml);
});
await new Promise(r => shop.listen(SHOP_PORT, r));

/* ------------------------------------------------------------- fake site --- */
/* Only the two routes the harvester touches: the collector file and the ingest
   endpoint. The real handler is imported, not stubbed -- a stub would pass while
   the sanitiser rejected every row. */
const ingest = (await import("./api/coldwater-ingest.js")).default;
const { readIngest, readIngestMany } = await import("./api/coldwater-ingest.js");
const collectorSrc = readFileSync("./public/coldwater-collector.js", "utf8");

const site = createServer(async (req, res) => {
  const path = (req.url || "/").split("?")[0];
  if (path === "/coldwater-collector.js") {
    res.writeHead(200, { "content-type": "application/javascript" });
    return res.end(collectorSrc);
  }
  if (path === "/api/coldwater/ingest") {
    const shim = {
      status: c => ({ send: b => { res.writeHead(c, { "content-type": "application/json" }); res.end(b); } }),
      setHeader: (k, v) => res.setHeader(k, v),
    };
    return ingest(req, shim);
  }
  res.writeHead(404); res.end("nope");
});
await new Promise(r => site.listen(SITE_PORT, r));

/* ------------------------------------------------------------------ run --- */
const dir = mkdtempSync(join(tmpdir(), "llharvest-"));
const storesFile = join(dir, "stores.json");
writeFileSync(storesFile, JSON.stringify([
  { key: "fixture", name: "Fixture Dispensary", menuUrl: `http://127.0.0.1:${SHOP_PORT}/menu`, site: `http://127.0.0.1:${SHOP_PORT}/` },
  { key: "walled", name: "Walled Shop", menuUrl: `http://127.0.0.1:${SHOP_PORT}/walled`, site: `http://127.0.0.1:${SHOP_PORT}/` },
  { key: "emptyshop", name: "Empty Shop", menuUrl: `http://127.0.0.1:${SHOP_PORT}/empty`, site: `http://127.0.0.1:${SHOP_PORT}/` },
  /* A FOURTH OUTCOME THAT USED TO WEAR THE THIRD ONE'S CLOTHES. Nothing listens
     on DEAD_PORT, so every navigation fails outright. That is neither a wall
     (nothing declined us) nor an empty shop (nothing was read) -- it is the run
     being broken, and it used to report as `empty`, the one verdict that sends
     you to go and look at the shop. Measured against seven real Coldwater shops
     from a container with no egress: six `empty`, one tripped the location
     guard, and not one of them said the page had failed to load. */
  { key: "deadhost", name: "Unreachable Shop", menuUrl: `http://127.0.0.1:${DEAD_PORT}/menu`, site: `http://127.0.0.1:${DEAD_PORT}/` },
]));

const run = () => new Promise(resolve => {
  const p = spawn(process.execPath, [
    "tools/harvest-coldwater.mjs",
    "--site", `http://127.0.0.1:${SITE_PORT}`,
    "--token", TOKEN,
    "--stores", storesFile,
    "--concurrency", "1",
    "--spacing", "200",
    "--settle", "12000",
  ], { stdio: ["ignore", "pipe", "pipe"] });
  let out = "", err = "";
  p.stdout.on("data", d => { out += d; });
  p.stderr.on("data", d => { err += d; });
  p.on("close", code => resolve({ code, out, err }));
});

console.log("\nrunning the harvester against the fixture shop (this launches Chromium)...\n");
const r = await run();
process.stdout.write(r.out);
if (r.err.trim()) console.log("stderr: " + r.err.trim().slice(0, 500));

console.log("\nassertions");

/* --- the readable shop --- */
ok(/ok\s+fixture\s+\d+ rows/.test(r.out), "the readable shop reports rows");
const m = r.out.match(/ok\s+fixture\s+(\d+) rows/);
const got = m ? Number(m[1]) : 0;
ok(got > 0, `harvested ${got} rows from the fixture menu`);

/* --- the wall, which is the assertion this file exists for --- */
ok(/WALLED\s+walled/.test(r.out), "a bot challenge is reported as WALLED");
ok(!/ERROR\s+walled/.test(r.out), "...and NOT as an error");
ok(!/empty\s+walled/.test(r.out), "...and NOT as an empty shop");
ok(/manual lane \(served a challenge\)/.test(r.out), "walled stores are printed as a manual-lane worklist");
ok(/walled/.test((r.out.match(/manual lane \(served a challenge\): (.*)/) || [])[1] || ""), "the walled store is named in that worklist");

/* --- a page that never loaded is not an empty shop -------------------------
   The distinction this file exists for, extended: walled, empty and errored
   need opposite responses, and a failed navigation belongs to the third. It
   must ALSO be fast -- the old path spent the full settle cap scanning a
   browser error page, which is how seven unreachable shops took 85 seconds. */
ok(/ERROR\s+deadhost/.test(r.out), "a page that never loaded is reported as an error");
ok(/deadhost.*navigation failed/.test(r.out) || /navigation failed[^;]*/.test(r.out),
   "...and the reason names the navigation, not the shop");
ok(!/empty\s+deadhost/.test(r.out), "...and NOT as an empty shop");
ok(!/WALLED\s+deadhost/.test(r.out), "...and NOT as a wall");
const dm = r.out.match(/ERROR\s+deadhost\s+\d+ rows\s+(\d+)ms/);
ok(dm && Number(dm[1]) < 8000, `...and it gives up quickly rather than scanning an error page (${dm ? dm[1] + "ms" : "no match"})`);

/* --- a genuinely empty shop is its own third thing --- */
ok(/empty\s+emptyshop/.test(r.out), "a served-but-productless page is 'empty', distinct from walled and from error");

/* --- the round trip: did it actually land, and in the right lane --- */
const stored = await readIngest("fixture", "coldwater");
ok(!!stored, "the capture is readable back out of the ingest store");
ok(stored && stored.products.length > 0, `${stored ? stored.products.length : 0} products came back out`);
ok(!!(stored && stored.collections.indexOf("headless") >= 0), "it landed in the 'headless' collection");
ok(!!(stored && stored.lanes && stored.lanes.some(l => l.lane === "headless")),
   "and readIngest reports its lane as 'headless', NOT manual");

/* The whole ladder turns on this: a robot must not post into the operator's
   lane. Defaulting is correct for legacy records and wrong for this writer. */
const laneNames = (stored && stored.lanes || []).map(l => l.lane);
ok(laneNames.indexOf("manual") < 0, "the harvester did NOT write into the manual lane");

/* --- nothing was posted for the shops that had nothing to post --- */
const walledStored = await readIngest("walled", "coldwater");
ok(!walledStored || !walledStored.products.length, "nothing is stored for a challenged shop");
const emptyStored = await readIngest("emptyshop", "coldwater");
ok(!emptyStored || !emptyStored.products.length, "nothing is stored for an empty shop — an empty harvest never overwrites");

/* --- the batch must not leak between stores ---------------------------------
   All three fixture shops share one origin, which is exactly the shape of a
   chain under one domain: Lume runs 38 Michigan stores on www.lume.com. The
   collector keeps its batch in localStorage so an operator can work a paginated
   menu category by category and have the rows add up -- correct for a human,
   wrong for a scheduled run, where it means store B posts store A's menu. This
   caught it: the "Coming soon" page reported the fixture shop's 18 products. */
ok(!/ok\s+emptyshop\s+[1-9]/.test(r.out), "the empty shop did not inherit the previous store's rows");
const leaked = await readIngest("emptyshop", "coldwater");
ok(!leaked || !leaked.products.length, "and nothing of the fixture shop's menu was stored against it");

/* --- shape of what landed --- */
if (stored && stored.products.length) {
  const p = stored.products[0];
  ok(typeof p.name === "string" && p.name.length > 0, "captured rows carry a name");
  const anyPriced = stored.products.some(x => (x.sizes || []).some(z => z.price != null) || x.price != null);
  ok(anyPriced, "captured rows carry a price");
}

/* --- the batched reader must AGREE with the per-key one -----------------------
   /api/coldwater reads captures for the whole roster in one round trip now
   rather than one per shop. Two readers that fetch differently AND shape
   differently would be two answers to "is this capture expired", and the one on
   the hot path is the one nobody tests. Shaping is shared; only fetching
   differs, and this is what holds that true. */
const many = await readIngestMany(["fixture", "walled", "emptyshop", "neverheardof"]);
const one = await readIngest("fixture", "coldwater");
ok(many instanceof Map, "readIngestMany returns a Map keyed by store");
ok(!!many.get("fixture"), "the stored store is present in the batch");
ok(!many.has("neverheardof"), "an unknown store is absent rather than null-filled");
ok(!many.has("walled") && !many.has("emptyshop"), "stores with nothing stored are absent");
ok(JSON.stringify(many.get("fixture").products) === JSON.stringify(one.products),
   "batched and per-key reads return identical products");
ok(many.get("fixture").capturedAt === one.capturedAt, "...and identical capturedAt");
ok(JSON.stringify((many.get("fixture").lanes || []).map(l => l.lane))
   === JSON.stringify((one.lanes || []).map(l => l.lane)), "...and identical lanes");
ok(readIngestMany([]) instanceof Promise, "an empty roster is a no-op, not a crash");
ok((await readIngestMany([])).size === 0, "...returning an empty Map");

console.log("");
shop.close(); site.close();
if (fails.length) { console.log(`FAILED — ${fails.length} assertion(s)\n`); process.exit(1); }
console.log("All assertions passed.\n");
process.exit(0);
