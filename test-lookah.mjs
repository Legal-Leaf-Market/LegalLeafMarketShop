/* test-lookah.mjs — the Lookah shop front, in a real browser.
 *
 * /lookah is the first BRAND page on this site: one shop's 969 products
 * fronted by that shop's own six buckets rather than by this site's eight
 * gear categories. Everything it can get wrong is silent -- a bucket that
 * catches nothing renders as a shop that sells none of that, and a cascade
 * that falls through to "More" too often renders as a shop with no taxonomy.
 *
 * WHAT IS PINNED, and why each one is a separate claim:
 *
 *  1. THE CASCADE, STEP BY STEP. Their url first (739 of 971 rows resolve on
 *     that alone), then our gear category, then the product name, then More.
 *     Each step is exercised by a product the EARLIER steps cannot answer, so
 *     a suite cannot pass by having step one do all the work.
 *  2. THE SLICE IS ASKED FOR SERVER-SIDE. The page must request
 *     ?store=lookah, not fetch ~7MB and filter in the browser -- the same
 *     rule ?shelf= exists for, and the reason this page loads at all.
 *  3. THE CHROME IS A FACE FOR THE DATA. Nav, sidebar counts and tiles are
 *     built from what actually arrived, so an empty bucket is absent rather
 *     than a chip leading to an empty grid.
 *  4. IT DOES NOT CARRY A CART. `/` and the three satellites share
 *     localStorage["ll_cart"]; a fifth copy of that drawer is what CLAUDE.md
 *     warns about. This page links out per product, and that is deliberate.
 *
 *     node test-lookah.mjs
 */
import { readFile } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { createServer } from "node:http";
import { extname, join } from "node:path";
process.env.LL_NO_STORE_FETCH = "1";
import { launchChrome } from "./tools/chrome-path.mjs";

const PORT = 3509, CDP = 9363;
const fails = [];
const ok = (n, c, x = "") => { console.log(`${c ? "  PASS" : "  FAIL"}  ${n}${x ? "   (" + x + ")" : ""}`); if (!c) fails.push(n); };
const group = m => console.log("\n" + m);
const wait = ms => new Promise(r => setTimeout(r, ms));
async function until(fn, n = 100) { for (let i = 0; i < n; i++) { try { return await fn() } catch { await wait(250) } } throw new Error("timeout") }

console.log("\nThe Lookah shop front\n");

/* Rows shaped like the real feed. Names and urls are taken from the live
   Lookah catalogue, chosen so that each cascade step is the ONLY thing that
   can answer for at least one product. */
