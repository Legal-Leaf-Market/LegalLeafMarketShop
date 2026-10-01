/* Eight gear buckets, not sixteen.

   Reported as "the categories are too granular now on the accessories and
   devices ... rethink to be more condensed like the dispensary side".

   TWO CATALOGUES MEET ON ONE SHELF and each brought its own vocabulary.
   api/products.js classified gear into eleven buckets; the engine's BAKED GREEK
   GLASS SEED -- 85 products inside the blob -- carries eleven more, and the
   engine passes accessory categories straight through. So #fCategory showed
   both lists at once: Rigs beside Bongs & Rigs, Terp Accessories beside Parts &
   Tools, and buckets nobody could shop. `Tools` held ONE product. `Ash
   Catchers` held two. That is the failure api/coldwater.js writes up for
   Edibles -- "four thin filter entries where two of them held one and two
   products" -- and the rule it settled on is the one applied here: the FILTER
   wants the fewest useful buckets.

   THE DISPENSARY'S OWN ANSWER IS ONE BUCKET AND IT IS WRONG HERE. A Coldwater
   shop sells twenty accessories. This site sells ~1,500 across six stores, and
   one chip holding 1,500 products is not a filter. So the principle travels and
   the list does not.

   WHAT THIS PINS, and why each half needs its own kind of check:

   1. THE FEED'S HALF, in plain node. Not one regex changed -- only the labels
      moved -- so the strong assertion is that every rung still catches exactly
      what it caught, which is checked by driving real product names through the
      real classifier rather than by reading the source.

   2. THE SEED'S HALF, in real Chromium, because it cannot be checked any other
      way: public/js/gear-categories.js works through the engine's own manual
      category override, and the only honest proof is that the eleven words are
      gone from a rendered #fCategory.

   3. ONE VOCABULARY ACROSS BOTH. The two files cannot import each other -- the
      same reason public/js/overrides.js ports _applyOv rather than importing
      api/overrides.js -- so a target spelled differently on one side is a NINTH
      bucket holding the seed's products alone. That would look exactly like the
      bug this replaced.

     node test-gear-categories.mjs
*/
import { readFile } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { createServer } from "node:http";
import { extname, join } from "node:path";
process.env.LL_NO_STORE_FETCH = "1";
const { GEAR_CATEGORIES } = await import("./api/products.js");
import { chromePath, launchChrome } from "./tools/chrome-path.mjs";

const fails = [];
const ok = (n, c, x = "") => { console.log(`${c ? "  PASS" : "  FAIL"}  ${n}${x ? "   (" + x + ")" : ""}`); if (!c) fails.push(n); };
const group = m => console.log("\n" + m);
const wait = ms => new Promise(r => setTimeout(r, ms));
async function until(fn, n = 100) { for (let i = 0; i < n; i++) { try { return await fn() } catch { await wait(250) } } throw new Error("timeout") }

console.log("\nEight gear buckets, not sixteen\n");

group("THE VOCABULARY");
ok("the feed publishes eight gear buckets", GEAR_CATEGORIES.length === 8, GEAR_CATEGORIES.join(" | "));
ok("...and every one of them is distinct",
   new Set(GEAR_CATEGORIES).size === GEAR_CATEGORIES.length);
/* The five words the split produced, each of which was its own filter entry. */
for (const gone of ["Terp Accessories", "Glass & Parts", "Torches & Lighters", "Cleaning", "Rigs"])
  ok(`"${gone}" is no longer a bucket of its own`, !GEAR_CATEGORIES.includes(gone));
/* Renaming Rigs was not cosmetic: that rung has ALWAYS matched bongs, beakers
   and bubblers, and a shopper looking for a bong could not see the word. */
ok('the bong rung says so in its name', GEAR_CATEGORIES.includes("Bongs & Rigs"));

