/* The opening shelf reads like a shop floor, not a league table.

   The grid is ranked by best price per gram, which is the whole proposition --
   and a pure ranking walls up. One shop's catalogue, or one category, lands as
   a solid block at the top and the first screen says "this is a Grasscity page"
   or "this is a flower page" rather than "this is a comparison". Reported on
   the city pages as "you say it's interweaved across shops, that's not true, I
   see just Banzen by default".

   SO THE OPENING SHELF IS DEALT OUT: no shop twice in a row, and no category
   twice in a row where there is a choice. Ties keep the engine's own order, so
   this is a ROTATION of its ranking and never a replacement for it.

   THREE THINGS THAT MAKE IT NOT A GIMMICK, and each is a way it could be wrong
   while still looking shuffled:

   1. IT STANDS DOWN WHEN SOMEBODY ASKS FOR SOMETHING. A shopper who picks a
      shop or a sort has stated what they want, and shuffling on top of that is
      second-guessing them. "Untouched" is a fact about the shopper -- a TRUSTED
      event -- not a guess at the controls: two earlier versions read it off
      #fSort and #fBudget and both stood down on every load in production,
      because the page sets those itself.
   2. NOTHING IS LOST OR DUPLICATED. A reorder that drops a card is a shuffle
      that looks perfect and sells less.
   3. ONE DRIVER PER GRID. The city pages sequence it inside their own paint
      cycle (top up, deal, trim); the shared file arms its own observer only
      where that block is absent. Two observers reordering one grid shows up as
      cards twitching, not as an error.

     node test-shelf-shuffle.mjs
*/
import { readFile } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { createServer } from "node:http";
import { extname, join } from "node:path";
import { chromePath, launchChrome } from "./tools/chrome-path.mjs";

process.env.LL_NO_STORE_FETCH = "1";
const CHROME = chromePath();
const PORT = 3502, CDP = 9356;
const fails = [];
const ok = (n, c, x = "") => { console.log(`${c ? "  PASS" : "  FAIL"}  ${n}${x ? "   (" + x + ")" : ""}`); if (!c) fails.push(n); };
const group = m => console.log("\n" + m);
const wait = ms => new Promise(r => setTimeout(r, ms));
async function until(fn, n = 100) { for (let i = 0; i < n; i++) { try { return await fn() } catch { await wait(250) } } throw new Error("timeout") }

/* THREE SHOPS, TWO CATEGORIES, AND A DELIBERATE WALL. Every product is priced
   so one shop is uniformly cheapest -- which is what a real feed looks like
   when a discounter is in it, and exactly the shape that makes a pure ranking
   open on one shop's whole catalogue. If the shuffle is doing nothing, the
   first six cards are all Alpha. */
const SHOPS = [["Alpha Hemp", "alpha", 10], ["Beta Hemp", "beta", 20], ["Gamma Hemp", "gamma", 30]];
const CATS = ["THCA Flower", "Edibles"];
const products = [];
for (const [store, key, base] of SHOPS) {
  for (let i = 0; i < 4; i++) {
    const cat = CATS[i % 2];
    const id = key + i;
    /* AN EDIBLE MAY NOT BE SOLD BY THE OUNCE IN THIS FIXTURE, and finding that
       out cost a run that read as a broken category shuffle. The engine has a
       rule that an ounce or more is only ever flower (it is what keeps a bottle
       of glass cleaner out of the per-gram path), so giving every product a 28g
       size filed all twelve as THCA Flower -- one category, nothing to rotate,
       and the failure pointed at the shuffle rather than at the fixture. */
    const flower = cat === "THCA Flower";
    products.push({
      id, name: store.split(" ")[0] + " " + cat.split(" ")[0] + " " + i,
      store, storeKey: key, domain: key + ".test", platform: "shopify",
      cannabinoid: "THCa", category: cat, type: "Indica", strain: "S" + i,
      image: "/favicon.svg", url: "https://" + key + ".test/p/" + id,
      brand: "Maker " + i, brandKey: "maker-" + i, description: "Sentences.",
      inStock: true, startsAt: base + i, sale: base + i,
      perG: flower ? (base + i) / 28 : null, ship: 5, badges: [],
      sizes: [[flower ? "1 oz" : "10 pack", base + i, flower ? 28 : 0,
               id + "s", true, "https://" + key + ".test/p/" + id, "", 0]]
    });
  }
}
const TOTAL = products.length;

