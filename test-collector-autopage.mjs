/* test-collector-autopage.mjs — the pager, and the guards that decide what
 * reaches the shelf.
 *
 *   node test-collector-autopage.mjs
 *
 * TWO HALVES, ON PURPOSE, because they answer two different questions and only
 * one of them needs a browser.
 *
 *   1. THE GUARDS, in plain node. These are the only code in the scheduled lane
 *      that decides whether a capture is published, and they are the only code
 *      in it that cannot be verified by watching a run succeed -- a guard that
 *      never fires looks exactly like a guard that works. Every fixture here is
 *      a real failure this project shipped: Exclusive's 697 rows of nav copy,
 *      Sapura's menu under Exclusive's key, a truncated Jane scan, a count
 *      larger than the shop's own.
 *
 *   2. THE PAGER, in real Chromium against a real paginated menu. This is the
 *      regression that matters most and it is invisible from every other angle:
 *      a menu of four pages read without a pager returns page one, reports a
 *      confident count of it, passes every shape check, and publishes a quarter
 *      of the shop as the whole shop. The assertion is a NUMBER -- 40, not 10 --
 *      because that is the only thing that can tell those two apart.
 *
 * The second half also drives the two guards end to end through the real
 * harvester, since "the function returns problems" and "the run refuses to
 * publish" are different claims and only the second one protects the shelf.
 */
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { readFileSync, writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { guards, policyFor, nameSet } from "./tools/harvest-guards.mjs";

const SITE_PORT = 3533, SHOP_PORT = 3534;
const TOKEN = "test-token-not-a-real-secret";
/* The ingest endpoint fails CLOSED without this, by design (§9): an
   unconfigured deploy must not have its catalogue written by a stranger. The
   suite runs the real handler in-process, so it has to be configured like a
   real one or every round-trip assertion fails for the wrong reason. */
process.env.LL_ADMIN_TOKEN = TOKEN;
const fails = [];
const ok = (c, m, x = "") => {
  if (c) console.log("  ok   " + m + (x ? "   (" + x + ")" : ""));
  else { fails.push(m); console.log("  FAIL " + m + (x ? "   (" + x + ")" : "")); }
};

/* ══════════════════════════════ 1 · the guards, with no browser ═══════════ */

console.log("\nguards — every fixture is a failure this project actually shipped\n");

const rows = (n, f = () => ({})) =>
  Array.from({ length: n }, (_, i) => ({
    name: `Product ${i}`,
    url: `https://shop.example/p/${i}`,
    sizes: [{ label: "1g", price: 10, grams: 1 }],
    image: "x",
    ...f(i),
  }));

{
  const g = guards({ key: "unknown-shop" }, rows(50), { via: "page state" }, {});
  ok(g.ok, "a clean capture from an unpoliced shop publishes");
  ok(g.problems.length === 0, "...with no problems raised");
}

{
  /* Green Tree at 29 rows is the Jane virtualisation truncation. The floor is
     set above the historical bad number precisely so a repeat of it fails
     rather than quietly re-publishing. */
  const g = guards({ key: "greentree" }, rows(29), { via: "React props" }, {});
  ok(!g.ok, "a truncated Jane scan is blocked at 29 rows");
  ok(/expected at least 60/.test(g.problems.join(" ")), "...naming the floor it missed");
}

{
  /* Dutchie's React props carry no per-product link, so a perfectly good
     700-row capture scores ONE distinct url. This must warn and publish: making
     it a problem would block Sapura every night and teach whoever is on call to
     pass --force, which switches off every other guard here. */
  const g = guards(
    { key: "sapura" },
    rows(692, () => ({ url: "https://dutchie.com/embedded-menu/x/products" })),
    { via: "React props" },
    {}
  );
  ok(g.ok, "Dutchie's missing per-row urls do NOT block the send");
  ok(/distinct urls/.test(g.warnings.join(" ")), "...but are warned about");
}

{
  /* The 697 rows of `Name Z - A`, `SPECIAL OFFER` and `MARKET`. */
  const g = guards(
    { key: "exclusive" },
    rows(697, () => ({ url: "https://www.exclusivemi.com/shop/?pagination=12" })),
    { via: "printed text" },
    {}
  );
  ok(!g.ok, "Exclusive's printed-text furniture is blocked");
  ok(/refuses unattended/.test(g.problems.join(" ")), "...because the layer is refused for this shop");
}

{
  /* The same printed-text layer at a shop with no better option is allowed --
     the refusal is per shop, not global, because for a closed shadow root the
     painted text is honestly all there is. */
  const g = guards({ key: "dude" }, rows(200), { via: "printed text" }, {});
  ok(g.ok, "the same layer publishes at a shop that has no better one");
}

{
  /* THE SAPURA/EXCLUSIVE BUG IN ITS GENERAL FORM. Both captures are internally
     perfect; nothing else in the pipeline compares two shops to each other. */
  const g = guards({ key: "exclusive" }, rows(698), { via: "React props" }, { sapura: nameSet(rows(698)) });
  ok(!g.ok, "one shop's menu under another shop's key is blocked");
  ok(/wrong shelf/.test(g.problems.join(" ")), "...naming the shop it collides with");
}

{
  /* Two shops legitimately stocking some of the same brands must not collide. */
  const overlapping = rows(100, (i) => ({ name: i < 30 ? `Shared ${i}` : `Mine ${i}` }));
  const other = nameSet(rows(100, (i) => ({ name: i < 30 ? `Shared ${i}` : `Theirs ${i}` })));
  const g = guards({ key: "unknown-shop" }, overlapping, { via: "page state" }, { herbology: other });
  ok(g.ok, "30% shared brand names between two real shops is not a collision", g.problems.join("; "));
}

{
  const g = guards({ key: "unknown-shop" }, rows(170), { via: "page state", shopSays: 118 }, {});
  ok(!g.ok, "more rows than the shop publishes is blocked");
  ok(/not products/.test(g.problems.join(" ")), "...saying how many are not products");
}

{
  const noWeights = rows(60, () => ({ sizes: [{ label: "One Size", price: 20, grams: 0 }] }));
  const g = guards({ key: "unknown-shop" }, noWeights, { via: "page state" }, {});
  ok(g.ok, "a shop with no weights still publishes");
  ok(/price-per-gram will not compute/.test(g.warnings.join(" ")), "...with the missing per-gram called out");
}

ok(policyFor("lume").expectText instanceof RegExp, "the chain shop carries an expectText guard");
ok(policyFor("nobody-in-particular").expectMin === 1, "an unpoliced shop is not blocked by a floor nobody measured");

/* ══════════════════════ 2 · the pager, in real Chromium ══════════════════ */

console.log("\npager and guards, end to end through the real harvester\n");

/* FOUR PAGES OF TEN. Read without a pager this menu reports 10 and looks
   entirely healthy -- which is the whole point of asserting on 40. Paging is
   client-side, with no navigation, because that is what these menus do: the
   click returns instantly and the rows are swapped in place. */
const PAGES = 4, PER_PAGE = 10;
const pagerHtml = `<!doctype html><html><head><title>Pager Dispensary</title></head><body>
<h1>Menu</h1><div id="menu"></div>
<nav><button id="prev">Prev</button><span id="pg">1</span><button id="next" aria-label="Next page">Next</button></nav>
<script>
var PAGES=${PAGES}, PER=${PER_PAGE}, page=1;
function render(){
  var out="";
  for(var i=0;i<PER;i++){
    var n=(page-1)*PER+i;
    out+='<article class="product-card">'+
      '<a class="name" href="/p/'+n+'"><h3>Pager Strain '+n+'</h3></a>'+
      '<div class="brand">Fixture Farms</div>'+
      '<div class="strain">Hybrid</div>'+
      '<div class="thc">THC '+(18+(n%12))+'%</div>'+
      '<div class="price">$'+(20+n)+'.00</div>'+
      '<div class="weight">3.5g</div>'+
      '</article>';
  }
  document.getElementById("menu").innerHTML=out;
  document.getElementById("pg").textContent=String(page);
  /* A DISABLED NEXT IS THE LAST PAGE SAYING SO, which is what nextControl()
     reads rather than counting clicks. */
  document.getElementById("next").disabled = (page>=PAGES);
}
document.getElementById("next").onclick=function(){ if(page<PAGES){ page++; render(); } };
render();
</script></body></html>`;

/* Twelve products, served under two different store keys — the shape of the
   Sapura/Exclusive bug, driven through the real run rather than asserted on a
   function's return value. */
const twinHtml = `<!doctype html><html><head><title>Twin Dispensary</title></head><body>
<h1>Menu</h1><div id="menu">
${Array.from({ length: 12 }, (_, i) => `
  <article class="product-card">
    <a class="name" href="/t/${i}"><h3>Twin Strain ${i}</h3></a>
    <div class="brand">Twin Farms</div>
    <div class="strain">Indica</div>
    <div class="thc">THC ${20 + i}%</div>
    <div class="price">$${25 + i}.00</div>
    <div class="weight">3.5g</div>
  </article>`).join("")}
</div></body></html>`;

const shop = createServer((req, res) => {
  const path = (req.url || "/").split("?")[0];
  res.writeHead(200, { "content-type": "text/html" });
  if (path === "/pager") return res.end(pagerHtml);
  return res.end(twinHtml);
});
await new Promise((r) => shop.listen(SHOP_PORT, r));

/* The REAL ingest handler, not a stub — a stub would pass happily while the
   sanitiser rejected every row. */
const ingest = (await import("./api/coldwater-ingest.js")).default;
const { readIngest } = await import("./api/coldwater-ingest.js");
const collectorSrc = readFileSync("./public/coldwater-collector.js", "utf8");

const site = createServer(async (req, res) => {
  const path = (req.url || "/").split("?")[0];
  if (path === "/coldwater-collector.js") {
    res.writeHead(200, { "content-type": "application/javascript" });
    return res.end(collectorSrc);
  }
  if (path === "/api/coldwater/ingest") {
    const shim = {
      status: (c) => ({ send: (b) => { res.writeHead(c, { "content-type": "application/json" }); res.end(b); } }),
      setHeader: (k, v) => res.setHeader(k, v),
    };
    return ingest(req, shim);
  }
  res.writeHead(404);
  res.end("nope");
});
await new Promise((r) => site.listen(SITE_PORT, r));

const dir = mkdtempSync(join(tmpdir(), "llpager-"));
const storesFile = join(dir, "stores.json");
writeFileSync(
  storesFile,
  JSON.stringify([
    { key: "pagershop", name: "Pager Dispensary", menuUrl: `http://127.0.0.1:${SHOP_PORT}/pager` },
    { key: "twina", name: "Twin A", menuUrl: `http://127.0.0.1:${SHOP_PORT}/twin` },
    { key: "twinb", name: "Twin B", menuUrl: `http://127.0.0.1:${SHOP_PORT}/twin` },
    /* Real store key, so it inherits the real 60-row floor and cannot meet it. */
    { key: "greentree", name: "Thin Shop", menuUrl: `http://127.0.0.1:${SHOP_PORT}/twin` },
  ])
);

console.log("running the harvester against the fixture shops (this launches Chromium)...\n");
const r = await new Promise((resolve) => {
  const p = spawn(
    process.execPath,
    [
      "tools/harvest-coldwater.mjs",
      "--site", `http://127.0.0.1:${SITE_PORT}`,
      "--token", TOKEN,
      "--stores", storesFile,
      /* ONE AT A TIME. The cross-shop guard compares against shops already read
         in this run, so a strict pass needs a deterministic order. */
      "--concurrency", "1",
      "--spacing", "200",
      "--settle", "20000",
      "--paged-settle", "90000",
    ],
    { stdio: ["ignore", "pipe", "pipe"] }
  );
  let out = "", err = "";
  p.stdout.on("data", (d) => { out += d; });
  p.stderr.on("data", (d) => { err += d; });
  p.on("close", (code) => resolve({ code, out, err }));
});
process.stdout.write(r.out);
if (r.err.trim()) console.log("stderr: " + r.err.trim().slice(0, 500));

console.log("\nassertions\n");

/* --- the pager, which is what this file exists for --- */
const pm = r.out.match(/ok\s+pagershop\s+(\d+) rows/);
const pagerRows = pm ? Number(pm[1]) : 0;
ok(pagerRows === PAGES * PER_PAGE, `the paginated menu yields all ${PAGES * PER_PAGE} rows, not one page`, `${pagerRows} rows`);
ok(pagerRows > PER_PAGE, "...which is strictly more than a single unpaged scan returns");
/* The harvester names the entry point it used: `all` (tabs -> pages -> scroll),
   `page`, or `scan` on a collector too old to expose the others. Anything but
   `scan` means the pager was available, which is what this fixture needs. */
ok(/ok\s+pagershop\s+\d+ rows\s+\d+ms\s+(all|page)\b/.test(r.out),
   "the run reports it drove more than a single-page scan",
   (r.out.match(/ok\s+pagershop[^\n]*/) || [""])[0].slice(-40));

const storedPager = await readIngest("pagershop", "coldwater");
ok(!!storedPager && storedPager.products.length === PAGES * PER_PAGE,
   "and all four pages reached the shelf", `${storedPager ? storedPager.products.length : 0} stored`);

/* Every page's products, not four copies of page one — the failure a row count
   alone cannot distinguish from a working pager. */
if (storedPager) {
  const names = new Set(storedPager.products.map((p) => p.name));
  ok(names.has("Pager Strain 0"), "page one's products are present");
  ok(names.has("Pager Strain 35"), "and page four's are too");
  ok(names.size === PAGES * PER_PAGE, "with no duplicates — the batch merged rather than repeated");
}

/* --- the cross-shop guard, end to end --- */
ok(/ok\s+twina/.test(r.out), "the first of two identical shops publishes");
ok(/BLOCKED\s+twinb/.test(r.out), "the second is BLOCKED, not published");
ok(/wrong shelf/.test(r.out), "...naming the collision");
const storedTwinB = await readIngest("twinb", "coldwater");
ok(!storedTwinB || !storedTwinB.products.length, "and nothing was stored for it — the guard protected the shelf, not just the log");

/* --- the floor guard, end to end --- */
ok(/BLOCKED\s+greentree/.test(r.out), "a capture under the floor is BLOCKED");
const storedThin = await readIngest("greentree", "coldwater");
ok(!storedThin || !storedThin.products.length, "and nothing was stored for it either");

ok(/blocked by guards/.test(r.out), "blocked shops are printed as a worklist with the reason");

shop.close();
site.close();

console.log("\n" + (fails.length ? `FAILED (${fails.length})\n  ` + fails.join("\n  ") : "All assertions passed.") + "\n");
process.exit(fails.length ? 1 : 0);