function p(id, name, url, category, extra = {}) {
  return {
    id: "lookah__" + id, name, store: "Lookah", storeKey: "lookah",
    domain: "lookah.com", cartDomain: "lookah.com", platform: "auto",
    cannabinoid: "Accessory", category, type: "", grow: "",
    image: "/favicon.svg", url, brand: "", brandKey: "", badges: [],
    description: "Sentences.", intl: false, inStock: true,
    startsAt: 40, sale: 40, perG: null, ship: 0,
    sizes: [["One Size", 40, 0, id + "s", true, url, "", 0]],
    ...extra,
  };
}
const B = "https://www.lookah.com";
const FEED = [
  /* --- step 1: their own url segment, and the NAME says nothing useful --- */
  p("u1", "LOOKAH Glass WPC4002", B + "/bongs-and-water-pipes/wpc4002.html", "Accessories"),
  p("u2", "LOOKAH Glass 4009", B + "/dab-rigs/glass-4009.html", "Accessories"),
  p("u3", "Anti-aircraft Gun 100mm 4-Piece", B + "/grinders/anti-aircraft-gun.html", "Accessories"),
  p("u4", "Rosewood Tiger Claw", B + "/pipe/rosewood-tiger-claw.html", "Accessories"),
  p("u5", "LOOKAH BEAR - Blue", B + "/lifestyle/lookah-bear-blue.html", "Accessories"),
  p("u6", "LOOKAH FF1", B + "/vaporizer/lookah-ff1.html", "Accessories"),
  /* --- THE URL OUTRANKS THE NAME, and these are the rows that prove it.
         Measured over the 815 named Lookah rows held locally, 54 of them --
         6.6% -- have a url segment and a name that resolve to DIFFERENT
         buckets. The shop's own filing is the authority in every one: a
         Seahorse Silicone Bong is a bong however much "seahorse" says vape,
         a quartz nail set sold under dab-tools is a tool, and a honey straw
         under nectar-collector is a vaporizer whatever the word "straw"
         suggests. Without these three, reordering the cascade to test the
         name first changes NOTHING and the suite stays green -- verified
         against exactly that edit. --- */
  p("d1", "Seahorse Silicone Bong", B + "/bongs-and-water-pipes/seahorse-silicone.html", "Accessories"),
  p("d2", "2PCS Quartz Nail Set with Storage Case", B + "/dab-tools-and-dab-accessories/quartz-nail-set.html", "Accessories"),
  p("d3", '6" Classic Glass Honey Straw with 10mm Titanium Tip', B + "/nectar-collector/honey-straw.html", "Accessories"),
  /* --- step 2: NO collection in the url, our own gear category answers --- */
  p("c1", "LOOKAH Glass 4002", B + "/products/glass-4002.html", "Bongs & Rigs"),
  p("c2", "LOOKAH Model X", B + "/products/model-x.html", "Grinders"),
  /* --- step 3: no collection, no useful category, the NAME answers --- */
  p("n1", "5PCS Seahorse Coil IV Replacement", B + "/products/seahorse-coil-iv.html", "Accessories"),
  /* --- step 4: nothing answers, and More is the honest place for it --- */
  p("m1", "Automatic Card Shuffler 2-in-1", B + "/products/card-shuffler.html", "Accessories"),
  /* --- shape cases: price sort, stock filter, a discount badge --- */
  p("s1", "Cheap Glass Spoon", B + "/pipe/cheap-spoon.html", "Accessories",
    { startsAt: 9, sale: 9, sizes: [["One Size", 9, 0, "s1s", true, B, "", 0]] }),
  p("s2", "Expensive Dab Rig", B + "/dab-rigs/expensive.html", "Accessories",
    { startsAt: 300, sale: 300, sizes: [["One Size", 300, 0, "s2s", true, B, "", 0]] }),
  p("s3", "Sold Out Bong", B + "/bongs-and-water-pipes/sold-out.html", "Accessories",
    { inStock: false }),
  p("s4", "Discounted Enail", B + "/vaporizer/discount-enail.html", "Accessories",
    { startsAt: 100, sale: 50 }),
];
/* A product from a DIFFERENT shop, so a page that forgets to ask for the
   slice shows it and is caught. */
const OTHER = p("x1", "Grasscity Beaker", "https://www.grasscity.com/products/beaker.html", "Bongs & Rigs");
OTHER.storeKey = "grasscity"; OTHER.store = "Grasscity"; OTHER.id = "grasscity__x1";

const MIME = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".json": "application/json" };
const asked = [];
const srv = createServer(async (req, res) => {
  const u = new URL(req.url, "http://x");
  if (u.pathname === "/api/products") {
    const st = u.searchParams.get("store");
    asked.push(st || "(none)");
    /* The real handler's rule: an unknown key is ignored, not served empty. */
    const rows = st === "lookah" ? FEED : FEED.concat([OTHER]);
    res.writeHead(200, { "content-type": "application/json" });
    return res.end(JSON.stringify({ meta: { updated: "x", total: rows.length, stores: [] }, products: rows }));
  }
  if (u.pathname.startsWith("/api/")) { res.writeHead(200, { "content-type": "application/json" }); return res.end("{}"); }
  const f = u.pathname === "/" ? "index.html" : u.pathname.replace(/^\//, "") + (extname(u.pathname) ? "" : ".html");
  try {
    const b = await readFile(join("public", f));
    res.writeHead(200, { "content-type": MIME[extname(f)] || "application/octet-stream" });
    res.end(b);
  } catch { res.writeHead(404).end("no"); }
});
await new Promise(r => srv.listen(PORT, "127.0.0.1", r));

const { proc: ch } = await launchChrome(CDP, [], { userDataDir: "/tmp/_lllookah" });
const t = await until(async () => {
  const j = await (await fetch(`http://127.0.0.1:${CDP}/json/list`)).json();
  const pg = j.find(x => x.type === "page"); if (!pg) throw 0; return pg;
});
const s = new globalThis.WebSocket(t.webSocketDebuggerUrl);
await new Promise(r => s.addEventListener("open", r));
let id = 0; const pend = new Map(); const errs = [];
s.addEventListener("message", e => {
  const m = JSON.parse(e.data);
  if (m.method === "Runtime.exceptionThrown") errs.push(m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text);
  if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id) }
});
const send = (method, params = {}) => new Promise(r => { const i = ++id; pend.set(i, r); s.send(JSON.stringify({ id: i, method, params })) });
const ev = async x => (await send("Runtime.evaluate", { expression: x, returnByValue: true })).result?.result?.value;
await send("Runtime.enable"); await send("Page.enable"); await send("Network.enable");
/* Google Fonts is refused by the proxies these containers run behind, and a
   render-blocking <link> stalls ~13s and every script after it waits -- the
   first run of test-coldwater.mjs reported zero rows for exactly this. */