group("NOT ONE REGEX CHANGED, so nothing lands on a different rung");
/* Driven through the real classifier, not read out of the source: a re-labelling
   that quietly re-classified would pass a source check and fail here. */
const api = readFileSync("api/products.js", "utf8");
const body = api.slice(api.indexOf("function accessoryCat(hay){"));
const cat = new Function("hay", body.slice(body.indexOf("{") + 1, body.indexOf("\n}")) + "\nreturn 'Accessories';");
const CASES = [
  ["Puffco Peak Pro dry herb vaporizer", "Vaporizers"],
  ["14mm Beaker Bong",                   "Bongs & Rigs"],
  ["Recycler Dab Rig",                   "Bongs & Rigs"],
  ["Glass Spoon Pipe",                   "Pipes"],
  ["One-Hitter Chillum",                 "Pipes"],
  ["Quartz Banger 14mm",                 "Parts & Tools"],
  ["Terp Pearls 6mm",                    "Parts & Tools"],
  ["Ash Catcher 90 degree",              "Parts & Tools"],
  ["Replacement Downstem",               "Parts & Tools"],
  ["Butane Torch Lighter",               "Parts & Tools"],
  ["Iso Cleaning Solution",              "Parts & Tools"],
  ["4 Piece Aluminium Grinder",          "Grinders"],
  ["RAW Rolling Papers King Size",       "Rolling"],
  /* PRE-EXISTING AND LEFT ALONE, pinned here so it is a known quirk rather than
     a discovery. The rolling rung sits above the tray rung, so a "rolling tray"
     is filed under Rolling. Defensible -- it is rolling gear, and somebody
     shopping Rolling for papers is the same person -- and moving it would mean
     changing the ladder, which this change deliberately does not do: keeping
     every regex byte-identical is what makes the merge provable by reading.
     Reordering is a separate change with its own evidence. */
  ["Bamboo Rolling Tray",                "Rolling"],
  ["Smell Proof Stash Bag",              "Storage & Trays"],
  ["Enamel Pin",                         "Accessories"]
];
for (const [name, want] of CASES) {
  const got = cat(name.toLowerCase());
  ok(`"${name}" -> ${want}`, got === want, got === want ? "" : "got " + got);
}
/* Every answer the classifier can give must be a published bucket, or the
   dropdown grows a word the vocabulary does not know about. */
const strays = CASES.map(([n]) => cat(n.toLowerCase())).filter(v => !GEAR_CATEGORIES.includes(v));
ok("the classifier can only answer with a published bucket", strays.length === 0, strays.join(","));

group("ONE LADDER, TWO FILES THAT CANNOT IMPORT EACH OTHER");
/* gearCat() in public/js/gear-categories.js is a deliberate twin of
   accessoryCat() here. The browser cannot import from api/ -- the same reason
   public/js/overrides.js ports _applyOv -- so the only thing standing between
   them and silent divergence is this block. A twin that drifts does not error:
   the shelf simply grows a NINTH bucket holding whatever the two files
   disagree about, which looks exactly like the granularity this replaced.
   Read out of the shipped file, not restated, for the reason
   test-catrow-pictures.mjs gives. */
const foldSrc = readFileSync("public/js/gear-categories.js", "utf8");
const gearCat = new Function(
  foldSrc.slice(foldSrc.indexOf("function gearCat(hay) {"),
                foldSrc.indexOf("\n  }", foldSrc.indexOf("function gearCat(hay) {")) + 4) +
  "\nreturn gearCat;")();
let drift = [];
for (const [name] of CASES) if (gearCat(name.toLowerCase()) !== cat(name.toLowerCase()))
  drift.push(`${name}: server ${cat(name.toLowerCase())} / browser ${gearCat(name.toLowerCase())}`);
ok("the browser ladder answers exactly as the feed's does", drift.length === 0, drift.join(" | "));
ok("...on every rung, including the ones that share a label",
   ["Quartz Banger", "Replacement Downstem", "Butane Torch", "Iso Cleaning Solution"]
     .every(n => gearCat(n.toLowerCase()) === "Parts & Tools"));
