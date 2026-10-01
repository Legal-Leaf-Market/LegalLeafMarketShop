/* The three rails on the page they were always missing from.

   "Shop by store", "Shop by category" and "Shop by brand" were worked out on
   NicotiaMarket and ported into tools/make-coldwater.mjs, where they sat as
   65KB of injection that legal-leafmarket.com -- the file every city page is
   GENERATED FROM -- could not use. They live in public/js/rails.js now, loaded
   by public/index.html and inherited by every city page the way the engine is.

   THIS SUITE DRIVES THE HALF NOTHING EVER DROVE. test-coldwater-page.mjs
   already exercises all three on a city page in real Chromium, so the move is
   proven there the moment it stays green. What had no coverage at all is the
   hemp shelf: a different feed, a different meta publisher, a different
   vocabulary, and one piece of copy that must NOT come along.

   FOUR THINGS IT PINS, each of which fails silently:

   1. ONE READ OF THE CATALOGUE. index.html already asked /api/products four
      times on a cold load -- the engine plus three additive blocks that each
      grew their own fetch. The response is ~7MB, and Vercel consumes the
      s-maxage directives at the edge, so what reaches a browser has no
      max-age at all. feed-meta.js taps instead of fetching; a fifth request
      here would mean it went back to fetching and nobody would notice.

   2. THE CHIPS ARE A FACE FOR THE ENGINE'S OWN CONTROLS. Every rail acts by
      setting #fStore / #fCategory / #q and firing their events, and its counts
      are the engine's counts. A rail that filtered behind the engine's back
      would look identical until its number disagreed with the grid.

   3. THE BRAND RAIL STAYS QUIET WITH NOTHING TO COMPARE. Measured on the
      deployed feed 19 Aug 2026: 168 makers, multiShop ONE. A brand at one shop
      is a label; the rail earns its place when a brand is at several. Rendering
      168 unclickable labels is not a neutral default, it is a price-comparison
      site claiming a comparison it cannot make.

   4. "YOUR TOWN NOT HERE? BRING IT ON" IS CITY-PAGE COPY. On the national hemp
      shelf it is addressed to nobody. Gated on window.LL_TOWN, which the
      generator sets -- deliberately not on localStorage's ll_cw:ctx, which
      survives the visit and would make the note appear on the hemp page for
      anyone who had used a city page. A bug only some visitors would ever see.

     node test-rails.mjs
*/
import { readFile } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { createServer } from "node:http";
import { extname, join } from "node:path";
import { chromePath, launchChrome } from "./tools/chrome-path.mjs";

process.env.LL_NO_STORE_FETCH = "1";
const CHROME = chromePath();
const PORT = 3494, CDP = 9348;
const fails = [];
const ok = (n, c, x = "") => { console.log(`${c ? "  PASS" : "  FAIL"}  ${n}${x ? "   (" + x + ")" : ""}`); if (!c) fails.push(n); };
const wait = ms => new Promise(r => setTimeout(r, ms));
async function until(fn, n = 100) { for (let i = 0; i < n; i++) { try { return await fn() } catch { await wait(250) } } throw new Error("timeout") }

/* TWO SHOPS, ONE MAKER ACROSS BOTH. The cross-shop brand is the whole reason
   the rail exists, so the fixture has to contain one or the rail's own headline
   number is untested. Wyld is at both; Cookies and Jeeter are at one each. */
function flower(id, name, store, storeKey, domain, brand, cat, img) {
  return {
    id, name, store, storeKey, domain, platform: "shopify",
    cannabinoid: cat === "Accessories" ? "Accessory" : "THCa", category: cat,
    type: "Indica", strain: name, image: img, url: "https://" + domain + "/p/" + id,
    brand, brandKey: brand.toLowerCase().replace(/[^a-z0-9]+/g, "-"),
    description: "Sentences for the back of the card.",
    inStock: true, startsAt: 25, sale: 25, perG: 0.89, ship: 5, badges: [],
    /* AN OUNCE UNDER $75 IS NOT OPTIONAL IN THIS FIXTURE, and finding that out
       cost a confusing first run. public/index.html opens the shelf on Ounce+
       AND a $75 budget -- deliberately, because that is what people arrive
       looking for -- so a fixture selling eighths, or an ounce at $200, is
       filtered out of every facet before a rail ever sees it. The rails then
       report the engine's BAKED GREEK GLASS SEED and nothing else, and the
       failures all point at the rails, which are working perfectly. */
    sizes: [["1/8 oz", 12, 3.5, id + "-s", true, "https://" + domain + "/p/" + id, "", 0],
            ["1 oz", 25, 28, id + "-o", true, "https://" + domain + "/p/" + id, "", 0]]
  };
}
const PIC = "/favicon.svg";
const FEED = {
  meta: { updated: new Date(0).toISOString(), total: 8,
          stores: [{ name: "Alpha Hemp", count: 3 }, { name: "Beta Hemp", count: 3 },
                   { name: "Grasscity", count: 1 }, { name: "Gamma Hemp", count: 1 }] },
  products: [
    flower("a1", "Alpha Gelato", "Alpha Hemp", "alpha", "alpha.test", "Wyld", "THCA Flower", PIC),
    flower("a2", "Alpha Runtz", "Alpha Hemp", "alpha", "alpha.test", "Cookies", "THCA Flower", PIC),
    flower("a3", "Alpha Gummy", "Alpha Hemp", "alpha", "alpha.test", "Wyld", "Edibles", PIC),
    flower("b1", "Beta Zkittlez", "Beta Hemp", "beta", "beta.test", "Wyld", "THCA Flower", PIC),
    flower("b2", "Beta Roll", "Beta Hemp", "beta", "beta.test", "Jeeter", "Pre-rolls", PIC),
    flower("b3", "Beta Grinder", "Beta Hemp", "beta", "beta.test", "Jeeter", "Accessories", PIC),
    /* A SHOP'S OWN HOUSE LABEL, under its real name, because the rule that draws
       the shop's mark on it is keyed on a stated pair (brandKey "gc" at store
       "Grasscity") rather than on a guess about short names. A fixture using
       invented names could not exercise it -- and inventing a matching pair in
       the source to suit the fixture would be the test writing the feature. */
    flower("g1", "GC Beaker", "Grasscity", "grasscity", "www.grasscity.test", "GC", "Accessories", PIC),
    /* A SHOP WHOSE PRODUCTS CARRY NO MAKER AT ALL, which is the majority case in
       production: the feed reports branded products at only SIX of the sixteen
       shops. Picking one of the other ten must HIDE the brand rail, not reset it
       -- the first version of the empty-list guard read "no makers here" as "the
       facet could not be answered" and came back showing all 155, reported as
       "the store and brand currently are not faceting together at all". A
       fixture where every shop has brands cannot catch that. */
    flower("n1", "Nameless Kush", "Gamma Hemp", "gamma", "gamma.test", "", "THCA Flower", PIC)
  ]
};
/* THE SAME FEED WITH NO MAKER ANYWHERE, for the "nothing to compare" case. */
const FEED_NOBRAND = { meta: FEED.meta,
  products: FEED.products.map(p => ({ ...p, brand: "", brandKey: "" })) };