/* A SECOND FIXTURE, AT PRODUCTION SHAPE. The twelve-product one above is right
   for the deal -- three equal shops, a deliberate wall -- and useless for what
   follows, because the engine's PAGE is 12 so it never draws a Load more bar and
   the pool is the whole catalogue by definition. Live it is 2234 / 1223 / 303 /
   245 / ... across fourteen shops, and it was measuring THAT shape that showed
   the opening shelf was four shops, one category and identical on every load.
   Served on demand from the same endpoint, so the page under test is unchanged. */
const BIG_SHOPS = [["Puffy THCa","hipuffy",70],["Grasscity","grasscity",40],["CBD Hemp Direct","cbdhempdirect",12],
  ["THCA Small Buds","thcasmallbuds",10],["Black Tie CBD","blacktiecbd",8],["Chill Steel Pipes","chill",7],
  ["Nothing But Canna","nothingbutcanna",5],["THCA4Cheap","thca4cheap",4],["Exhale Wellness","exhalewell",3],
  ["THCa Hempire","thcahempire",3],["Bloomz Hemp","bloomzhemp",2],["Hitoki","hitoki",2]];
const bigProducts = [];
for (const [store, key, n] of BIG_SHOPS) for (let i = 0; i < n; i++) {
  const cat = CATS[i % 2], flower = cat === "THCA Flower", id = key + i;
  const price = 8 + ((i * 7 + key.length * 3) % 90);
  bigProducts.push({ id, name: store.split(" ")[0] + " " + cat + " " + i, store, storeKey: key,
    domain: key + ".test", platform: "shopify", cannabinoid: "THCa", category: cat, type: "Indica",
    strain: key + "-S" + i, image: "/favicon.svg", url: "https://" + key + ".test/p/" + id,
    description: "Sentences.", inStock: true, startsAt: price, sale: price,
    perG: flower ? price / 28 : null, ship: 5, badges: [],
    sizes: [[flower ? "1 oz" : "10 pack", price, flower ? 28 : 0, id + "s", true, "", "", 0]] });
}
/* AND THE OFFCUTS, WHICH ARE THE POINT OF THE THIRD AXIS. Shake and trim are
   the cheapest thing per gram there is, and the grid is ranked by price per
   gram, so a correct ranking puts them at the top -- reported as "way too much
   trim near the top of my main product grid". Priced below every whole-bud row
   in the fixture ON PURPOSE, so that without the split they win the head of
   every shop's bucket and the opening screen is a wall of shake. That is the
   bug being reproduced, not a hostile fixture.
   Spread over four shops so the shop axis cannot mask it: rotating shops
   perfectly while every card is shake is exactly the failure. Both signals are
   set -- the name says Shake AND subTags.trim is true -- because the engine's
   sub-tag test reads an override first and the regex second, and a fixture that
   exercised only one of them would leave the other untested. */
const TRIM_SHOPS = [["Puffy THCa","hipuffy"],["Grasscity","grasscity"],
                    ["CBD Hemp Direct","cbdhempdirect"],["THCA Small Buds","thcasmallbuds"]];