ok("...and can only answer with a published bucket",
   CASES.every(([n]) => GEAR_CATEGORIES.includes(gearCat(n.toLowerCase()))));

/* THE LOOKUP IN FRONT OF THE LADDER exists for the collections whose own word
   settles it, and for one case the ladder gets wrong on its own: a Puffco
   ATTACHMENT is a part, but "puffco" sits on the Vaporizers rung. */
const names = foldSrc.slice(foldSrc.indexOf("var NAMES = {"), foldSrc.indexOf("};", foldSrc.indexOf("var NAMES = {")));
const targets = [...names.matchAll(/:\s*"([^"]+)"/g)].map(m => m[1]);
const bad = targets.filter(t => !GEAR_CATEGORIES.includes(t));
ok("every lookup target is a bucket the feed publishes", bad.length === 0, bad.join(","));
ok("...and the attachment collections are answered by the lookup, not the ladder",
   /"Puffco Attachments":\s*"Parts & Tools"/.test(names) &&
   gearCat("puffco peak pro attachment") === "Vaporizers");
/* A collection holding every kind of product has no single right answer, so it
   must NOT be in the lookup -- the ladder has to read each product instead. */
/* THE SEVEN THE LIVE SHOP ACTUALLY SENT, which is how this whole failure was
   found: with network, the engine merges api.bigcartel.com on top of its seed
   and these reached the dropdown verbatim. Every one must now land in the
   eight, whether by the lookup or by the ladder reading a product name. */
const LIVE = [
  ["Quartz Bangers",     "Elite Series Quartz Banger 14mm", "Parts & Tools"],
  ["Puffco Attachments", "Puffco Peak Pro Glass",           "Parts & Tools"],
  ["Carta Attachments",  "Carta 2 Glass Top",               "Parts & Tools"],
  ["Carb Caps",          "Spinner Bubble Cap",              "Parts & Tools"],
  ["Gemstones",          "Fluorite Sphere",                 "Accessories"],
  /* The two with no single right answer: read per product, not per collection. */
  ["New Arrivals",       "Gridded Natty Neck Recycler",     "Bongs & Rigs"],
  ["New Arrivals",       "4 Piece Grinder",                 "Grinders"],
  ["Elite Series",       "Terp Pearls Set",                 "Parts & Tools"]
];
const NAMES_MAP = Object.fromEntries([...names.matchAll(/"([^"]+)"\s*:\s*"([^"]+)"/g)].map(m => [m[1], m[2]]));
for (const [collection, product, want] of LIVE) {
  const got = NAMES_MAP[collection] || gearCat((product + " " + collection).toLowerCase());
  ok(`"${collection}" / "${product}" -> ${want}`, got === want, got);
}
ok("...so no live collection name can reach the shopper",
   LIVE.every(([c, pr]) => GEAR_CATEGORIES.includes(NAMES_MAP[c] || gearCat((pr + " " + c).toLowerCase()))));

for (const mixed of ["New Arrivals", "Elite Series"])
  ok(`"${mixed}" is left to the ladder rather than filed under one word`,
     !new RegExp('"' + mixed + '"\\s*:').test(names));

group("EIGHT BUCKETS NEED EIGHT FACES");
/* WHY THIS IS NOT OPTIONAL. Without a PREFER table of its own a gear bucket
   falls through HINTS to "Accessories", whose positives are
   grinder|tray|banger|pipe|bong|rig|papers|lighter|torch -- so a photograph of
   a bong scores +3 as the face of GRINDERS. Condensing sixteen buckets into
   eight and then giving six of them the wrong picture would be a worse result
   than the granularity, because a wrong picture reads as a decision.
   Driven through the SHIPPED scorer, read back out of public/js/rails.js, for
   the reason test-catrow-pictures.mjs gives: a test that restated the table
   would pass forever while the page did something else. */