await send("Network.setBlockedURLs", { urls: ["*fonts.googleapis.com*", "*fonts.gstatic.com*", "*bigcartel.com*"] });
await send("Emulation.setDeviceMetricsOverride", { width: 1280, height: 1000, deviceScaleFactor: 1, mobile: false });

await send("Page.navigate", { url: `http://127.0.0.1:${PORT}/lookah` });
await until(async () => { if (await ev(`document.querySelectorAll("#lkMain .lk-card").length > 0`)) return 1; throw 0; });
/* The age gate sits over the page on every surface here; it must not be what
   the rest of this suite is measuring. */
await ev(`(()=>{const g=document.querySelector(".ll-age,.age-gate,#llAge");if(g)g.remove();return 1})()`);

group("THE SLICE IS ASKED FOR, NOT FILTERED AFTER THE FACT");
ok("the page asked /api/products for one shop", asked.includes("lookah"), asked.join(" | "));
ok("...and asked once", asked.length === 1, String(asked.length));
ok("...so another shop's product never reaches the grid",
   (await ev(`document.querySelector("#lkMain").innerText.indexOf("Grasscity")`)) < 0);

group("THE CASCADE, ONE STEP AT A TIME");
const bucketOf = async name => ev(`(()=>{
  const cards=[...document.querySelectorAll("#lkSide a")].map(a=>a.dataset.bucket);
  for(const b of cards){
    if(!b) continue;
    document.querySelector('#lkSide a[data-bucket="'+b+'"]').click();
    if([...document.querySelectorAll("#lkMain .lk-name")].some(n=>n.textContent.indexOf(${JSON.stringify(name)})>=0)) return b;
  }
  return "";
})()`);
/* Step 1 -- the url segment IS their collection, and none of these names
   would reach the right bucket on their own. */
ok("url /bongs-and-water-pipes/ -> Bongs", (await bucketOf("WPC4002")) === "Bongs");
ok("url /dab-rigs/ -> Rigs", (await bucketOf("Glass 4009")) === "Rigs");
ok("url /grinders/ -> Tools", (await bucketOf("Anti-aircraft")) === "Tools");
ok("url /pipe/ -> Pipe", (await bucketOf("Rosewood Tiger")) === "Pipe");
ok("url /lifestyle/ -> Lifestyle", (await bucketOf("LOOKAH BEAR")) === "Lifestyle");
ok("url /vaporizer/ -> Vaporizer", (await bucketOf("LOOKAH FF1")) === "Vaporizer");
/* ...and the url outranks a name that disagrees with it (54 real rows do). */
ok("url beats a name saying otherwise: bong under /bongs-, name says seahorse",
   (await bucketOf("Seahorse Silicone Bong")) === "Bongs");
ok("...quartz nail under /dab-tools-, name says rig",
   (await bucketOf("Quartz Nail Set")) === "Tools");
ok("...honey straw under /nectar-collector/, name says tool",
   (await bucketOf("Honey Straw")) === "Vaporizer");
/* Step 2 -- /products/ carries no collection, so our own category answers. */
ok("no collection in the url -> our gear category answers",
   (await bucketOf("Glass 4002")) === "Bongs");
ok("...and a different category lands elsewhere",
   (await bucketOf("Model X")) === "Tools");
/* Step 3 -- neither, so the name does. */
ok("neither url nor category -> the name answers",
   (await bucketOf("Seahorse Coil")) === "Vaporizer");