const trimIds = [];
TRIM_SHOPS.forEach(([store, key], si) => {
  for (let i = 0; i < 3; i++) {
    const id = key + "-shake" + i, price = 3 + si * 0.25 + i * 0.1;
    trimIds.push(id);
    bigProducts.push({ id, name: store.split(" ")[0] + " Shake Ounce " + i, store, storeKey: key,
      domain: key + ".test", platform: "shopify", cannabinoid: "THCa", category: "THCA Flower",
      type: "Indica", strain: key + "-shake" + i, image: "/favicon.svg",
      url: "https://" + key + ".test/p/" + id, description: "Sentences.",
      subTags: { trim: true }, inStock: true, startsAt: price, sale: price,
      perG: price / 28, ship: 5, badges: [],
      sizes: [["1 oz", price, 28, id + "s", true, "", "", 0]] });
  }
});
const TRIM_TOTAL = trimIds.length;
const BIG = { meta: { updated: new Date(0).toISOString(), total: bigProducts.length, stores: [] }, products: bigProducts };
let serveBig = false;
const FEED = { meta: { updated: new Date(0).toISOString(), total: products.length, stores: [] }, products };
const MIME = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".json": "application/json" };
const ROUTES = { "/": "index.html", "/coldwater": "coldwater.html" };
let asked = [];
const srv = createServer(async (req, res) => {
  const u = new URL(req.url, "http://x");
  if (u.pathname.startsWith("/api/")) {
    asked.push(u.pathname + u.search);
    res.writeHead(200, { "content-type": "application/json" });
    /* A CITY PAGE DOES NOT READ /api/coldwater. Its shim repoints /api/products
       to /api/market?town=<slug> -- the one-core endpoint -- and serving only
       the first two left the shelf empty while the page still rendered, so the
       run reported "0 of 12 cards" and looked like a broken shuffle. */
    const body = /products|coldwater|market/.test(u.pathname) ? (serveBig ? BIG : FEED) : {};
    return res.end(JSON.stringify(body));
  }
  const f = ROUTES[u.pathname] || u.pathname.replace(/^\//, "");
  try {
    const b = await readFile(join("public", f));
    res.writeHead(200, { "content-type": MIME[extname(f)] || "application/octet-stream" });
    res.end(b);
  } catch { res.writeHead(404).end("no"); }
});
await new Promise(r => srv.listen(PORT, "127.0.0.1", r));

const { proc: ch } = await launchChrome(CDP, [], { userDataDir: "/tmp/_llshuf" });
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
await send("Network.setBlockedURLs", { urls: ["*fonts.googleapis.com*", "*fonts.gstatic.com*", "*bigcartel.com*"] });
await send("Emulation.setDeviceMetricsOverride", { width: 1280, height: 1400, deviceScaleFactor: 1, mobile: false });

async function goto(path) {
  for (let i = 0; i < 2; i++) {
    await send("Page.navigate", { url: `http://127.0.0.1:${PORT}${path}` });
    await until(async () => { if (await ev(`document.readyState==='complete'`)) return true; throw 0 });
    await ev(`localStorage.setItem('ll_age_ok','1')`);
  }
  await until(async () => { if ((await ev(`document.querySelectorAll('#grid .card').length`)) > 0) return true; throw 0 }, 80);
  await wait(1200);
}
/* Read off the rendered cards, so this is the order a shopper sees rather than
   the order of an array this suite built. */
const shelf = () => ev(`[].map.call(document.querySelectorAll('#grid .card'),function(c){
  var p=c.querySelector('.storepill');
  return {store:((p&&p.textContent)||"").trim(), cat:c.getAttribute('data-cat')||"",
          pid:c.getAttribute('data-pid')||""};})`);
const runs = (arr, key) => {
  let worst = 1, cur = 1;
  for (let i = 1; i < arr.length; i++) {
    if (arr[i][key] && arr[i][key] === arr[i - 1][key]) { cur++; if (cur > worst) worst = cur; }
    else cur = 1;
  }
  return worst;
};

console.log("\nThe opening shelf\n");

for (const path of ["/", "/coldwater"]) {
  group(path.toUpperCase() === "/" ? "ON THE HEMP SHELF" : "ON A CITY PAGE");
  await goto(path);
  const rows = await shelf();
  const feed = rows.filter(r => /Alpha|Beta|Gamma/.test(r.store));
  console.log("  " + feed.slice(0, 9).map(r => r.store.split(" ")[0] + "/" + r.cat.split(" ")[0]).join("  "));
  /* If the fixture never reached the page, say what DID -- a shelf full of
     somebody else's products reads as a broken shuffle otherwise, which is how
     the first run of this suite was misread. */
  if (!feed.length) console.log("  actual stores: " +
    JSON.stringify([...new Set(rows.map(r => r.store))].slice(0, 6)) + " of " + rows.length +
    " cards; endpoints asked: " + JSON.stringify([...new Set(asked)]));
  ok("the shelf rendered the fixture", feed.length === TOTAL, feed.length + " of " + TOTAL + " cards");
  /* THE CLAIM. Unshuffled, the cheapest shop's whole catalogue comes first --
     a run of six. One repeat can happen when a bucket empties; six cannot. */
  ok("no shop runs down the page in a block", runs(feed, "store") <= 2,
     "longest same-shop run: " + runs(feed, "store"));
  /* THE TWO AXES DO NOT GET THE SAME BOUND, and the asymmetry is the design
     rather than a weaker test. The SHOP axis is decided globally -- fullest
     remaining bucket, never the one just placed -- so "no shop twice running" is
     a guarantee and is asserted as one. The CATEGORY axis is decided INSIDE
     whichever shop the shop axis chose, because shop outranks category on a
     price-comparison shelf ("who is selling it" is what a shopper scans). So
     when that shop is holding only one category, the category repeats, and no
     amount of looking can prevent it without overruling the primary axis.
     Bounding it at 3 raced: it passed for a year only because the deal had no
     randomness in it, and flaked twice the moment it did. The honest claim is
     that no category takes over the shelf. */
  ok("...and no category takes over the shelf", runs(feed, "cat") < feed.length / 2,
     "longest same-category run: " + runs(feed, "cat") + " of " + feed.length);
  ok("every shop appears in the first six cards",
     new Set(feed.slice(0, 6).map(r => r.store)).size === 3,
     [...new Set(feed.slice(0, 6).map(r => r.store))].join(" | "));
  /* A shuffle that loses a card looks perfect and sells less. */
  ok("nothing was dropped or duplicated",
     new Set(feed.map(r => r.pid)).size === feed.length && feed.length === TOTAL,
     feed.length + " cards, " + new Set(feed.map(r => r.pid)).size + " distinct");
}

group("IT STANDS DOWN WHEN SOMEBODY ASKS FOR SOMETHING");
await goto("/");
/* A TRUSTED event, dispatched through the input domain -- a synthetic
   dispatchEvent carries isTrusted:false and would sail past the guard this
   assertion exists to check, passing against a shuffle that never stood down. */
const box = await ev(`(function(){var s=document.getElementById("fSort");
  s.scrollIntoView({block:"center"}); var r=s.getBoundingClientRect();
  return {x:Math.round(r.left+r.width/2), y:Math.round(r.top+r.height/2)};})()`);
await ev(`(function(){var b=document.getElementById("toggleFilters"); if(b) b.click();})()`);
await wait(300);
const box2 = await ev(`(function(){var s=document.getElementById("fSort");
  s.scrollIntoView({block:"center"}); var r=s.getBoundingClientRect();
  return {x:Math.round(r.left+r.width/2), y:Math.round(r.top+r.height/2), h:window.innerHeight};})()`);
ok("the sort control is reachable to click for real", box2 && box2.y > 0 && box2.y < box2.h,
   JSON.stringify(box2));
await send("Input.dispatchMouseEvent", { type: "mousePressed", x: box2.x, y: box2.y, button: "left", clickCount: 1 });
await send("Input.dispatchMouseEvent", { type: "mouseReleased", x: box2.x, y: box2.y, button: "left", clickCount: 1 });
await wait(200);
const touchedNow = await ev(`(function(){
  var s=document.getElementById("fSort");
  s.value="newest";
  s.dispatchEvent(new Event("change",{bubbles:true}));
  return typeof window.LL_shuffleTouched === "function" ? window.LL_shuffleTouched() : null;
})()`);
/* A programmatic change is NOT a shopper asking, which is the whole point of
   the isTrusted guard -- the page sets these itself on load. */
ok("a programmatic change does not count as the shopper asking", touchedNow === false,
   String(touchedNow));
const realTouch = await ev(`(function(){
  document.dispatchEvent(new CustomEvent("ll-facet-picked"));
  return window.LL_shuffleTouched();
})()`);
ok("...but a rail chip announcing itself does", realTouch === true, String(realTouch));
/* WHAT PROVES IT STOOD DOWN IS THAT THE ORDER STOPS MOVING, not that a
   particular wall comes back.

   The first draft of this asserted the order was UNCHANGED after a touch, which
   is checking that the feature does not work -- standing down means the engine's
   ranking takes over, so of course it moves. The second asserted the cheapest
   shop's block returns, longer than it was while shuffled. That read well and
   was a race: on this twelve-card fixture the engine's own longest run is 2 and
   a random deal's is 1 or 2, so it passed or failed by luck. It passed for a
   year because the deal had no randomness in it at all -- the bug this change
   exists to fix was also what was holding the assertion up.

   So the claim is now the one thing that cannot race. The ENGINE is
   deterministic: same filter, same order, every time. The SHUFFLE is not, by
   design and as asserted above. So re-render twice after a touch and the two
   must be identical -- if anything were still dealing, they would not be. */
await goto("/");
const shuffled = runs((await shelf()).filter(r => /Alpha|Beta|Gamma/.test(r.store)), "store");
ok("shuffled, no shop repeats", shuffled <= 2, "run of " + shuffled);
await ev(`(function(){document.dispatchEvent(new CustomEvent("ll-facet-picked"));
  var s=document.getElementById("fStore"); s.value=""; s.dispatchEvent(new Event("change",{bubbles:true}));})()`);
await wait(900);
ok("the shopper is now on record as having asked", (await ev(`window.LL_shuffleTouched()`)) === true);
/* Two re-renders through the same control, landing back on the same filter. */
const reRender = async () => {
  await ev(`(function(){var s=document.getElementById("fStore");
    s.value="Alpha Hemp"; s.dispatchEvent(new Event("change",{bubbles:true}));
    s.value=""; s.dispatchEvent(new Event("change",{bubbles:true}));})()`);
  await wait(700);
  return (await shelf()).map(r => r.pid).join("|");
};
const once = await reRender(), twice = await reRender();
ok("once touched, the order stops moving -- nothing is dealing any more",
   once === twice && once.length > 0, once.slice(0, 48) + "...");

group("ONE DRIVER PER GRID");
const src = readFileSync("public/js/shelf-shuffle.js", "utf8");
ok("the shared file arms its own observer only where cw-feed is absent",
   /getElementById\("cw-feed"\)/.test(src));
/* Read inside the arming function, not at parse time: cw-feed is injected later
   in the document than this file's script tag, so at parse time it does not
   exist yet. Same reason ll-cart-label reads its Coldwater guard inside paint. */
ok("...and that guard is read at run time, not at parse time",
   /function driven\(\)/.test(src) && src.indexOf("function driven()") < src.indexOf("function schedule("));
const gen = readFileSync("tools/make-coldwater.mjs", "utf8");
ok("a city page calls it inside its own paint cycle", /window\.LL_shuffle\(grid\(\)\)/.test(gen));
ok("...and carries no copy of its own", !/function interleave\(\)/.test(gen));
/* The top-up is inside schedule(), after the driven() early return, so a city
   page's cw-feed keeps sole charge of filling its own shelf. Two blocks pressing
   the same Load more is not an error, it is a shelf that doubles in size. */
const sched = src.slice(src.indexOf("function schedule("), src.indexOf("function arm()"));
ok("the shared top-up sits inside the one-driver guard",
   sched.indexOf("driven()") >= 0 && sched.indexOf("driven()") < sched.indexOf("topUp("),
   sched.length + " chars");
ok("...and the click is the engine's own bar, not a reimplementation of paging",
   /\.loadmore["']\)[\s\S]{0,220}\.click\(\)/.test(src));
/* TWO STOPS NOW, AND BOTH ARE LOAD BEARING. The top-up presses in one
   synchronous pass rather than one press per animation frame -- measured, that
   took a cold load from eight full grid rebuilds to four -- so the bound is a
   per-call counter AND a check that the press actually grew the grid. Either
   alone leaves a way to spin: a counter with no growth check burns its budget
   on a feed that cannot answer, and a growth check with no counter has no
   bound at all. */
ok("...with a hard stop so it cannot spin",
   /MAX_CLICKS/.test(src) && /pressed < MAX_CLICKS/.test(src));
ok("...and a second one, so a feed that cannot reach the floor stops at once",
   /length <= before/.test(src));

/* THE BAKED SEED IS NOT A SHELF. The engine paints it before the feed lands, and
   this file used to widen it to forty cards and deal it -- a whole shelf built
   and thrown away in front of the shopper, which is what "it can't decide if
   it's loading a static seed or something else" was describing. */
ok("the deal stands down until a real feed has landed", /\bfed\b/.test(src) && /!fed/.test(src));
/* AND IT ASKS STATE, NOT AN EVENT. Gating on the `ll-meta` event alone lost the
   announcement whenever the feed was parsed before this file was listening --
   the shelf then sat at twelve cards with no second chance, about a third of
   the time. feed-meta writes window.LL_META before it dispatches, so the
   question survives arriving late. */
ok("...asked of LL_META, so arriving after the announcement still works",
   /function feedSeen\(\)/.test(src) && /window\.LL_META/.test(src));
ok("...with a timer only for a feed that never comes at all", /FEED_WAIT_MS/.test(src));

group("A FEED IS DIFFERENT EVERY TIME YOU OPEN IT");
/* THE ORIGINAL SHUFFLE HAD NO RANDOMNESS AT ALL. It was a pure function of the
   ranking, so every visitor saw the same shelf in the same order on every visit
   -- an interleave, not a feed. Reported as "I need the products to be shuffled
   on load for llm, it needs to feel like a social media feed".
   Three loads rather than two: with a random deal, two runs colliding is
   vanishingly unlikely but not impossible, and a suite that can flake once a
   year is a suite somebody learns to re-run. */
serveBig = true;
const sigs = [];
for (let i = 0; i < 3; i++) { await goto("/"); sigs.push((await shelf()).map(r => r.pid).join("|")); }
ok("the big fixture reached the page", sigs.every(s => s.length > 40), sigs[0].slice(0, 40) + "...");
ok("three loads do not all produce the same shelf", new Set(sigs).size >= 2,
   new Set(sigs).size + " distinct orders in 3 loads");

group("AND IT IS DEALT FROM A SHELF, NOT FROM A PAGE");
/* THE THIRD CAUSE, and the one that made the other two look fixed when they were
   not: the engine's PAGE is 12, and twelve cards ranked by price per gram carry
   four shops however cleverly they are rotated. Rounds over a pool of twelve
   cannot produce a feed, because the pool is not a feed. The city pages already
   pressed Load more to a floor before dealing; that is now in the shared file. */
await goto("/");
const wide = await shelf();
ok("the shelf was topped up past one engine page", wide.length > 12, wide.length + " cards, PAGE is 12");
ok("...to at least the floor", wide.length >= 40, wide.length + " cards");
const shops12 = new Set(wide.slice(0, 12).map(r => r.store));
ok("so the opening twelve carry more than the four shops a page held",
   shops12.size >= 5, shops12.size + " shops: " + [...shops12].join(" | "));
ok("no shop opens the shelf twice running", runs(wide, "store") <= 1,
   "longest same-shop run: " + runs(wide, "store"));
/* NO CATEGORY CLAIM IS MADE HERE, and that is a finding rather than a gap. This
   fixture prices by the gram like the real feed, so only flower carries a perG
   and the engine's own ranking sorts everything else below it -- the top forty
   are nearly all flower before the deal sees them. A shuffle cannot rotate an
   axis the pool does not contain, and it should not: "best price per gram" is
   the site's proposition, and the opening screen being mostly flower is that
   proposition working. The category claim is made on the small fixture above,
   where both categories are actually in the pool.
   Asserting it here flaked immediately, which is the same lesson one paragraph
   up arriving from the other direction. */
ok("nothing was dropped or duplicated in the wider deal",
   new Set(wide.map(r => r.pid)).size === wide.length, wide.length + " cards");

group("AND OFFCUTS ARE STOCK, NOT THE SHOP FRONT");
/* THE NUMBERS ARE THE ASSERTION, not "some trim was moved". Twelve shake
   listings priced below every whole-bud row means an unfixed deal opens on
   shake -- measured against the code before the split, the first twelve cards
   were ELEVEN shake -- so a bound of one in the opening eight is a claim that
   fails loudly against the bug it exists to catch.
   GAP is read out of the file rather than restated, because a suite that
   hardcodes 8 goes green against a shipped 2. */
const GAP = Number((readFileSync("public/js/shelf-shuffle.js", "utf8").match(/var GAP = (\d+)/) || [])[1]);
ok("the file states a gap", GAP >= 4, "GAP = " + GAP);
const cut = wide.map((r, i) => (trimIds.includes(r.pid) ? i : -1)).filter(i => i >= 0);
console.log("  offcut positions in the opening " + wide.length + ": " +
            (cut.length ? cut.join(", ") : "none"));
ok("no offcut leads the shelf", cut.length === 0 || cut[0] >= GAP,
   cut.length ? "first at position " + (cut[0] + 1) : "none on this shelf");
/* GAP IS A CEILING, NOT A PERIOD, and the difference is the whole second draft.
   A flat "one every eight" placed four and dumped the other eight in a block at
   the end -- 8, 17, 26, 35, then 40 through 47 -- which is the wall this exists
   to prevent, moved to the bottom, and a wall in the MIDDLE of the shelf as soon
   as somebody presses load-more. So the claim is SPACING, not a quota: never two
   together, and never so sparse that the surplus has to pile up somewhere.
   This fixture is deliberately a quarter offcuts, which is the hard case. */
let adjacent = 0;
for (let i = 1; i < cut.length; i++) if (cut[i] - cut[i - 1] < 2) adjacent++;
ok("...and no two sit together", adjacent === 0, adjacent + " adjacent pairs");
const tail = wide.length - 1 - (cut.length ? cut[cut.length - 1] : 0);
ok("...and they are not piled at the end either",
   cut.length < 3 || cut[cut.length - 1] - cut[cut.length - 3] >= 4,
   "last three at " + cut.slice(-3).join(", ") + " of " + wide.length + " (tail " + tail + ")");
/* THE OTHER HALF, AND THE ONE THAT MAKES THIS A RATIO RATHER THAN A FILTER.
   Capping the head is only half a fix: a shopper who wants shake has to be able
   to find it, and a deal that quietly dropped the surplus would pass every
   assertion above. Asked through the engine's own Trim/Shake facet, which is
   what a shopper would click -- and picking it marks the shelf touched, so the
   deal stands down and what comes back is the ranking, unmediated. */
const facet = await ev(`(function(){var s=document.getElementById("fCategory");
  if(!s) return "no #fCategory";
  var hit=[].filter.call(s.options,function(o){return /trim/i.test(o.value);})[0];
  if(!hit) return "no Trim/Shake option";
  s.value=hit.value; s.dispatchEvent(new Event("change",{bubbles:true})); return "picked";})()`);
await wait(700);
const onFacet = await ev(`document.querySelectorAll('#grid .card').length`);
ok("the Trim/Shake facet is offered at all", facet === "picked", String(facet));
ok("...and every offcut is still there when it is asked for",
   onFacet >= TRIM_TOTAL, onFacet + " cards under Trim/Shake, " + TRIM_TOTAL + " in the fixture");
/* Picking a facet marks the shelf touched and filters the grid, so the page is
   put back before the next group reads it -- otherwise "there was a Load more
   bar to press" fails against a twelve-card filtered shelf and reads as a
   paging bug. */
await goto("/");
await wait(400);

group("AND WHAT IS ALREADY DEALT STAYS DEALT");
/* Once the deal is random this stops being a nicety. Without it, pressing Load
   more re-deals the cards the shopper is looking at -- a feed does not reshuffle
   what you have scrolled past. */
const before12 = (await shelf()).slice(0, 12).map(r => r.pid).join("|");
const grew = await ev(`(function(){var b=document.querySelector("#grid .loadmore");
  if(!b) return "no bar"; b.click(); return "clicked";})()`);
await wait(1200);
const after = await shelf();
ok("there was a Load more bar to press", grew === "clicked", String(grew));
ok("...and it added cards", after.length > wide.length, wide.length + " -> " + after.length);
ok("...while the twelve already on screen kept their order",
   after.slice(0, 12).map(r => r.pid).join("|") === before12);
serveBig = false;

ok("no uncaught errors", errs.length === 0, errs.slice(0, 2).join(" | "));

console.log("\n" + (fails.length ? `FAILED: ${fails.join(", ")}` : "All assertions passed.") + "\n");
try { s.close() } catch {}
ch.kill(); srv.close();
process.exit(fails.length ? 1 : 0);