const rails = readFileSync("public/js/rails.js", "utf8");
const grab = (re, what) => { const m = rails.match(re); if (!m) { console.error("missing " + what); process.exit(2); } return m[0]; };
const scoreFor = new Function(
  grab(/var PREFER = \{[\s\S]*?\n  \};/, "PREFER") + "\n" +
  grab(/var HINTS = \[[\s\S]*?\n  \];/, "HINTS") + "\n" +
  /* scoreFor consults a per-category SHOP preference too ("for concentrate, use
     one of hipuffy's pics"), so its table has to come along or the function
     throws on a name it cannot see. Gear states no shop preference and this
     suite passes no store, which is itself worth exercising: the bonus must be
     inert when nobody asked for one. */
  grab(/var PREFER_STORE = \{[\s\S]*?\};/, "PREFER_STORE") + "\n" +
  grab(/function scoreFor\([\s\S]*?\n  \}/, "scoreFor") + "\nreturn scoreFor;")();
/* Deliberately cross-bucket: in production catPool only offers a category its
   OWN products, so this is a harder question than the rail ever faces. If a
   bucket cannot pick its own face out of the whole gear shelf, it certainly
   cannot be trusted with a pool of near-misses. */
const SHELF = ["14mm Beaker Bong", "Glass Spoon Pipe", "4 Piece Aluminium Grinder",
               "RAW Rolling Papers King Size", "Quartz Banger 14mm",
               "Puffco Peak Pro Vaporizer", "Smell Proof Stash Jar"];
const WANT = {
  "Bongs & Rigs": "14mm Beaker Bong",
  "Pipes": "Glass Spoon Pipe",
  "Grinders": "4 Piece Aluminium Grinder",
  "Rolling": "RAW Rolling Papers King Size",
  "Storage & Trays": "Smell Proof Stash Jar",
  "Parts & Tools": "Quartz Banger 14mm",
  "Vaporizers": "Puffco Peak Pro Vaporizer"
};
for (const [c, want] of Object.entries(WANT)) {
  let best = null, bs = -1;
  for (const n of SHELF) { const v = scoreFor(c, n); if (v > bs) { bs = v; best = n; } }
  ok(`${c} picks its own product off the whole gear shelf`, best === want, best);
}
/* A dry-herb device is a Vaporizer on this site and a 510 cart is one on the
   dispensary side. The table carries both readings; it used to carry one, and a
   Puffco floored at the "any photo beats no photo" tier. */
ok("...and a cart still outranks nothing on the dispensary reading of the word",
   scoreFor("Vaporizers", "Live Resin Cartridge 1g") > scoreFor("Vaporizers", "Enamel Pin"),
   scoreFor("Vaporizers", "Live Resin Cartridge 1g") + " vs " + scoreFor("Vaporizers", "Enamel Pin"));
/* HINTS sends "Rolling" to Pre-Rolls (a joint, for rolling papers) and
   "Parts & Tools" nowhere at all, which lands on the cannabis-leaf default. */
const glyphs = rails.slice(rails.indexOf("var GLYPH"), rails.indexOf("};", rails.indexOf("var GLYPH")));
for (const c of GEAR_CATEGORIES)
  ok(`"${c}" has a glyph of its own rather than a cannabis leaf`, glyphs.includes('"' + c + '"'));
const order = rails.slice(rails.indexOf("var ORDER = ["), rails.indexOf("];", rails.indexOf("var ORDER = [")));
for (const c of GEAR_CATEGORIES)
  ok(`"${c}" has a place in the shelf order, not just the alphabet`, order.includes('"' + c + '"'));

group("THE SEED'S ELEVEN, IN A REAL BROWSER");
/* The only honest proof: the words are gone from a rendered #fCategory. Nothing
   here can be established by reading a file -- the override is applied at
   runtime by the engine's own ingest. */