/* Step 4 -- nothing answers, and a vague bucket beats a wrong one. */
ok("nothing answers -> More, rather than a wrong bucket",
   (await bucketOf("Card Shuffler")) === "More");

group("THE CHROME IS BUILT FROM WHAT ARRIVED");
await ev(`document.querySelector('#lkSide a[data-bucket=""]').click()`);
const nav = await ev(`[...document.querySelectorAll("#lkNav button")].map(b=>b.dataset.bucket).join("|")`);
ok("the nav is Lookah's own six, in Lookah's own order, then More",
   nav === "Vaporizer|Rigs|Bongs|Tools|Pipe|Lifestyle|More", nav);
const counts = await ev(`[...document.querySelectorAll("#lkSide a")].map(a=>a.dataset.bucket+":"+a.querySelector("b").textContent).join(" ")`);
/* THE EXPECTED COUNTS ARE COMPUTED BY RUNNING THE SHIPPED CASCADE IN NODE,
   never typed -- so this is a cross-check of the browser's render against the
   page's own logic, and adding a fixture row cannot silently invalidate it.
   The first draft hardcoded these and went red the moment the fixture grew. */
const pageSrc = await readFile("public/lookah.html", "utf8");
const from = pageSrc.indexOf("var BUCKETS = ["), to = pageSrc.indexOf("var $ = function");
ok("the cascade block could be located in the shipped page", from >= 0 && to > from);
const M = new Function(pageSrc.slice(from, to) + "; return { bucketOf: bucketOf };")();
const expect = {};
for (const row of FEED) { const b = M.bucketOf(row); expect[b] = (expect[b] || 0) + 1; }
const shown = await ev(`(()=>{const o={};document.querySelectorAll("#lkSide a").forEach(a=>{if(a.dataset.bucket)o[a.dataset.bucket]=+a.querySelector("b").textContent});return o})()`);
ok("every sidebar count matches the shipped cascade run in node",
   Object.keys(expect).every(k => shown[k] === expect[k]) &&
   Object.keys(shown).length === Object.keys(expect).length,
   JSON.stringify(shown) + " vs " + JSON.stringify(expect));
/* Derived from the fixture, never typed: the first draft hardcoded 15 against
   a 14-row feed and reported the PAGE as wrong. And the sum is the assertion
   that carries weight -- it says every product landed in exactly one bucket,
   so a cascade that dropped a row or counted one twice cannot pass. */
const side = await ev(`(()=>{const o={};document.querySelectorAll("#lkSide a").forEach(a=>{o[a.dataset.bucket||"ALL"]=+a.querySelector("b").textContent});return o})()`);
ok("All Lookah is the whole feed", side.ALL === FEED.length, side.ALL + " vs " + FEED.length);
const summed = Object.entries(side).filter(([k]) => k !== "ALL").reduce((a, [, v]) => a + v, 0);
ok("...and the buckets partition it exactly", summed === FEED.length, summed + " vs " + FEED.length);
/* An empty bucket must be absent, not a chip leading to an empty grid. */
ok("no chip is offered for a bucket holding nothing",
   (await ev(`[...document.querySelectorAll("#lkSide a")].every(a=>!a.dataset.bucket||+a.querySelector("b").textContent>0)`)));

group("THE HUB IS A DIRECTORY, AND STANDS DOWN WHEN ASKED SOMETHING");
ok("tiles are up with no bucket and no query",
   (await ev(`document.querySelectorAll("#lkTiles .lk-tile").length`)) > 0);
await ev(`document.querySelector('#lkNav button[data-bucket="Bongs"]').click()`);
ok("...and gone once a bucket is picked",
   (await ev(`document.querySelectorAll("#lkTiles .lk-tile").length`)) === 0);
ok("...with the heading naming it",
   /Bongs/.test(await ev(`document.querySelector("#lkMain .lk-sec h2").textContent`)));

group("SEARCH, SORT AND STOCK");
const QUERY = "seahorse";
const wantHits = FEED.filter(r => r.name.toLowerCase().includes(QUERY)).length;
await ev(`(()=>{const q=document.getElementById("lkQ");q.value=${JSON.stringify(QUERY)};q.dispatchEvent(new Event("input"));return 1})()`);
/* Derived, not typed -- and asserted to be a real search rather than a
   pass-through, or a page that ignored the box entirely would be green. */