let serveBrands = true;
const MIME = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css",
               ".svg": "image/svg+xml", ".png": "image/png", ".json": "application/json" };
let feedHits = 0;
/* A REAL PNG, ONE PIXEL. The arrow button prefers public/img/joint-arrow.png and
   falls back to a drawn SVG when it is absent, so BOTH branches need driving --
   and the fallback is the one that would rot unnoticed, because it only shows
   when somebody has not uploaded a file yet. Served here rather than committed,
   or the placeholder would BE the arrow in production. */
const PNG_1PX = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64");
let serveArrow = false;
const srv = createServer(async (req, res) => {
  const u = new URL(req.url, "http://x");
  if (u.pathname === "/img/joint-arrow.png") {
    /* NO-STORE, AND IT IS LOAD BEARING. launchChrome reuses a persistent profile
       across runs, so without this the browser answers from its DISK CACHE with
       whatever this fixture served last time -- and this suite deliberately
       serves the file in one section and withholds it in another. The symptom is
       a run that passes or fails depending on what the PREVIOUS run did, which
       is the worst kind of flake because it looks like a real regression in the
       fallback. */
    const nc = { "cache-control": "no-store, max-age=0" };
    if (!serveArrow) { res.writeHead(404, nc).end("no"); return; }
    res.writeHead(200, Object.assign({ "content-type": "image/png" }, nc));
    return res.end(PNG_1PX);
  }
  if (u.pathname === "/api/products") {
    feedHits++;
    res.writeHead(200, { "content-type": "application/json" });
    return res.end(JSON.stringify(serveBrands ? FEED : FEED_NOBRAND));
  }
  if (u.pathname.startsWith("/api/")) { res.writeHead(200, { "content-type": "application/json" }); return res.end("{}"); }
  const f = u.pathname === "/" ? "index.html" : u.pathname.replace(/^\//, "");
  try {
    const b = await readFile(join("public", f));
    res.writeHead(200, { "content-type": MIME[extname(f)] || "application/octet-stream" });
    res.end(b);
  } catch { res.writeHead(404).end("no"); }
});
await new Promise(r => srv.listen(PORT, "127.0.0.1", r));

const { proc: ch } = await launchChrome(CDP, [], { userDataDir: "/tmp/_llrails" });
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
/* Google Fonts is refused by the proxies this repo is edited from, and a
   render-blocking <link> to it stalls every script after it for ~13s -- the
   first run of test-coldwater.mjs reported zero rows and read exactly like a
   broken page. Any browser suite here wants these two lines. */
/* bigcartel.com too: public/engine.js refreshes Greek Glass from
   api.bigcartel.com on top of its baked seed, so any suite serving
   public/index.html calls a real merchant on a runner with network.
   LL_NO_STORE_FETCH covers api/ code and cannot cover a browser. Blocking it
   also makes the run deterministic instead of dependent on somebody's shop. */
await send("Network.setBlockedURLs", { urls: ["*fonts.googleapis.com*", "*fonts.gstatic.com*", "*bigcartel.com*"] });

async function goto() {
  await send("Page.navigate", { url: `http://127.0.0.1:${PORT}/` });
  await until(async () => { if (await ev(`document.readyState==='complete'`)) return true; throw 0 });
  await ev(`localStorage.setItem('ll_age_ok','1')`);
  feedHits = 0;
  await send("Page.navigate", { url: `http://127.0.0.1:${PORT}/` });
  await until(async () => { if (await ev(`document.readyState==='complete'`)) return true; throw 0 });
  await until(async () => { if ((await ev(`document.querySelectorAll('#grid .card').length`)) > 0) return true; throw 0 }, 80);
}

console.log("\nThe three rails on legal-leafmarket\n");
await goto();
await until(async () => { if (await ev(`!!(window.LL_META && window.LL_META.domains)`)) return true; throw 0 }, 60);

console.log("ONE READ OF THE CATALOGUE");
/* The engine's own request is the one that must happen. Everything else on this
   page reads the clone. A number above 1 means somebody went back to fetching. */
await wait(1200);
ok("the catalogue is fetched once for the whole page", feedHits === 1, feedHits + " requests");
ok("...and the tap publishes rather than re-reading",
   await ev(`!!(window.LL_META && window.LL_META.brands && window.LL_META.catPool)`));
ok("the shared accessor answers on this page too",
   await ev(`typeof window.LL_railsMeta === "function" && !!window.LL_railsMeta().domains`));

console.log("\nSHOP BY STORE");
/* THE ENGINE CARRIES A BAKED GREEK GLASS SEED inside the blob, which the city
   generator blanks and this page keeps on purpose -- it is real inventory here.
   So the shelf is the feed PLUS the seed, and an assertion counting only the
   feed's shops would be asserting something false about this page. The
   invariant that actually matters is the one the rail is built on: the chips
   are a FACE for #fStore, so there is exactly one chip per real option. */
const st = await ev(`(function(){
  var box=document.getElementById("storeLogos");
  var chips=box?[].slice.call(box.querySelectorAll(".lchip")):[];
  var sel=document.getElementById("fStore");
  var opts=[].map.call(sel.options,function(o){return o.value}).filter(function(v){return v});
  var names=chips.map(function(c){return c.querySelector(".lname").textContent});
  return {chips:chips.length, opts:opts.length, names:names.join("|"),
          missing:opts.filter(function(v){return names.indexOf(v)<0}).join(","),
          counts:chips.map(function(c){return c.querySelector(".lcount").textContent}).join("|"),
          marks:chips.filter(function(c){return !!c.querySelector(".limg")}).length};
})()`);
ok("one chip per shop the engine offers, no more and no fewer",
   st.chips === st.opts && st.chips > 0, st.chips + " chips / " + st.opts + " options");
ok("...including both shops in the feed", st.missing === "", "missing: " + st.missing);
ok("chips carry the shop names", /Alpha Hemp/.test(st.names) && /Beta Hemp/.test(st.names), st.names);
/* THE COUNTS ARE THE ENGINE'S OWN. That is what stops a chip drifting from the
   dropdown it is a face for -- it never holds a count of its own to drift. */
ok("chips carry the engine's own counts, not counts of their own",
   /\b3\b/.test(st.counts), st.counts);
ok("every chip has a mark, so none renders blank", st.marks === st.chips, st.marks + " of " + st.chips);
const stClick = await ev(`(function(){
  var c=document.querySelector('#storeLogos .lchip'); c.click();
  return {sel:document.getElementById("fStore").value,
          on:document.querySelectorAll('#storeLogos .lchip.on').length};
})()`);
ok("clicking a chip sets the engine's store filter", !!stClick.sel, stClick.sel);
ok("exactly one chip reads as selected", stClick.on === 1, String(stClick.on));
const stSync = await ev(`(function(){
  var s=document.getElementById("fStore"); s.value="Beta Hemp";
  s.dispatchEvent(new Event("change",{bubbles:true}));
  var on=document.querySelector('#storeLogos .lchip.on');
  return on?on.querySelector(".lname").textContent:"";
})()`);
ok("changing the select lights the matching chip", stSync === "Beta Hemp", stSync);
await ev(`(function(){var b=document.getElementById("clearStores"); if(b) b.click();})()`);

console.log("\nSHOP BY CATEGORY");
const ct = await ev(`(function(){
  var box=document.getElementById("catLogos");
  var chips=box?[].slice.call(box.querySelectorAll(".lchip")):[];
  return {chips:chips.length,
          names:chips.map(function(c){return c.querySelector(".lname").textContent}).join("|"),
          values:chips.map(function(c){return c.getAttribute("data-logocat")}).join("|"),
          photos:chips.filter(function(c){return !!c.querySelector(".bimg")}).length,
          groups:chips.filter(function(c){return (c.getAttribute("data-logocat")||"").indexOf("__")===0}).length};
})()`);
ok("the category strip rendered", ct.chips > 0, ct.chips + " chips: " + ct.names);
ok("...and the feed's own categories are among them",
   /Flower/.test(ct.values) && /Pre-rolls/.test(ct.values), ct.values);
/* The engine nests real categories under optgroups whose values start "__";
   a chip offering one would filter to the parent of the chips beside it. */
ok("...and offers no synthetic group row as a chip", ct.groups === 0, String(ct.groups));
ok("a category chip uses a real product photo, not only a drawn mark",
   ct.photos > 0, ct.photos + " of " + ct.chips);
/* THE KEYING TRAP, and the reason feed-meta.js writes its caveat down: catPool
   is keyed on the FEED's category while the chip is keyed on what reaches
   #fCategory, and the engine reclassifies by name on the way in. A chip whose
   value is not a real option is a chip that filters to nothing. */
const ctReal = await ev(`(function(){
  var sel=document.getElementById("fCategory");
  var vals=[].map.call(sel.options,function(o){return o.value});
  var chips=[].map.call(document.querySelectorAll('#catLogos .lchip'),
    function(c){return c.getAttribute("data-logocat")});
  return chips.filter(function(v){return vals.indexOf(v)<0}).join(",");
})()`);
ok("every chip's value is an option the engine actually offers", ctReal === "", ctReal);
const ctClick = await ev(`(function(){
  var c=document.querySelector('#catLogos .lchip'); var v=c.getAttribute("data-logocat"); c.click();
  return {want:v, got:document.getElementById("fCategory").value,
          cards:document.querySelectorAll('#grid .card').length};
})()`);
ok("clicking a chip sets the engine's category filter", ctClick.want === ctClick.got,
   ctClick.want + " vs " + ctClick.got);
ok("...and the grid narrows rather than emptying", ctClick.cards > 0, ctClick.cards + " cards");
await ev(`(function(){var b=document.getElementById("clearCats"); if(b) b.click();})()`);

console.log("\nSHOP BY BRAND");
const br = await ev(`(function(){
  var sec=document.getElementById("brandRow");
  var chips=[].slice.call(document.querySelectorAll('#brandLogos .lchip'));
  return {hidden:!!(sec&&sec.hidden), chips:chips.length,
          first:chips.length?chips[0].querySelector(".lname").textContent:"",
          firstCount:chips.length?chips[0].querySelector(".lcount").textContent:"",
          note:(document.getElementById("brandNote")||{}).textContent||""};
})()`);
ok("the brand rail is shown when the feed carries makers", br.hidden === false, String(br.hidden));
ok("one chip per maker", br.chips === 4, br.chips + " chips");
/* THE CROSS-SHOP MAKER LEADS, because that is the only chip on the rail that is
   a price comparison rather than a label. */
ok("the maker carried at more than one shop sorts first", br.first === "Wyld", br.first);
ok("...and says how many shops carry it, which is why it is worth clicking",
   /2 shops/.test(br.firstCount), br.firstCount);
ok("the note counts the comparison, not just the labels",
   /4 brands/.test(br.note) && /1 sold at more than one shop/.test(br.note), br.note);
ok("...and says whose names and images these are, on the rail rather than in the footer",
   /no affiliation or endorsement/.test(br.note));
const brClick = await ev(`(function(){
  var c=document.querySelector('#brandLogos .lchip'); c.click();
  return {q:document.getElementById("q").value,
          on:document.querySelectorAll('#brandLogos .lchip.on').length};
})()`);
/* The engine has no brand control, so the chip types into the engine's own
   search box rather than filtering behind its back and disagreeing with the
   count it prints. */
ok("a brand chip drives the engine's own search box", brClick.q === "Wyld", brClick.q);
ok("exactly one brand chip reads as selected", brClick.on === 1, String(brClick.on));

console.log("\nA SHOP'S OWN LABEL WEARS THE SHOP'S MARK");
/* Reported with a screenshot: the Grasscity chip on the store strip is right and
   the GC chip below it is a washed-out product shot, "and they should both be
   the store one". GC is Grasscity's house line, so the shop's mark is the
   correct picture rather than merely a nicer one. */
await wait(500);
const marks = await ev(`(function(){
  function src(sel){ var i=document.querySelector(sel); return i?i.getAttribute("src"):""; }
  function chip(row,label){
    var cs=[].slice.call(document.querySelectorAll(row+" .lchip"));
    for(var i=0;i<cs.length;i++){
      var n=cs[i].querySelector(".lname");
      if(n&&n.textContent.trim()===label){ var im=cs[i].querySelector("img"); return im?im.getAttribute("src"):""; }
    }
    return "";
  }
  return { gcBrand: chip("#brandLogos","GC"), gcStore: chip("#storeLogos","Grasscity"),
           wyld: chip("#brandLogos","Wyld"),
           gcPlate: (function(){var cs=[].slice.call(document.querySelectorAll("#brandLogos .lchip"));
             for(var i=0;i<cs.length;i++){var n=cs[i].querySelector(".lname");
               if(n&&n.textContent.trim()==="GC"){var p=cs[i].querySelector(".limg");return p?p.className:"no plate";}}
             return "no GC chip";})(),
           wyldPlate: (function(){var cs=[].slice.call(document.querySelectorAll("#brandLogos .lchip"));
             for(var i=0;i<cs.length;i++){var n=cs[i].querySelector(".lname");
               if(n&&n.textContent.trim()==="Wyld"){var p=cs[i].querySelector(".limg");return p?p.className:"no plate";}}
             return "no Wyld chip";})(),
           /* The URL the rail WOULD write, rebuilt from the same helper and the
              same domain the rail reads -- a claim about the wiring that no
              failed image request can erase. */
           gcWrote: (function(){try{var d=(window.LL_railsMeta().domains||{})["Grasscity"]||"";
             return d?window.LL_railsFavicon(d):"";}catch(e){return "ERR";}})(),
           storeWrote: (function(){try{var d=(window.LL_railsMeta().domains||{})["Grasscity"]||"";
             return d?window.LL_railsFavicon(d):"";}catch(e){return "ERR";}})() };
})()`);
/* ASSERTED ON WHAT THE RAIL WROTE, NOT ON WHAT SURVIVED. Comparing the two
   chips' img src looked like the honest end-to-end check and is a race: these
   marks are fetched from a third-party favicon service, the fixture's domains
   are fake, and once BOTH sources fail the handler removes the img and leaves
   the monogram. Read early the comparison passes, read late both are empty and
   it passes vacuously -- the first draft of this did exactly that in both
   directions on consecutive runs.
   The plate class is the rail's own decision and no network can take it away:
   `photo` is set only where a real picture was chosen, and a house label is the
   only brand chip that gets it from the shop rather than from a product. */
ok("the house label is drawn from the shop, not from a product photo",
   marks.gcPlate.indexOf("photo") >= 0, "GC plate: " + marks.gcPlate);
ok("...with the same mark the store strip uses",
   marks.gcWrote && marks.gcWrote === marks.storeWrote,
   "brand " + String(marks.gcWrote).slice(0, 58) + " | store " + String(marks.storeWrote).slice(0, 58));
/* THE COUNTER-CASE IS THE WHOLE POINT, and it is why this is a stated pair
   rather than a rule about short all-capital names: RAW is exactly as short and
   exactly as capital as GC, sells at one shop here too, and is a real maker
   whose products this site compares. A heuristic catching GC catches RAW, and a
   confidently wrong picture is the failure the category rail spent three reports
   learning to refuse. */
ok("...while an ordinary maker is not given the shop's mark",
   marks.wyldPlate.indexOf("photo") < 0, "Wyld plate: " + marks.wyldPlate);
const houseSrc = readFileSync("public/js/rails.js", "utf8");
ok("...and the pairing is stated rather than inferred from the name",
   /var HOUSE = \{ gc: "Grasscity" \}/.test(houseSrc));
/* The store must be one of the brand's own, so a future "gc" at another shop
   cannot inherit Grasscity's mark by name alone. */
ok("...and is checked against the brand's own shops",
   /b\.stores\.indexOf\(houseShop\) >= 0/.test(houseSrc));
/* ONE FAVICON RULE, TWO RAILS. The store strip built these URLs inline and the
   brand strip now needs the same pair; twinning them is what four copies of
   storeCheckoutUrl() taught this repo not to do. */
/* THREE SOURCES, NOT TWO. Reported missing for YLLVAPE, Lookah and THCA4Cheap --
   three small shops neither third-party service has an entry for, so the chain
   ran out and left a tinted letter. A shop's own /favicon.ico is served by the
   shop itself and an <img> may load it cross-origin, so it needs no permission
   and no fourth party to be up. Last, because the services return a normalised
   square while a site's own icon can be a 16px .ico that looks poor at 54px:
   better than a letter, worse than a real mark. */
ok("the chain ends at the shop's own icon rather than at a monogram",
   /LL_railsFaviconOwn/.test(houseSrc) && /\/favicon\.ico/.test(houseSrc));
ok("...with a plate-sized icon tried before the 16px one",
   /LL_railsFaviconTouch/.test(houseSrc) && /apple-touch-icon\.png/.test(houseSrc) &&
   houseSrc.indexOf("FaviconTouch(dom)") < houseSrc.indexOf("FaviconOwn(dom)"));
/* Asserted on the SHAPE rather than on the exact list, so adding a fourth source
   is a string and not another red test: what must hold is that the fallbacks are
   space-joined into one attribute and shifted off one at a time. */
ok("...and the remaining sources ride in one attribute, so adding one is a string",
   /Alt\(dom\) \+ " " \+[\s\S]{0,120}Own\(dom\)/.test(houseSrc) && /rest\.shift\(\)/.test(houseSrc));
const chain = await ev(`(function(){
  var i=document.querySelector("#storeLogos .lchip img");
  return i ? { src:i.getAttribute("src")||"", alt:i.getAttribute("data-alt")||"" } : null; })()`);
/* READ WHEREVER THE CHAIN HAS GOT TO, not at its head. The fixture's domains are
   invented, so Google answers nothing and the handler has usually already
   shifted to DuckDuckGo by the time this runs -- which is the chain WORKING, and
   asserting on the first source made a correct page look broken. What must hold
   at any moment is that the chip is somewhere in the declared sequence and that
   the shop's own icon is still the last thing standing. */
/* apple-touch-icon sits between the services and favicon.ico: reported as
   "Lookah logo is there but it looks blurry" once the shop's own icon started
   answering, which is a 16px .ico stretched to 54px. The touch icon is 180px by
   convention, so it upscales to nothing. */
const SEQ = ["google.com/s2/favicons", "icons.duckduckgo.com",
             "/apple-touch-icon.png", "/favicon.ico"];
const atStep = chain ? SEQ.findIndex(p => chain.src.indexOf(p) >= 0) : -1;
ok("a store chip sits somewhere in the declared source chain", atStep >= 0, JSON.stringify(chain));
ok("...with every later source still queued behind it, in order",
   chain && SEQ.slice(atStep + 1).every((p, i) =>
     (chain.alt.split(/\s+/).filter(Boolean)[i] || "").indexOf(p) >= 0),
   "at step " + atStep + ", queued: " + (chain && chain.alt));

ok("both rails build the mark through one helper",
   (houseSrc.match(/LL_railsFavicon\(/g) || []).length >= 2 &&
   !/icons\.duckduckgo\.com[\s\S]{0,40}encodeURIComponent\(dom\)/.test(houseSrc));
/* AND THE FALLBACK STRIPS www., which is a real fix rather than tidiness:
   DuckDuckGo's ip3 endpoint is keyed on the registrable domain and misses a
   www-prefixed host, and five roster domains carry the prefix -- Grasscity among
   them -- so for exactly those shops the chain was one deep, not two. */
ok("...and the second source is asked for a domain it can answer",
   /replace\(\/\^www\\\.\/i, ""\)/.test(houseSrc));

console.log("\nAND THE BRAND RAIL ANSWERS THE OTHER TWO");
/* Reported as "the brand strip is not faceted to the others, it isn't filtering
   or changing when I click on the other circles". The store and category strips
   are faces for controls the engine owns, so they cannot drift; the engine has
   no brand control, so this rail is built from the feed -- and a rail built from
   the whole feed says the same thing under every filter.
   THE FIXTURE MAKES IT MEASURABLE: Wyld is at both Alpha and Beta, Cookies only
   at Alpha, Jeeter only at Beta. So picking Alpha must drop Jeeter and keep
   Cookies, and Wyld's count must fall from 3 to 2. */
const beforeF = await ev(`(function(){
  var out={}; [].forEach.call(document.querySelectorAll("#brandLogos .lchip"),function(c){
    out[c.querySelector(".lname").textContent.trim()] = c.querySelector(".lcount").textContent.trim(); });
  return out; })()`);
await ev(`(function(){ var s=document.getElementById("q"); if(s){ s.value=""; s.dispatchEvent(new Event("input",{bubbles:true})); }
  var f=document.getElementById("fStore"); f.value="Alpha Hemp";
  f.dispatchEvent(new Event("change",{bubbles:true})); return true; })()`);
await wait(700);
const afterF = await ev(`(function(){
  var out={}; [].forEach.call(document.querySelectorAll("#brandLogos .lchip"),function(c){
    out[c.querySelector(".lname").textContent.trim()] = c.querySelector(".lcount").textContent.trim(); });
  return out; })()`);
console.log("  all shops: " + JSON.stringify(beforeF));
console.log("  Alpha only: " + JSON.stringify(afterF));
ok("a maker sold only at another shop leaves the rail",
   "Jeeter" in beforeF && !("Jeeter" in afterF), JSON.stringify(Object.keys(afterF)));
ok("...while one this shop carries stays", "Cookies" in afterF, JSON.stringify(Object.keys(afterF)));
/* THE NUMBER IS THE HALF THAT WOULD LIE. A chip that survived the filter still
   printing its whole-catalogue count is a number the shopper can see is wrong. */
/* THE LEADING NUMBER ONLY. Written first as a loose digit test, it matched the
   "2" in "2 shops" and passed against the unfixed rail -- a chip reading
   "3 . 2 shops" under an Alpha-only filter satisfied it. The count is the first
   number on the chip; the shop tally after it is a different claim. */
const lead = v => Number(String(v || "").trim().match(/^\d+/) || [NaN]);
ok("...and the count is the maker's within this shop, not across the feed",
   lead(beforeF.Wyld) === 3 && lead(afterF.Wyld) === 2,
   "Wyld: " + beforeF.Wyld + " -> " + afterF.Wyld);
/* AND IT COMES BACK. A filter that cannot be undone is worse than one that never
   applied, and the rail is rebuilt rather than mutated in place. */
await ev(`(function(){ var f=document.getElementById("fStore"); f.value="";
  f.dispatchEvent(new Event("change",{bubbles:true})); return true; })()`);
await wait(700);
const restored = await ev(`document.querySelectorAll("#brandLogos .lchip").length`);
ok("...and clearing the shop brings every maker back",
   restored === Object.keys(beforeF).length, restored + " chips, was " + Object.keys(beforeF).length);
/* AND A SHOP WITH NO MAKERS HIDES THE RAIL RATHER THAN RESETTING IT. This is the
   case the first guard got backwards, and the majority case in production: only
   six of sixteen shops carry a branded product, so "no makers at this shop" is
   the normal answer and must not be read as "the question could not be
   answered". Showing all 155 makers under a shop that has none is the exact
   shape of "the store and brand are not faceting together at all". */
await ev(`(function(){ var f=document.getElementById("fStore"); f.value="Gamma Hemp";
  f.dispatchEvent(new Event("change",{bubbles:true})); return true; })()`);
await wait(700);
const noMakers = await ev(`(function(){ var s=document.getElementById("brandRow");
  return { hidden:!!(s&&s.hidden), chips:document.querySelectorAll("#brandLogos .lchip").length }; })()`);
ok("a shop whose products carry no maker hides the rail",
   noMakers.hidden && noMakers.chips === 0, JSON.stringify(noMakers));
await ev(`(function(){ var f=document.getElementById("fStore"); f.value="";
  f.dispatchEvent(new Event("change",{bubbles:true})); return true; })()`);
await wait(600);
const back = await ev(`(function(){ var s=document.getElementById("brandRow");
  return { hidden:!!(s&&s.hidden), chips:document.querySelectorAll("#brandLogos .lchip").length }; })()`);
ok("...and comes back when the shop is cleared",
   !back.hidden && back.chips === Object.keys(beforeF).length, JSON.stringify(back));
/* AND THE CATEGORY AXIS TOO, which travels through a translation on a city page
   and not on this one. In the fixture Cookies is flower only and Jeeter has the
   pre-roll and the grinder, so picking Pre-rolls must leave exactly Jeeter. */
await ev(`(function(){ var f=document.getElementById("fCategory");
  var hit=[].filter.call(f.options,function(o){return /pre-?roll/i.test(o.value);})[0];
  if(!hit) return "no option"; f.value=hit.value;
  f.dispatchEvent(new Event("change",{bubbles:true})); return hit.value; })()`);
await wait(700);
const byCat = await ev(`[].map.call(document.querySelectorAll("#brandLogos .lchip .lname"),
  function(n){return n.textContent.trim();})`);
ok("a category narrows the rail as well as a shop",
   byCat.indexOf("Jeeter") >= 0 && byCat.indexOf("Cookies") < 0, JSON.stringify(byCat));
await ev(`(function(){ var f=document.getElementById("fCategory"); f.value="";
  f.dispatchEvent(new Event("change",{bubbles:true})); return true; })()`);
await wait(600);
/* THE TRANSLATION IS LEARNED FROM THE CARDS, not copied from the engine. On this
   shelf the two vocabularies agree, so the alias table is not what makes the
   assertion above pass -- it is what makes the same code work on a city page,
   where the feed says "Flower" and the engine says "THCA Flower". Asserted on
   the mechanism so the city page is not the only thing standing behind it. */
/* ASSERTED POSITIVELY, because the negative form walked into the trap this repo
   has now hit five times: "and rails.js carries no copy of normCategory" went
   red against the COMMENT explaining why it carries no copy of normCategory. */
ok("...through a table learned off the rendered cards",
   /var ALIAS = \{\}/.test(houseSrc) && /data-pid\]\[data-cat\]/.test(houseSrc) &&
   /ALIAS\[eng\]/.test(houseSrc));

console.log("\nTHE COPY THAT MUST NOT TRAVEL");
/* Gated on window.LL_TOWN, which the generator sets. Reading localStorage's
   ll_cw:ctx instead would make this appear on the hemp page for anybody who
   had ever opened a city page -- a bug most people would never reproduce. */
ok("no town-recruitment note on the national shelf",
   (await ev(`!document.getElementById("cwl-amb")`)));
ok("...and the page never claimed to be a town",
   (await ev(`!window.LL_TOWN`)));

console.log("\nTHE RAIL WITH NOTHING TO COMPARE");
serveBrands = false;
await goto();
await until(async () => { if (await ev(`!!(window.LL_META && window.LL_META.domains)`)) return true; throw 0 }, 60);
await wait(600);
const bare = await ev(`(function(){
  var sec=document.getElementById("brandRow");
  return {present:!!sec, hidden:!!(sec&&sec.hidden),
          chips:document.querySelectorAll('#brandLogos .lchip').length,
          store:document.querySelectorAll('#storeLogos .lchip').length,
          cat:document.querySelectorAll('#catLogos .lchip').length};
})()`);
ok("the brand rail is installed but draws nothing when no maker is named",
   bare.present && bare.hidden && bare.chips === 0, JSON.stringify(bare));
/* A feed missing one field must not take the other two rails with it. */
ok("...and the other two rails are unaffected by it", bare.store === st.chips && bare.cat > 0,
   "store " + bare.store + ", cat " + bare.cat);

/* --------------------------------------------------------------------------
   THE JOINTS. "I don't want them scrollable on desktop at all. I really just
   want some arrows on either side that get brighter and less opaque as you
   hover ... have those arrows be joints."

   Two halves, and the second is the one that is easy to ship broken: buttons
   that move the rail, AND a rail that no longer moves any other way. Shipping
   only the first leaves two controls disagreeing about where the rail is, and
   nothing errors. */
console.log("\nTHE JOINT ARROWS");
await send("Emulation.setDeviceMetricsOverride",
  { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false });
await wait(600);
await ev(`window.dispatchEvent(new Event("resize"))`);
await wait(400);

const j = await ev(`(function(){
  var w=document.querySelector(".lrwrap");
  if(!w) return {none:true};
  var prev=w.querySelector(".lrjoint-prev"), next=w.querySelector(".lrjoint-next");
  var box=w.querySelector(".lrscroll");
  return {
    prev:!!prev, next:!!next,
    dupes:w.querySelectorAll(".lrjoint").length,
    label:prev?prev.getAttribute("aria-label"):"",
    svg:!!(prev&&prev.querySelector("svg")),
    ember:!!(prev&&prev.querySelector(".lrj-ember")),
    smoke:prev?prev.querySelectorAll(".lrj-smoke").length:0,
    overflow:box?getComputedStyle(box).overflowX:"",
    idle:next?Number(getComputedStyle(next).opacity):-1,
    shown:next?getComputedStyle(next).display:""
  };
})()`);
ok("both joints are drawn into the rail", !!j.prev && !!j.next, JSON.stringify(j).slice(0,90));

/* THE TWO RAILS IN THE PAIR ARE THE SAME HEIGHT, so their arrows line up.
   "The category rail needs to be taller to match so that the arrows in the
   middle line up vertically." Store names wrap to two lines ("CBD Hemp Direct",
   "Nothing But Canna") and category names mostly do not ("Vaporizers",
   "Edibles"), so the two columns ended up different heights -- and the joints
   sit at top:50% of their OWN rail, so they landed at two different midpoints
   with the divider running between them. Measured without the fix: heights
   [144,129], midpoints [408,401]. The chip reserves both lines now, so it holds
   for any pair of rails in any order whatever names arrive tomorrow. */
const pair = await ev(`(function(){
  var ws=document.querySelectorAll(".lrpair .lrwrap");
  if (ws.length < 2) return {rails:ws.length};
  var mids=[], hs=[];
  for (var i=0;i<ws.length;i++){
    hs.push(Math.round(ws[i].getBoundingClientRect().height));
    var j=ws[i].querySelector(".lrjoint");
    var r=j?j.getBoundingClientRect():null;
    mids.push(r?Math.round(r.top+r.height/2):null);
  }
  return {rails:ws.length, hs:hs, mids:mids};})()`);
ok("the facet pair holds two rails to compare", pair.rails >= 2, JSON.stringify(pair));
if (pair.rails >= 2) {
  ok("both rails are the same height", pair.hs[0] === pair.hs[1], JSON.stringify(pair.hs));
  ok("...so their arrows sit on the same line",
     pair.mids[0] != null && Math.abs(pair.mids[0] - pair.mids[1]) <= 1, JSON.stringify(pair.mids));
}

/* THE RAIL OPENS ONE STEP IN, a state the owner picked by scrolling to it: "I
   like the view best when I've clicked over once to the right -- that's exactly
   how I want the start state." At scrollLeft 0 the left edge is flush, so the
   fade has nothing to do and the left arrow has nowhere to go; one step in, both
   edges have chips dissolving under them and both arrows are live.
   ASSERTED FIRST, before anything below scrolls a rail, or it measures the suite
   rather than the page. */
const open0 = await ev(`(function(){var w=document.querySelector(".lrwrap");
  var b=w.querySelector(".lrscroll");
  return {left:Math.round(b.scrollLeft), max:Math.round(b.scrollWidth-b.clientWidth),
          prev:w.classList.contains("can-prev"), next:w.classList.contains("can-next")};})()`);
ok("the rail opens part way along rather than flush left", open0.left > 12, JSON.stringify(open0));
ok("...and not so far that it has run out of rail", open0.left < open0.max, JSON.stringify(open0));
ok("...so both directions are live from the first paint", open0.prev && open0.next, JSON.stringify(open0));

/* EVERY RAIL, BOTH DIRECTIONS. There are three -- store, category and brand --
   built at different times by different blocks, and the brand rail has already
   once inherited a rail's markup with none of the behaviour behind it. A pair on
   the first rail proves nothing about the other two. */
const allRails = await ev(`(function(){
  var w=document.querySelectorAll(".lrwrap"), out=[];
  for (var i=0;i<w.length;i++){
    var id=(w[i].querySelector(".lrscroll")||{}).id||"?";
    out.push({rail:id, prev:w[i].querySelectorAll(".lrjoint-prev").length,
              next:w[i].querySelectorAll(".lrjoint-next").length});
  }
  return out;
})()`);
ok("every rail on the page has exactly one of each",
   allRails.length >= 3 && allRails.every(r => r.prev === 1 && r.next === 1),
   JSON.stringify(allRails));

/* AND THEY POINT OPPOSITE WAYS. The drawn SVG is authored pointing left and the
   photograph is shot pointing right, so they are mirrored on opposite selectors
   -- get that wrong and you have a tidy pair of arrows that both point the same
   way, or point at each other, and it reads as working until somebody follows
   one. Measured off the computed transform rather than the class. */
const facing = await ev(`(function(){
  function m(sel,kind){var e=document.querySelector(sel+" "+kind);
    return e?getComputedStyle(e).transform:"none";}
  return {svgPrev:m(".lrjoint-prev","svg:not(.lrj-puff)"), svgNext:m(".lrjoint-next","svg:not(.lrj-puff)")};
})()`);
const flipped = (t) => /matrix\(\s*-1/.test(String(t));
ok("the drawn arrow is unflipped one way and mirrored the other",
   !flipped(facing.svgPrev) && flipped(facing.svgNext), JSON.stringify(facing));
ok("...exactly once, not once per sync", j.dupes === 2, j.dupes + " in the first rail");
/* Measured on the NEXT joint. At scrollLeft 0 the prev one is legitimately
   hidden -- there is nothing that way -- so asking it whether joints are visible
   at desktop width is asking the one button guaranteed to say no. */
ok("...and they are visible at desktop width", j.shown === "flex", j.shown);
ok("the arrow is an inline drawing, not an image request", j.svg);
ok("it has a lit tip", j.ember);
ok("and three smoke ribbons rather than one hair", j.smoke === 3, String(j.smoke));
ok("a screen reader is told what it does, not what it is drawn as",
   /scroll/i.test(j.label || "") && !/joint/i.test(j.label || ""), JSON.stringify(j.label));

/* DIM AT REST, BRIGHT ON HOVER -- the whole brief. Measured as computed opacity
   rather than as a class, because the class could be applied and the rule still
   lost on specificity. */
/* DIM, BUT NOT FURNITURE. It sat at .34 and read as decoration; brightened to
   .62 on the owner's call. The band is what matters rather than the number --
   clearly visible at rest, and still clearly dimmer than the lit hover state, or
   the brightening stops saying "this is a button". */
ok("a live joint sits dim until noticed", j.idle >= 0.5 && j.idle < 0.85, String(j.idle));
/* THE RAIL MUST NOT SCROLL ANY OTHER WAY ON DESKTOP. */
ok("the rail itself no longer scrolls on desktop", j.overflow === "hidden", j.overflow);
const dragMoved = await ev(`(function(){
  /* The rail opens part way along now, so "did not move" is a comparison against
     where it actually was -- pinning it to 0 would be asserting the opening
     offset away. scroll-behavior is smooth at desktop width, so the assignment
     is forced instant or the read below catches the animation mid-flight. */
  var box=document.querySelector(".lrscroll");
  box.style.scrollBehavior="auto"; box.scrollLeft=140; var from=box.scrollLeft;
  var r=box.getBoundingClientRect(), y=r.top+r.height/2;
  function pd(t,x){ box.dispatchEvent(new PointerEvent(t,{bubbles:true,clientX:x,clientY:y,pointerType:"mouse"})); }
  document.dispatchEvent(new PointerEvent("pointerdown",{bubbles:true,clientX:r.left+200,clientY:y,pointerType:"mouse"}));
  document.dispatchEvent(new PointerEvent("pointermove",{bubbles:true,clientX:r.left+40,clientY:y,pointerType:"mouse"}));
  document.dispatchEvent(new PointerEvent("pointerup",{bubbles:true,clientX:r.left+40,clientY:y,pointerType:"mouse"}));
  return {from:from, to:box.scrollLeft};
})()`);
ok("dragging it does nothing there", dragMoved.to === dragMoved.from,
   dragMoved.from + " -> " + dragMoved.to);

/* AND THE JOINT MUST ACTUALLY MOVE IT -- a dim button that does nothing is the
   failure this rail has already shipped once, under a different drawing. */
const before = await ev(`(function(){var b=document.querySelector(".lrscroll");
  b.style.scrollBehavior="auto"; b.scrollLeft=0; b.style.scrollBehavior="";
  return b.scrollLeft})()`);
await ev(`document.querySelector(".lrjoint-next").click(); true`);
await wait(700);
const after = await ev(`document.querySelector(".lrscroll").scrollLeft`);
ok("pressing the right joint moves the rail right", after > before, before + " -> " + after);
await ev(`document.querySelector(".lrjoint-prev").click(); true`);
await wait(700);
const backTo = await ev(`document.querySelector(".lrscroll").scrollLeft`);
ok("...and the left one brings it back", backTo < after, after + " -> " + backTo);

/* A SPENT JOINT AT THE END OF THE RAIL. can-prev is off at scrollLeft 0, and the
   left joint has to go out with it or it is a live control with nowhere to go. */
await ev(`(function(){var b=document.querySelector(".lrscroll");b.scrollLeft=0;
  b.dispatchEvent(new Event("scroll",{bubbles:true}));})()`);
await wait(300);
const spent = await ev(`(function(){
  var w=document.querySelector(".lrwrap"), p=w.querySelector(".lrjoint-prev");
  var s=getComputedStyle(p);
  return {canPrev:w.classList.contains("can-prev"), disp:s.display,
          w:Math.round(p.getBoundingClientRect().width)};
})()`);
/* GONE, NOT DIMMED. At .07 it read as a grease mark on the screen rather than as
   a spent joint -- visible enough to notice, too faint to identify, and sitting
   where a lit photograph had just been. */
/* THE ARROWS DO NOT GO AWAY AT THE ENDS. "I don't ever want the arrows to go
   away -- as long as the rail is there I want an arrow on the left and the
   right." Two earlier answers were both wrong: dimming a spent joint to .07 read
   as a grease mark on the screen, and hiding one per side made the pair flicker
   in and out under the shopper's own scrolling. A control that disappears as you
   use it is worse than one that is briefly a no-op. */
ok("hard against the left end, the rail says so", spent.canPrev === false, JSON.stringify(spent));
ok("...and the left joint STAYS anyway", spent.disp === "flex", spent.disp);
ok("...at full size, not a sliver", spent.w > 40, String(spent.w));

/* The one case they do go: a rail with nothing to scroll at all. */
const noRail = await ev(`(function(){
  var w=document.querySelector(".lrwrap");
  var had=[w.classList.contains("can-prev"), w.classList.contains("can-next")];
  w.classList.remove("can-prev"); w.classList.remove("can-next");
  var d=getComputedStyle(w.querySelector(".lrjoint-next")).display;
  if(had[0]) w.classList.add("can-prev"); if(had[1]) w.classList.add("can-next");
  return d;})()`);
ok("a rail with nowhere to go carries no joints at all", noRail === "none", String(noRail));

/* THE PHOTOGRAPH TAKES OVER THE MOMENT IT EXISTS, and nothing else changes.
   This is the whole reason the button is built with a fallback rather than
   pointed straight at a file somebody still has to upload: shipping that would
   mean a missing control for however long it took, and "the arrows vanished" is
   a worse bug than "the arrows are drawn rather than photographed". */
serveArrow = true;
await ev(`(function(){var w=document.querySelector(".lrwrap");
  var b=w.querySelectorAll(".lrjoint"); for(var i=0;i<b.length;i++) b[i].remove();})()`);
await ev(`window.dispatchEvent(new Event("resize"))`);
await wait(900);
const photo = await ev(`(function(){
  var b=document.querySelector(".lrjoint-prev");
  var im=b.querySelector(".lrj-img");
  return {img:!!im, cls:b.className, svg:!!b.querySelector("svg:not(.lrj-puff)"),
          puff:b.querySelectorAll(".lrj-puff .lrj-smoke").length};
})()`);
ok("with the file present the button uses the photograph", photo.img === true, JSON.stringify(photo));
ok("...and marks itself so the hover can light it", /lrj-photo/.test(photo.cls || ""), photo.cls);
ok("...the drawing stands down rather than stacking behind it", photo.svg === false, String(photo.svg));
ok("...and the animated smoke is still overlaid, since a photograph cannot puff",
   photo.puff === 3, String(photo.puff));
serveArrow = false;

/* PHONES KEEP THE SWIPE. Taking it away there would be a worse rail for no
   reason, and the gate is a width, so this is the half that proves the width
   is doing the work. */
await send("Emulation.setDeviceMetricsOverride",
  { width: 390, height: 780, deviceScaleFactor: 2, mobile: true });
await wait(500);
await ev(`window.dispatchEvent(new Event("resize"))`);
await wait(400);
const mob = await ev(`(function(){
  var box=document.querySelector(".lrscroll"), p=document.querySelector(".lrjoint-prev");
  return {overflow:getComputedStyle(box).overflowX, joint:getComputedStyle(p).display};
})()`);
ok("on a phone the rail still scrolls", mob.overflow === "auto" || mob.overflow === "scroll", mob.overflow);
ok("...and the joints stay out of the way", mob.joint === "none", mob.joint);
await send("Emulation.setDeviceMetricsOverride",
  { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false });
await wait(300);

console.log("\nNO COLLATERAL");
ok("no uncaught errors on the page", errs.length === 0, errs.slice(0, 2).join(" | "));

console.log("\n" + (fails.length ? `FAILED: ${fails.join(", ")}` : "All assertions passed.") + "\n");
try { s.close() } catch {}
ch.kill(); srv.close();
process.exit(fails.length ? 1 : 0);