const PORT = 3532, CDP = 9350;
const CHROME = chromePath();
const FEED = { meta: { updated: new Date(0).toISOString(), total: 1, stores: [] }, products: [] };
const MIME = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".json": "application/json" };
const srv = createServer(async (req, res) => {
  const u = new URL(req.url, "http://x");
  if (u.pathname.startsWith("/api/")) {
    res.writeHead(200, { "content-type": "application/json" });
    return res.end(JSON.stringify(u.pathname === "/api/products" ? FEED : {}));
  }
  const f = u.pathname === "/" ? "index.html" : u.pathname.replace(/^\//, "");
  try {
    const b = await readFile(join("public", f));
    res.writeHead(200, { "content-type": MIME[extname(f)] || "application/octet-stream" });
    res.end(b);
  } catch { res.writeHead(404).end("no"); }
});
await new Promise(r => srv.listen(PORT, "127.0.0.1", r));
const { proc: ch } = await launchChrome(CDP, [], { userDataDir: "/tmp/_llgear" });
const t = await until(async () => { const j = await (await fetch(`http://127.0.0.1:${CDP}/json/list`)).json(); const pg = j.find(x => x.type === "page"); if (!pg) throw 0; return pg; });
const s = new globalThis.WebSocket(t.webSocketDebuggerUrl);
await new Promise(r => s.addEventListener("open", r));
let id = 0; const p = new Map(); const errs = [];
s.addEventListener("message", e => {
  const m = JSON.parse(e.data);
  if (m.method === "Runtime.exceptionThrown") errs.push(m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text);
  if (m.id && p.has(m.id)) { p.get(m.id)(m); p.delete(m.id) }
});
const send = (method, params = {}) => new Promise(r => { const i = ++id; p.set(i, r); s.send(JSON.stringify({ id: i, method, params })) });
const ev = async x => (await send("Runtime.evaluate", { expression: x, returnByValue: true })).result?.result?.value;
await send("Runtime.enable"); await send("Page.enable"); await send("Network.enable");
/* NO SUITE CALLS A REAL SHOP. LL_NO_STORE_FETCH covers api/ code; it cannot
   cover a BROWSER, and public/engine.js fetches
   https://api.bigcartel.com/greekglass/products.json to refresh Greek Glass on
   top of its baked seed. So this suite was hitting a real merchant on every
   push -- invisible from the containers this repo is edited in, where egress is
   refused, and the reason the numbers below differed between a laptop and a
   runner. Blocked at the network layer, the same way Google Fonts is, which
   also makes the run deterministic instead of dependent on somebody's shop. */
await send("Network.setBlockedURLs", { urls: ["*fonts.googleapis.com*", "*fonts.gstatic.com*", "*bigcartel.com*"] });
for (let i = 0; i < 2; i++) {
  await send("Page.navigate", { url: `http://127.0.0.1:${PORT}/` });
  await until(async () => { if (await ev(`document.readyState==='complete'`)) return true; throw 0 });
  await ev(`localStorage.setItem('ll_age_ok','1')`);
}
await until(async () => { if ((await ev(`document.querySelectorAll('#grid .card').length`)) > 0) return true; throw 0 }, 80);
/* The fold polls for LL_admin and then reprocesses, so give it room. */
await until(async () => {
  if (await ev(`!!(window.LL_MANUAL_CAT && Object.keys(window.LL_MANUAL_CAT).some(function(k){return window.LL_MANUAL_CAT[k].gearFold}))`)) return true;
  throw 0;
}, 40);

const seen = await ev(`(function(){
  var sel=document.getElementById("fCategory");
  return [].map.call(sel.options,function(o){return o.value}).filter(function(v){return v && v.indexOf("__")!==0});
})()`);
console.log("  #fCategory: " + seen.join(" | "));
const SEED_WORDS = ["Rigs", "E-Rig Attachments", "Bangers", "Carb Caps", "Glassware",
                    "Terp Accessories", "Tubes", "Collectibles", "Ash Catchers", "Tools"];
const left = SEED_WORDS.filter(w => seen.includes(w));
ok("none of the seed's own gear words reach the dropdown", left.length === 0, left.join(","));
/* The seed's products must still BE somewhere -- folding is not hiding. */
const counted = await ev(`(function(){
  var out={};
  (window.LL_admin.items()||[]).forEach(function(x){
    if(x && x.store==="Greek Glass") out[x.category]=(out[x.category]||0)+1;
  });
  return out;
})()`);
console.log("  Greek Glass after the fold: " + JSON.stringify(counted));
const total = Object.values(counted).reduce((a, b) => a + b, 0);
/* AN INVARIANT, NOT A COUNT. The first version of this asserted 85 products in
   at most 4 buckets, which passed here and failed on a runner: with network the
   engine merges the live Big Cartel shop on top of its seed and the shelf is
   120 products across eleven collection names. The count was never the claim --
   "nothing outside the eight reaches the shopper" is, and that holds whether or
   not the live shop answered. The bigcartel block above pins it further. */
ok("every seed product is still on the shelf, folding is not hiding", total >= 85, total + " products");
ok("...and every bucket they landed in is one the feed publishes",
   Object.keys(counted).every(c => GEAR_CATEGORIES.includes(c)), Object.keys(counted).join(","));
ok("...in far fewer buckets than the eleven they arrived as",
   Object.keys(counted).length <= 8, Object.keys(counted).length + ": " + Object.keys(counted).join(","));
/* THE WHOLE SHELF, not just Greek Glass: any accessory category the engine ends
   up offering must be one of the eight, whatever fed it. */
const offered = await ev(`(function(){
  var sel=document.getElementById("fCategory");
  return [].map.call(sel.options,function(o){return o.value})
    .filter(function(v){ return v && v.indexOf("__")!==0; });
})()`);
const CONSUMABLE = ["THCA Flower","Flower","Pre-rolls","Pre-Rolls","Concentrate","Concentrates",
                    "Edibles","Drinks","Topicals","Wholesale","Trim/Shake","CBD","Vape",
                    "Carts","Disposables","Seeds & Clones","Apparel"];
const rogue = offered.filter(v => !GEAR_CATEGORIES.includes(v) && !CONSUMABLE.includes(v));
ok("no category outside the published vocabulary reaches the dropdown at all",
   rogue.length === 0, rogue.join(","));
/* A fold that erased a real admin decision would be worse than the split. */
const respects = await ev(`(function(){
  var it=(window.LL_admin.items()||[]).filter(function(x){return x&&x.store==="Greek Glass"})[0];
  if(!it) return "no seed product";
  window.LL_MANUAL_CAT[it.id]={cat:"Pipes",t:1};
  return window.LL_MANUAL_CAT[it.id].gearFold ? "overwritten" : "kept";
})()`);
ok("a real manual decision is not overwritten by the fold", respects === "kept", respects);
/* Derived on every load, not decided by anybody, so it must not be publishable
   into shared storage where it would outlive the rule that produced it. */
const exported = await ev(`(function(){
  try{ var b=window.LL_admin.exportBatch();
       var n=0; for(var k in (b.cat||{})) if(b.cat[k] && b.cat[k].gearFold) n++;
       return n; }catch(e){ return -1; }
})()`);
ok("and the fold cannot be published to shared overrides", exported === 0, "gearFold entries in batch: " + exported);
ok("no uncaught errors on the page", errs.length === 0, errs.slice(0, 2).join(" | "));

console.log("\n" + (fails.length ? `FAILED: ${fails.join(", ")}` : "All assertions passed.") + "\n");
try { s.close() } catch {}
ch.kill(); srv.close();
process.exit(fails.length ? 1 : 0);