ok("the query matches more than nothing and less than everything",
   wantHits > 0 && wantHits < FEED.length, wantHits + " of " + FEED.length);
ok("search finds exactly the rows whose name carries the term",
   (await ev(`document.querySelectorAll("#lkMain .lk-card").length`)) === wantHits, String(wantHits));
ok("...and clears the bucket, so a search is never silently scoped",
   (await ev(`[...document.querySelectorAll("#lkNav button")].every(b=>b.getAttribute("aria-pressed")==="false")`)));
await ev(`(()=>{const q=document.getElementById("lkQ");q.value="";q.dispatchEvent(new Event("input"));return 1})()`);

await ev(`(()=>{const s=document.getElementById("lkSort");s.value="low";s.dispatchEvent(new Event("change"));return 1})()`);
const lowFirst = await ev(`document.querySelector("#lkMain .lk-price").textContent`);
ok("price low to high opens on the cheapest", lowFirst === "$9.00", lowFirst);
await ev(`(()=>{const s=document.getElementById("lkSort");s.value="high";s.dispatchEvent(new Event("change"));return 1})()`);
const highFirst = await ev(`document.querySelector("#lkMain .lk-price").textContent`);
ok("...and high to low on the dearest", highFirst === "$300.00", highFirst);

await ev(`(()=>{const c=document.getElementById("lkStock");c.checked=false;c.dispatchEvent(new Event("change"));return 1})()`);
ok("unticking in-stock reveals the sold-out row",
   (await ev(`document.querySelector("#lkMain").innerText.indexOf("Sold Out Bong")`)) >= 0);
ok("...marked as sold out rather than silently priced",
   (await ev(`document.querySelectorAll("#lkMain .lk-oos").length`)) > 0);
await ev(`(()=>{const c=document.getElementById("lkStock");c.checked=true;c.dispatchEvent(new Event("change"));return 1})()`);
ok("...and ticking it hides the row again",
   (await ev(`document.querySelector("#lkMain").innerText.indexOf("Sold Out Bong")`)) < 0);

group("A DISCOUNT IS STATED, NOT IMPLIED");
await ev(`document.querySelector('#lkNav button[data-bucket="Vaporizer"]').click()`);
ok("a real markdown carries a SAVE badge",
   (await ev(`document.querySelector("#lkMain").innerText.indexOf("SAVE 50%")`)) >= 0);
ok("...and a product at full price does not",
   (await ev(`document.querySelectorAll("#lkMain .lk-card").length > document.querySelectorAll("#lkMain .lk-badge").length`)));

group("IT LINKS OUT, AND CARRIES NO CART");
ok("every buy control is an outbound link to the shop",
   (await ev(`[...document.querySelectorAll("#lkMain .lk-buy")].every(a=>/^https?:\\/\\/(www\\.)?lookah\\.com/.test(a.href))`)));
ok("...opened in a new tab, with rel noopener",
   (await ev(`[...document.querySelectorAll("#lkMain .lk-buy")].every(a=>a.target==="_blank"&&/noopener/.test(a.rel))`)));
/* The fifth copy of the cart drawer is the thing this page must not grow. */
ok("no Legal-Leaf cart on this page",
   (await ev(`document.body.innerText.indexOf("Add to Legal-Leaf Cart")`)) < 0);
ok("...and nothing was written to the shared cart key",
   (await ev(`localStorage.getItem("ll_cart") === null`)));

group("THE PAGE ITSELF");
ok("the canonical is /lookah",
   (await ev(`(document.querySelector("link[rel=canonical]")||{}).href||""`)).endsWith("/lookah"));
ok("it is indexable", !/noindex/.test(await ev(`(document.querySelector("meta[name=robots]")||{}).content||""`)));
/* Read out of tokens.css rather than typed, because that is the whole claim:
   this page loads the family palette instead of approximating it, so its
   chrome colour and the family ground are the same value by construction.
   test-library-style.mjs asks the same question across every page. */
const familyBg = (readFileSync("public/css/tokens.css", "utf8").match(/--bg\s*:\s*(#[0-9a-fA-F]{3,8})/) || [])[1];
ok("the family palette states a ground", !!familyBg, familyBg || "(none)");
ok("theme-color agrees with the ground the page actually has",
   (await ev(`(document.querySelector("meta[name=theme-color]")||{}).content`)) === familyBg, familyBg);
ok("...and the page loads the family tokens rather than copying them",
   (await ev(`!!document.querySelector('link[href*="tokens.css"]')`)));


/* ------------------------------------------------------------------------ */
group("A ROOM IN THIS SITE, NOT A SECOND SITE");
{
  /* Reported twice about this one page. First it was white, matching Lookah's
     own site. Then it was an arcade cabinet in this site's palette -- and it
     STILL read as somewhere else: "it feels like a different site right now ...
     it needs to feel like legal leaf market and maintain the same fonts and
     everything ... but just feel like we're going to a different part of a
     site."

     THE PALETTE WAS NEVER WHAT WAS WRONG THE SECOND TIME. The furniture was,
     and the typeface was most of it: Press Start 2P on the wordmark, every nav
     button, every heading, every count, every price and every buy control, with
     Jost under it -- neither of which appears anywhere else on this site. That
     is a thing a stylesheet can quietly reintroduce one selector at a time, so
     it is asserted against the SHIPPED FILE rather than against a memory. */
  const page = readFileSync("public/lookah.html", "utf8");
  const css = (page.match(/<style>([\s\S]*?)<\/style>/) || [, ""])[1];
  /* Comments are stripped first: this page's own stylesheet header argues about
     Press Start 2P and Jost BY NAME while explaining why they are gone, and a
     whole-file regex goes red against the prose describing the fix. That has
     now happened enough times in this repo to be a rule. */
  const live = css.replace(/\/\*[\s\S]*?\*\//g, "");
  ok("the stylesheet was located and stripping left real CSS", live.length > 4000, live.length + " chars");
  ok("no pixel typeface anywhere in the live CSS", !/Press\s*Start/i.test(live));
  ok("no Jost either", !/\bJost\b/i.test(live));
  /* BOTH comment syntaxes stripped, not just the HTML one. The eighth time this
     repo has hit it: the stylesheet's own header explains WHY the webfont link
     is gone, naming fonts.googleapis.com to do it, and that sentence lives
     inside a CSS comment rather than an HTML one -- so stripping only <!-- -->
     went red against the prose describing the fix. */
  const prose = /<!--[\s\S]*?-->|\/\*[\s\S]*?\*\//g;
  ok("and no webfont is requested at all",
     !/fonts\.googleapis\.com|fonts\.gstatic\.com/.test(page.replace(prose, "")));

  /* THE BODY STACK IS index.html's OWN, character for character. A page that
     merely looks similar drifts; a page that carries the same string cannot. */
  const famStack = (readFileSync("public/index.html", "utf8")
    .match(/body\{margin:0;font-family:([^;]+);/) || [, ""])[1].trim();
  ok("index.html states a body stack", famStack.length > 10, famStack);
  ok("this page uses that exact stack", live.includes(famStack), famStack);
  /* The computed value comes back re-serialised -- double quotes and a space
     after every comma -- so the comparison is on the stack's shape, not its
     punctuation. Anything less and this asserts the CSS serialiser. */
  const fam = x => String(x).replace(/["']/g, "").replace(/\s*,\s*/g, ",").trim();
  ok("...and the browser agrees",
     fam(await ev(`getComputedStyle(document.body).fontFamily`)) === fam(famStack),
     await ev(`getComputedStyle(document.body).fontFamily`));

  /* THE WAY BACK OUT, which is what was actually asked for: "it needs a really
     obvious back to legal leaf market navigation at the top left". Three
     separate claims, because the link existing is the weakest of them. */
  const back = await ev(`(function(){var a=document.querySelector(".lk-back");
    if(!a) return null; var r=a.getBoundingClientRect();
    var first=[].slice.call(document.querySelectorAll('a[href],button,input,select,[tabindex]'))
      .filter(function(e){var b=e.getBoundingClientRect();return b.width>0&&b.height>0})[0];
    return {href:a.getAttribute("href"), text:a.textContent.replace(/\s+/g," ").trim(),
            top:Math.round(r.top), left:Math.round(r.left), w:Math.round(r.width),
            isFirst:first===a}; })()`);
  ok("there is a back link", !!back, JSON.stringify(back));
  ok("it goes to the market's front page", back && back.href === "/", back && back.href);
  ok("it says so in words, not a glyph", back && /Legal-Leaf Market/.test(back.text), back && back.text);
  ok("it is at the TOP LEFT", back && back.top < 140 && back.left < 120, back && (back.top + "," + back.left));
  ok("and it is the first thing a keyboard reaches", back && back.isFirst === true);

  /* THE ARC LAYER MUST BE OUT OF FLOW, and this is a real bug rather than a
     hypothetical: dropping the .lk-arc container rule left the SVG an ordinary
     block, and it pushed the entire header down by its own intrinsic 266px --
     an empty band of gradient above the back button. Nothing errored, the page
     rendered, and every behavioural assertion in this file still passed. */
  const geo = await ev(`(function(){var t=document.querySelector(".lk-top"),
    b=document.querySelector(".lk-bar"), a=document.querySelector(".lk-arc");
    if(!t||!b||!a) return null; var rt=t.getBoundingClientRect(), rb=b.getBoundingClientRect();
    return {pos:getComputedStyle(a).position, barOffset:Math.round(rb.top-rt.top),
            topH:Math.round(rt.height)}; })()`);
  ok("the arc field is out of flow", geo && geo.pos === "absolute", geo && geo.pos);
  ok("...so the header sits at the top of its own band, not below it",
     geo && geo.barOffset < 40, geo && (geo.barOffset + "px into a " + geo.topH + "px band"));

  /* THE MOVING BACKGROUND, asked for by name: "I really love the moving
     backgrounds ... since there's so much electricity going on on this page,
     come up with something cool based around that." Four layers, and each is
     one deletion away from silence, so each is named. */
  const anim = await ev(`(function(){
    function n(el,pseudo){ if(!el) return "MISSING";
      var a=getComputedStyle(el,pseudo||null).animationName; return a||"none"; }
    return {pools:n(document.body,"::before"), coil:n(document.querySelector(".lk-field")),
            charge:n(document.querySelector(".lk-arc path.a")),
            discharge:n(document.querySelector(".lk-arc path.c")),
            rail:n(document.querySelector(".lk-top"),"::after")}; })()`);
  for (const [k, label] of [["pools", "the drifting pools of charge"], ["coil", "the coil behind the band"],
                            ["charge", "a charge running the traces"], ["discharge", "the gold discharge"],
                            ["rail", "the rail along the bottom edge"]]) {
    ok(label + " is animated", anim && anim[k] && anim[k] !== "none" && anim[k] !== "MISSING", anim && anim[k]);
  }

  /* AND ALL OF IT STOPS WHEN ASKED. A page that ignores prefers-reduced-motion
     is not a style choice, and this one has four independent animations, so a
     media block that misses one is the likely failure rather than a missing
     block. */
  await send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-reduced-motion", value: "reduce" }] });
  const still = await ev(`(function(){
    function n(el,pseudo){ if(!el) return "MISSING";
      var a=getComputedStyle(el,pseudo||null).animationName; return a||"none"; }
    return {pools:n(document.body,"::before"), coil:n(document.querySelector(".lk-field")),
            charge:n(document.querySelector(".lk-arc path.a")),
            discharge:n(document.querySelector(".lk-arc path.c")),
            rail:n(document.querySelector(".lk-top"),"::after")}; })()`);
  const moving = Object.entries(still || {}).filter(([, v]) => v !== "none");
  ok("reduced motion stops every one of them", moving.length === 0,
     moving.map(([k, v]) => k + "=" + v).join(" "));
  /* Still LIT, though: the layers are drawn as well as animated, so the band is
     finished with nothing moving rather than empty. */
  ok("...and the band is still drawn, not blanked",
     (await ev(`parseFloat(getComputedStyle(document.querySelector(".lk-field")).opacity) > 0.2`)));
  await send("Emulation.setEmulatedMedia", { features: [] });
}

await send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
await wait(400);
ok("no horizontal overflow at 390px",
   (await ev(`document.documentElement.scrollWidth <= 391`)),
   String(await ev(`document.documentElement.scrollWidth`)));

ok("no uncaught errors", errs.length === 0, errs.slice(0, 2).join(" | "));

try { ch.kill() } catch {}
srv.close();
console.log(fails.length ? `\nFAILED: ${fails.join(" | ")}\n` : `\nAll good.\n`);
process.exit(fails.length ? 1 : 0);
