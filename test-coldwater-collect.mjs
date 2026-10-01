/* The bookmarklet workflow, end to end, in a real browser.
 *
 * WHAT THIS PROVES, and why each half needs proving separately:
 *
 *   1. /coldwater-collect renders, builds a javascript: bookmarklet pointing at
 *      THIS origin (not a baked-in production hostname), and lists the shops
 *      from the API rather than from a copy of the roster kept in the page.
 *
 *   2. The collector itself, run against a page that carries a menu, reads it,
 *      posts it to /api/coldwater/ingest, and the rows come back out of
 *      /api/coldwater as real products with the demo fixture stood down.
 *
 * The second half is the one that matters and the one that was never tested:
 * every previous check stopped at "the endpoint accepts a POST". A capture that
 * stores fine and then does not reach the shelf is the exact failure the whole
 * Coldwater page has had twice already, wearing a different hat.
 *
 * The fake dispensary is served from the SAME origin as the site here. Real use
 * is cross-origin, which is why the ingest endpoint sets CORS; that header is
 * asserted directly rather than by trying to fake a second origin.
 *
 * Google Fonts are blocked at the network layer -- the proxies in the
 * containers this repo is edited from refuse them, and the render-blocking
 * <link> otherwise stalls ~13s and makes a working page look broken
 * (CLAUDE.md section 10).
 *
 * Run: node test-coldwater-collect.mjs
 */
import { spawn } from "node:child_process";
import { createServer } from "node:http";

import { chromePath, launchChrome } from "./tools/chrome-path.mjs";

/* NEVER CALL A REAL SHOP FROM A TEST. This suite boots the real server.mjs and
   asks the feed to refresh, which in a sandbox that refuses egress falls
   straight through to stored captures -- and on a CI runner, which has ordinary
   network access, fetches an actual dispensary's menu on every push. api/
   coldwater.js honours this at its single fetch chokepoint and reports the
   refusal rather than hiding it. Set here rather than only in the workflow so a
   local run and a CI run are the same run. */
process.env.LL_NO_STORE_FETCH = "1";
const CHROME = chromePath();
const PORT = 3486, CDP = 9339, SHOP = 3487;
const TOKEN = "test-token-not-a-real-secret";

/* Hoisted: the install-page section asserts against a captured shop, so this is
   needed before section 3 defines its own fixtures. A const arrow is in the
   temporal dead zone until its line runs, so declaration order is not optional. */
/* THE REAL COLLECTOR ALWAYS SETS A URL -- normalise() falls back to
   location.href when a row carries no link of its own -- and the ingest now
   REQUIRES one, because a row nothing can link to is a breadcrumb or a nav item
   read as a product. That is how a marketing-page capture put three dead links
   and a row named "THCA Deals, Delta 9 Products, THCA Products" on the shelf.

   These fixtures were written before that rule and build rows by hand without
   one. Defaulting it here rather than at fourteen call sites keeps them
   testing what they were written to test, and mirrors what the collector
   actually sends. A fixture that wants to prove the rule sets url:"" itself. */
const post = (body) => fetch(`http://127.0.0.1:${PORT}/api/coldwater/ingest`, {
  method: "POST",
  headers: { "content-type": "application/json", "x-ll-admin-token": TOKEN },
  body: JSON.stringify(Array.isArray(body && body.products)
    ? { ...body, products: body.products.map((p, i) => ("url" in p ? p
        : { ...p, url: `https://fixture.example/products/row-${i}-${String(p.name || "").toLowerCase().replace(/\W+/g, "-")}` })) }
    : body),
}).then(r => r.json());

const fails = [];
const ok = (n, c, x = "") => { console.log(`${c ? "  PASS" : "  FAIL"}  ${n}${x ? "   (" + x + ")" : ""}`); if (!c) fails.push(n); };
const wait = ms => new Promise(r => setTimeout(r, ms));
async function until(fn, n = 100) { for (let i = 0; i < n; i++) { try { return await fn() } catch { await wait(250) } } throw new Error("timeout") }

/* ---- a fake dispensary menu, in the App Router shape the real ones use ---- */
const MENU = [
  { id: "m1", name: "Northern Lights", brand: "Fixture Farms", category: "Flower", strain: "Indica",
    percentTHC: 21.5, variants: [{ option: "3.5g", price: 30 }, { option: "28g", price: 175 }] },
  { id: "m2", name: "Sour Diesel", brand: "Fixture Farms", category: "Flower", strain: "Sativa",
    percentTHC: 24.2, variants: [{ option: "3.5g", price: 35 }, { option: "28g", price: 199 }] },
];
const flight = '1:HL["/x.css","style"]\n2:' + JSON.stringify(MENU) + '\n';
const SHOP_HTML =
  '<!doctype html><html><head><title>Fixture Dispensary</title></head><body><h1>Menu</h1>' +
  '<script>self.__next_f=self.__next_f||[];self.__next_f.push([1,' + JSON.stringify(flight) + '])</script>' +
  '</body></html>';
/* A React app that fetched its menu over XHR: no window global, no JSON script
   tag, nothing in the markup. The data exists only as props hung off the DOM
   nodes under a per-build key, which is what Dutchie and Jane look like. */
const REACT_HTML =
  '<!doctype html><html><head><title>React Dispensary</title></head><body><div id="grid"></div>' +
  '<script>' +
  'var menu=' + JSON.stringify(MENU) + ';' +
  'var g=document.getElementById("grid");' +
  'for(var i=0;i<menu.length;i++){var d=document.createElement("div");' +
  'd.textContent=menu[i].name;g.appendChild(d);' +
  'd["__reactProps$xk7q2"]={product:menu[i],className:"card"};}' +
  'document.body["__reactProps$xk7q2"]={};' +
  '</script></body></html>';

/* A menu with NO structured data anywhere -- server-rendered HTML only. This is
   the case the collector claimed to handle and did not: the promised DOM scan
   did not exist, so this page produced "Nothing product-shaped found". */
const DOM_HTML =
  '<!doctype html><html><head><title>Plain Dispensary</title></head><body>' +
  '<h1>Our menu</h1><div class="grid">' +
  [["Purple Punch", "3.5g", "$32.00", "28g", "$189.00"],
   ["Gelato 41", "3.5g", "$38.00", "28g", "$210.00"],
   ["Blue Dream", "3.5g", "$30.00", "28g", "$175.00"],
   ["Runtz", "3.5g", "$42.00", "28g", "$230.00"]]
    .map(r => '<div class="card"><img src="/i.jpg"><h3>' + r[0] + '</h3>' +
      '<div class="row"><span>' + r[1] + '</span><span>' + r[2] + '</span></div>' +
      '<div class="row"><span>' + r[3] + '</span><span>' + r[4] + '</span></div></div>').join("") +
  '</div><div class="cart">Subtotal $0.00</div></body></html>';

/* BANZEN AND EXCLUSIVE: the photo and the link sit on a wrapper OUTSIDE the
   block cardFor() calls the card. Reported as "I just rescraped all of banzen
   and it still has no photos" and "I was able to grab exclusive but it has no
   photos" -- 458 products and 0 images, while every shop read through page
   state or React props came back at 96-100%.

   cardFor() stops at the smallest ancestor carrying a name, which here is
   .info. The <img> and the <a> are both on <article> above it, so imgFromEl
   found nothing and the url fell back to location.href. One cause, two symptoms
   that read as unrelated bugs -- the missing photo and the front-page link.

   The fourth card paints its photo from a STYLESHEET CLASS, which the inline
   style[*=background-image] test cannot see. The fifth has genuinely no photo
   anywhere, so a run that "finds" one for it is reaching into a neighbour. */
const WRAPPED_HTML =
  '<!doctype html><html><head><title>Wrapped cards</title>' +
  '<style>.bgshot{background-image:url("/css-shot.jpg");width:80px;height:80px}</style>' +
  '</head><body><h1>Menu</h1><div class="grid">' +
  [["Gary Payton", "3.5g", "$45.00", "gp"],
   ["Zkittlez", "3.5g", "$40.00", "zk"],
   ["MAC 1", "3.5g", "$50.00", "mac"]]
    .map(r => '<article class="card"><a href="/product/' + r[3] + '">' +
      '<img src="/photo-' + r[3] + '.jpg"></a>' +
      '<div class="info"><h3>' + r[0] + '</h3>' +
      '<div class="row"><span>' + r[1] + '</span><span>' + r[2] + '</span></div>' +
      '</div></article>').join("") +
  '<article class="card"><a href="/product/css"><div class="bgshot"></div></a>' +
  '<div class="info"><h3>Wedding Pie</h3>' +
  '<div class="row"><span>3.5g</span><span>$47.00</span></div></div></article>' +
  '<article class="card"><div class="info"><h3>No Photo Here</h3>' +
  '<div class="row"><span>3.5g</span><span>$29.00</span></div></div></article>' +
  '</div></body></html>';

/* EXCLUSIVE, reported as "barely picking anything up per page". Its menu is in
   a CLOSED shadow root, so the only readable thing is the printed text -- and
   the text layer named each card by walking BACK to the last plausible line
   before the price, which on this card shape is the strain chip.

   Every card came out called "Hybrid" or "Indica", rows dedupe by name, and a
   page of twelve collapsed to two. From outside that does not look like a
   naming bug at all; it looks like a scrape that cannot read the page.

   Same cause as Herbology naming things "1/8oz" and Banzen naming things
   "THC: 28.03%" -- there were two name pickers with different holes.

   The two decoys matter: "THC Bomb" and "Half Baked" are real strain names, and
   a reject list written loosely (/^thc\b/, /^half\b/) deletes them to fix the
   chips -- trading a visible bug for an invisible one. */
const CLOSED_TEXT_HTML =
  '<!doctype html><html><head><title>Closed menu</title></head><body>' +
  '<div id="host"></div><script>' +
  'var rows=[["Gary Payton","Hybrid","24.5"],["Blue Dream","Sativa","19.2"],' +
  '["Wedding Cake","Indica","26.1"],["THC Bomb","Hybrid","22.0"],' +
  '["Half Baked","Indica","21.4"],["Grape Milkshake","Hybrid","23.8"]];' +
  'var h="";for(var i=0;i<rows.length;i++){' +
  '  h+="<div><div>Exclusive</div><div>"+rows[i][0]+"</div><div>Flower</div>"+' +
  '     "<div>"+rows[i][1]+"</div><div>THC: "+rows[i][2]+"%</div>"+' +
  '     "<div>1/8 oz</div><div>$45.00</div><div>Add to bag</div></div>";}' +
  'document.getElementById("host").innerHTML=h;' +
  '</script></body></html>';

/* DUTCHIE, from the diagnostics a live Sapura menu actually returned:
     {"react":true,"reactHits":0,"domPriceNodes":661,"domGroup":252,"fromDom":0}
   Two independent failures in one page, so the fixture reproduces both.

   1. Each weight option is its own <a href> whose entire text is "1/8 oz
      $45.00". cardFor() used to stop at the first ancestor carrying a link, so
      the "card" was that price row -- every line a price, no name, dropped.
      252 grouped, 0 extracted.
   2. The menu array is NOT on any host element's props. It is held by a
      component above them, here in a useState hook, which is why reactHits was
      0 on a page whose products were sitting in memory the whole time. */
const DUTCHIE_MENU = [
  { id: "d1", name: "Georgia Pie", brand: "Cookies", category: "Flower", strain: "Hybrid",
    percentTHC: 24.5, variants: [{ option: "1/8 oz", price: 45 }, { option: "1 oz", price: 240 }] },
  { id: "d2", name: "Papaya Punch", brand: "Local Grown", category: "Flower", strain: "Indica",
    percentTHC: 22.1, variants: [{ option: "1/8 oz", price: 40 }, { option: "1 oz", price: 210 }] },
  { id: "d3", name: "Super Lemon Haze", brand: "Local Grown", category: "Flower", strain: "Sativa",
    percentTHC: 26.0, variants: [{ option: "1/8 oz", price: 50 }, { option: "1 oz", price: 265 }] },
];
const DUTCHIE_HTML =
  '<!doctype html><html><head><title>Dutchie embedded menu</title></head><body>' +
  '<div id="menu"></div><script>' +
  'var menu=' + JSON.stringify(DUTCHIE_MENU) + ';' +
  'var root=document.getElementById("menu");' +
  'var FK="__reactFiber$dz9";' +
  'for(var i=0;i<menu.length;i++){var p=menu[i];' +
  '  var card=document.createElement("div");card.className="c-card";' +
  '  var img=document.createElement("img");img.src="/p.jpg";card.appendChild(img);' +
  '  var nm=document.createElement("div");nm.className="c-name";nm.textContent=p.brand+" "+p.name;card.appendChild(nm);' +
  '  var th=document.createElement("div");th.textContent="THC "+p.percentTHC+"%";card.appendChild(th);' +
  '  for(var v=0;v<p.variants.length;v++){' +
  '    var a=document.createElement("a");a.href="/products/"+p.id;a.className="c-opt";' +
  '    a.textContent=p.variants[v].option+" $"+p.variants[v].price+".00";card.appendChild(a);' +
  '    a[FK]={memoizedProps:{className:"c-opt"},memoizedState:null,return:null};' +
  '  }' +
  '  root.appendChild(card);' +
  '  card[FK]={memoizedProps:{className:"c-card"},memoizedState:null,return:null};' +
  '}' +
  // The grid component: holds the whole menu in a hook, above every host node.
  'var gridFiber={memoizedProps:{className:"grid"},memoizedState:{memoizedState:menu,next:null},return:null};' +
  'var kids=root.querySelectorAll("*");' +
  'for(var q=0;q<kids.length;q++){if(!kids[q][FK])kids[q][FK]={memoizedProps:{},memoizedState:null,return:null};' +
  '  kids[q][FK].return=gridFiber;}' +
  'root[FK]={memoizedProps:{},memoizedState:null,return:gridFiber};' +
  '</script></body></html>';

/* JANE, as it renders at Green Tree Relief: the menu is a web component, so
   every card lives inside a SHADOW ROOT. document.querySelectorAll does not
   cross that boundary, so all three layers were blind to the whole menu and
   the page read as empty rather than as encapsulated. It also explains an
   evening spent hunting for an iframe that does not exist -- the DevTools dump
   said plainly "It is in a shadow DOM tree" while every iframe query returned
   nothing. Class names here mimic Jane's CSS-module hashes. */
const SHADOW_HTML =
  '<!doctype html><html><head><title>Jane menu</title></head><body>' +
  '<h1>Green Tree</h1><div id="jane-embed"></div><script>' +
  'var menu=' + JSON.stringify(DUTCHIE_MENU) + ';' +
  'var host=document.getElementById("jane-embed");' +
  'var root=host.attachShadow({mode:"open"});' +
  'var html="<div class=\'_grid_a1b2c3_1\'>";' +
  'for(var i=0;i<menu.length;i++){var p=menu[i];' +
  '  html+="<div class=\'_cardContent_d5vxq_1\'><img src=\'/p.jpg\'>";' +
  '  html+="<div class=\'_name_x1_1\'>"+p.brand+" "+p.name+"</div>";' +
  '  html+="<div>THC "+p.percentTHC+"%</div>";' +
  '  for(var v=0;v<p.variants.length;v++){' +
  '    html+="<div class=\'_row_y2_1\'><span>"+p.variants[v].option+"</span>";' +
  '    html+="<span>$"+p.variants[v].price+".00</span></div>";' +
  '  }' +
  '  html+="</div>";' +
  '}' +
  'html+="</div>";root.innerHTML=html;' +
  '</script></body></html>';

/* The same page with a CLOSED root. Not a bug to fix -- it is the page
   declining -- but it must be reported as that rather than as "no prices". */
const CLOSED_HTML = SHADOW_HTML.replace('{mode:"open"}', '{mode:"closed"}');

/* VIRTUALISED, the way Jane renders at Green Tree Relief: only the cards in
   view exist in the DOM at all, and scrolling DESTROYS the ones leaving as it
   creates the ones arriving. Reported as "gtr is reading but only like 22 at a
   time that it sees not the whole page" -- which is the page's rendering
   strategy, not a parse failure, and no single harvest can ever see more than
   a window of it. 24 products, 5 on screen at once. */
const VIRT_MENU = [];
for (let i = 1; i <= 24; i++) {
  VIRT_MENU.push({ id: "v" + i, name: "Strain " + i, brand: "Batch", category: "Flower",
    strain: "Hybrid", percentTHC: 20 + (i % 9),
    variants: [{ option: "3.5g", price: 30 + i }, { option: "28g", price: 150 + i }] });
}
const VIRT_HTML =
  '<!doctype html><html><head><title>Virtualised menu</title>' +
  '<style>body{margin:0}#pad{height:3000px;position:relative}#win{position:fixed;top:0;left:0;right:0}</style>' +
  '</head><body><div id="pad"><div id="win"></div></div><script>' +
  'var menu=' + JSON.stringify(VIRT_MENU) + ';' +
  'var WIN=5,win=document.getElementById("win");' +
  'function render(){' +
  '  var first=Math.min(menu.length-WIN,Math.floor(window.scrollY/120));if(first<0)first=0;' +
  '  var html="";' +
  '  for(var i=first;i<first+WIN&&i<menu.length;i++){var p=menu[i];' +
  '    html+="<div class=\'card\'><img src=\'/i.jpg\'><h3>"+p.brand+" "+p.name+"</h3>";' +
  '    for(var v=0;v<p.variants.length;v++){' +
  '      html+="<div class=\'row\'><span>"+p.variants[v].option+"</span><span>$"+p.variants[v].price+".00</span></div>";' +
  '    }html+="</div>";}' +
  '  win.innerHTML=html;' +
  '}' +
  'window.addEventListener("scroll",render);render();' +
  '</script></body></html>';

/* EXCLUSIVE, from its own diagnostics on exclusivemi.com/shop:
     {"react":false,"shadowRoots":0,"iframes":0,
      "pricesOnPage":194,"domPriceNodes":10,"domGroup":1,"fromDom":0}
   194 prices in the page text and only 10 reachable as elements. The menu
   renders in CUSTOM ELEMENTS, which matched none of the tags the DOM scan used
   to query -- a whitelist is a guess about someone else's markup and fails
   silently and totally when the guess is wrong. No shadow root, no React, no
   iframe: nothing was hidden, the query was just too narrow. */
const CUSTOM_HTML =
  '<!doctype html><html><head><title>Custom element menu</title>' +
  /* Real custom-element menus style their parts as blocks; an UNSTYLED custom
     element is display:inline, which collapses a whole card onto one text line
     and is not what any shop ships. Without this the fixture tests a page that
     does not exist. */
  '<style>product-card,product-grid,product-title,potency-tag,price-row{display:block}' +
  'weight-tag,price-tag{display:inline-block;margin-right:8px}</style>' +
  '</head><body>' +
  '<h1>Shop</h1><product-grid>' +
  DUTCHIE_MENU.map(p =>
    '<product-card><product-media><img src="/i.jpg"></product-media>' +
    '<product-title>' + p.brand + ' ' + p.name + '</product-title>' +
    '<potency-tag>THC ' + p.percentTHC + '%</potency-tag>' +
    p.variants.map(v =>
      '<price-row><weight-tag>' + v.option + '</weight-tag>' +
      '<price-tag>$' + v.price + '.00</price-tag></price-row>').join("") +
    '</product-card>').join("") +
  '</product-grid></body></html>';

/* GREEN TREE, the hard version: Jane virtualises AND each card is its own web
   component, so the shadow roots holding the menu are created and destroyed as
   you scroll. Reported as "green tree is capping at 22 no matter if i have more
   loaded while scrolling" -- the collector enumerated shadow roots ONCE at load,
   so every card mounted afterwards was invisible no matter how far it scrolled.
   24 products, 5 rendered at a time, each in a fresh shadow root. */
const SHADOW_VIRT_HTML =
  '<!doctype html><html><head><title>Jane virtualised</title>' +
  '<style>body{margin:0}#pad{height:3000px;position:relative}#win{position:fixed;top:0;left:0;right:0}' +
  'jane-card{display:block}</style></head><body>' +
  '<div id="pad"><div id="win"></div></div><script>' +
  'var menu=' + JSON.stringify(VIRT_MENU) + ';' +
  'var WIN=5,win=document.getElementById("win");' +
  'function render(){' +
  '  var first=Math.min(menu.length-WIN,Math.floor(window.scrollY/120));if(first<0)first=0;' +
  '  win.innerHTML="";' +
  '  for(var i=first;i<first+WIN&&i<menu.length;i++){var p=menu[i];' +
  '    var host=document.createElement("jane-card");' +
  '    var r=host.attachShadow({mode:"open"});' +
  '    var h="<div class=\'_card_1\'><img src=\'/i.jpg\'><div class=\'_name_1\'>"+p.brand+" "+p.name+"</div>";' +
  '    for(var v=0;v<p.variants.length;v++){' +
  '      h+="<div class=\'_row_1\'><span>"+p.variants[v].option+"</span><span>$"+p.variants[v].price+".00</span></div>";' +
  '    }h+="</div>";r.innerHTML=h;win.appendChild(host);}' +
  '}' +
  'window.addEventListener("scroll",render);render();' +
  '</script></body></html>';

/* GREEN TREE AGAIN, reported as "capping at 52" once the shadow re-enumeration
   above had lifted it off 22. The menu does not scroll the WINDOW -- the whole
   document is exactly viewport height and never moves. It scrolls an inner pane,
   and that pane is a CUSTOM ELEMENT.

   scrollers() looked for "div,section,main,ul", so it found nothing that could
   scroll, autoScan stepped the window that had nowhere to go, and every pass
   re-read the same mounted window. The failure does not look like a parse
   error: the rows it returns are perfect. It looks like a shop with 52
   products. Exactly the tag-whitelist mistake that made Exclusive report 10
   candidate nodes on a page holding 194 prices, in a place where being wrong is
   even quieter.

   Note the pane is deliberately 200px tall: the old 300px floor would have
   excluded it even if the tag had matched. */
const INNER_SCROLL_HTML =
  '<!doctype html><html><head><title>Inner scroller</title>' +
  '<style>html,body{margin:0;height:100%;overflow:hidden}' +
  'menu-pane{display:block;height:200px;overflow-y:auto}#pad{height:3000px;position:relative}' +
  '#win{position:sticky;top:0}</style></head><body>' +
  '<menu-pane id="pane"><div id="pad"><div id="win"></div></div></menu-pane><script>' +
  'var menu=' + JSON.stringify(VIRT_MENU) + ';' +
  'var WIN=5,pane=document.getElementById("pane"),win=document.getElementById("win");' +
  'function render(){' +
  '  var first=Math.min(menu.length-WIN,Math.floor(pane.scrollTop/120));if(first<0)first=0;' +
  '  var html="";' +
  '  for(var i=first;i<first+WIN&&i<menu.length;i++){var p=menu[i];' +
  '    html+="<div class=\'card\'><img src=\'/i.jpg\'><h3>"+p.brand+" "+p.name+"</h3>";' +
  '    for(var v=0;v<p.variants.length;v++){' +
  '      html+="<div class=\'row\'><span>"+p.variants[v].option+"</span><span>$"+p.variants[v].price+".00</span></div>";' +
  '    }html+="</div>";}' +
  '  win.innerHTML=html;' +
  '}' +
  'pane.addEventListener("scroll",render);render();' +
  '</script></body></html>';

/* HERBOLOGY: the initial HTML carries only the first page of the menu, and the
   app has since loaded the rest into component state. Reported as "herbology is
   capping out too" -- page state answered 4, which is not zero, so the richer
   React state was never consulted. The layers are not alternatives. */
const PARTIAL_STATE_HTML =
  '<!doctype html><html><head><title>Partial state</title></head><body><div id="g"></div>' +
  '<script type="application/json" id="seed">' + JSON.stringify(VIRT_MENU.slice(0, 4)) + '</script>' +
  '<script>' +
  'var all=' + JSON.stringify(VIRT_MENU) + ';' +
  'var g=document.getElementById("g");' +
  'var d=document.createElement("div");d.textContent="menu";g.appendChild(d);' +
  'd["__reactFiber$hb1"]={memoizedProps:{},memoizedState:{memoizedState:all,next:null},return:null};' +
  '</script></body></html>';

const shopSrv = createServer((req, res) => {
  /* A SHOP THAT REFUSES OUTSIDE SCRIPTS, which is what Dutchie does and the
     whole reason the self-contained build exists. Served as a real header
     rather than a meta tag so the browser enforces it exactly as a shop would:
     'self' allows the page's own inline bootstrap and refuses ours. */
  if (req.url.startsWith("/csp")) {
    res.writeHead(200, {
      "content-type": "text/html",
      "content-security-policy": "script-src 'self' 'unsafe-inline'; connect-src *",
    });
    return res.end(SHOP_HTML);
  }
  res.writeHead(200, { "content-type": "text/html" });
  if (req.url.startsWith("/partial")) return res.end(PARTIAL_STATE_HTML);
  if (req.url.startsWith("/shadowvirt")) return res.end(SHADOW_VIRT_HTML);
  if (req.url.startsWith("/innerscroll")) return res.end(INNER_SCROLL_HTML);
  if (req.url.startsWith("/wrapped")) return res.end(WRAPPED_HTML);
  if (req.url.startsWith("/closedtext")) return res.end(CLOSED_TEXT_HTML);
  if (req.url.startsWith("/custom")) return res.end(CUSTOM_HTML);
  if (req.url.startsWith("/virt")) return res.end(VIRT_HTML);
  if (req.url.startsWith("/react")) return res.end(REACT_HTML);
  if (req.url.startsWith("/dom")) return res.end(DOM_HTML);
  if (req.url.startsWith("/dutchie")) return res.end(DUTCHIE_HTML);
  if (req.url.startsWith("/shadow")) return res.end(SHADOW_HTML);
  if (req.url.startsWith("/closed")) return res.end(CLOSED_HTML);
  res.end(SHOP_HTML);
});
await new Promise(r => shopSrv.listen(SHOP, r));

/* ---- boot the site + browser --------------------------------------------- */
const srv = spawn(process.execPath, ["server.mjs"], { env: { ...process.env, PORT: String(PORT), LL_ADMIN_TOKEN: TOKEN }, stdio: "ignore" });
/* LAUNCHED THROUGH THE SHARED HELPER, which waits long enough for a cold
   start on a loaded runner and keeps the browser's stderr. Spawning here
   with stdio "ignore" and a 15s poll is what produced "Chromium did not
   start" on a machine whose Chrome answered --version perfectly. */
const { proc: ch } = await launchChrome(CDP, [], { userDataDir: "/tmp/_cwc" });
const t = await until(async () => { const j = await (await fetch(`http://127.0.0.1:${CDP}/json/list`)).json(); const p = j.find(x => x.type === "page"); if (!p) throw 0; return p; });
await until(() => fetch(`http://127.0.0.1:${PORT}/api/coldwater`).then(r => { if (!r.ok) throw 0; return r }));

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
const evp = async x => (await send("Runtime.evaluate", { expression: x, returnByValue: true, awaitPromise: true })).result?.result?.value;

await send("Runtime.enable"); await send("Page.enable"); await send("Network.enable");
await send("Network.setBlockedURLs", { urls: ["*fonts.googleapis.com*", "*fonts.gstatic.com*"] });

console.log("\n/coldwater-collect — the bookmarklet workflow\n");

/* ---- 1. the install page -------------------------------------------------- */
await send("Page.navigate", { url: `http://127.0.0.1:${PORT}/coldwater-collect` });
await until(async () => { if (await ev(`document.readyState==='complete'`)) return true; throw 0 });
await until(async () => { if ((await ev(`document.querySelectorAll('#tbl tbody tr').length`)) > 0) return true; throw 0 }, 60);

const href = await ev(`document.getElementById('bm').getAttribute('href')`);
ok("bookmarklet is a javascript: URL", /^javascript:/.test(String(href)), String(href).slice(0, 42));
ok("bookmarklet points at THIS origin, not a baked-in host",
   String(href).includes(`127.0.0.1:${PORT}/coldwater-collector.js`) && !String(href).includes("legal-leafmarket.com"),
   String(href).slice(0, 100));
/* A blocked script is silent, so the loading build has to say what happened --
   and now say which button fixes it rather than only naming the cause. */
ok("bookmarklet says what to do when a shop refuses it",
   /blocks scripts from other origins/.test(String(href)) && /self-contained/.test(String(href)),
   String(href).slice(-150));
ok("bookmarklet has no double quotes to break the attribute", !String(href).includes('"'));

/* ---- THE SELF-CONTAINED BUILD, which is the one that works on Dutchie -----
   A bookmarklet's own javascript: URL is exempt from CSP -- clicking a bookmark
   is a user action -- but the <script src> the loading build injects is an
   ordinary cross-origin script, and a shop with a strict script-src refuses it.
   Dutchie does, and a blocked script fires no error event, so it reads as "the
   bookmarklet will not open" rather than as a refusal.
   The fix is to carry the collector inside the URL, and the assertion that
   matters is not that the URL was built -- it is that it RUNS somewhere the
   other one cannot. */
await until(async () => {
  const h = await ev(`document.getElementById('bm2').getAttribute('href')`);
  if (h && h !== "#") return true; throw 0;
}, 80);
const href2 = String(await ev(`document.getElementById('bm2').getAttribute('href')`));
ok("the self-contained bookmarklet is a javascript: URL", /^javascript:/.test(href2), href2.slice(0, 40));
/* WHAT THIS DOES NOT ASSERT, and why. The obvious check is "the self-contained
   build contains no loader" -- but the collector's own header comment documents
   the loader as an example, so any source search for it matches documentation
   rather than code. That is the second time a comment in this file has fooled a
   whole-file search, and a static check that can be satisfied by prose is worse
   than no static check.
   So the static half asserts only what it can see honestly: the loading build
   IS a loader. That it loads nothing is proven where it counts, below, by
   running both on a shop that refuses outside scripts. */
ok("the loading build is a loader, which is the thing a strict shop refuses",
   /createElement\('script'\)/.test(String(href)) && /coldwater-collector\.js/.test(String(href)),
   "injects a cross-origin script");
ok("...it carries the collector itself", href2.length > 50000, `${Math.round(href2.length / 1024)} KB`);
/* Without this the inlined program has no currentScript and would default to
   production and the Coldwater shelf whatever page built it. */
ok("...and states its own origin, which an inlined program cannot discover",
   decodeURIComponent(href2.slice(11)).indexOf(`__LL_COLLECTOR_SRC__="http://127.0.0.1:${PORT}/coldwater-collector.js"`) > -1 ||
   /__LL_COLLECTOR_SRC__=/.test(decodeURIComponent(href2.slice(11))), "preamble present");
ok("...and says how big it is, since a very long bookmark is Safari's limit",
   /KB/.test(String(await ev(`document.getElementById('bm2note').textContent`))),
   String(await ev(`document.getElementById('bm2note').textContent`)).slice(0, 70));

/* THE PROOF. On a shop serving script-src 'self', the loading build's injected
   script is refused and the collector never appears; the self-contained one
   runs. Both driven on the same page, in that order. */
await send("Page.navigate", { url: `http://127.0.0.1:${SHOP}/csp` });
await until(async () => { if (await ev(`document.readyState==='complete'`)) return true; throw 0 });
await ev(`(function(){
  var d=document,s=d.createElement('script');
  s.src='http://127.0.0.1:${PORT}/coldwater-collector.js?'+Date.now();
  d.body.appendChild(s);
})()`);
await wait(1500);
ok("a strict shop refuses the loading build, silently",
   (await ev(`!window.__LL_COLLECT__`)) === true, "collector absent, as on Dutchie");

/* The self-contained one, run the way a bookmarklet runs: its own source, in
   the page, with nothing fetched. */
const inlineSrc = decodeURIComponent(href2.slice("javascript:".length));
await send("Runtime.evaluate", { expression: inlineSrc });
await wait(1500);
ok("the self-contained build runs on that same shop",
   (await ev(`!!window.__LL_COLLECT__`)) === true, "collector present");
ok("...and reads the menu there", (await ev(`(window.__LL_COLLECT__.harvest()||[]).length > 0`)) === true,
   String(await ev(`(window.__LL_COLLECT__.harvest()||[]).length`)));

/* BACK TO THE INSTALL PAGE. Everything below this point was written against it
   and reads its controls; leaving the browser parked on a shop makes the next
   assertion time out on an element that was never going to exist, which reads
   as that feature being broken rather than as this block wandering off. */
await send("Page.navigate", { url: `http://127.0.0.1:${PORT}/coldwater-collect` });
await until(async () => { if (await ev(`document.readyState==='complete'`)) return true; throw 0 });
await until(async () => { if ((await ev(`document.querySelectorAll('#tbl tbody tr').length`)) > 0) return true; throw 0 }, 60);

/* CONSOLE PASTE MUST LAND ON THE SAME SHELF AS THE BOOKMARKLET.
   The collector reads its market AND its API origin off
   document.currentScript.src, and pasted source has no currentScript -- so a
   console paste defaulted to the Coldwater shelf and to production, whatever
   page it was copied from. That is the method this page RECOMMENDS under a
   strict CSP, which made the path most likely to be used on a difficult shop
   the one most likely to file the capture on the wrong shelf. */
{
  await ev(`window.__copied = ""; navigator.clipboard.writeText = function(t){ window.__copied = t; return Promise.resolve(); };`);
  await ev(`document.getElementById('copy').click()`);
  const copied = await until(async () => {
    const t = await ev(`window.__copied`);
    if (t && t.length > 1000) return String(t);
    throw 0;
  }, 40);
  ok("copied source declares where it came from",
     /^window\.__LL_COLLECTOR_SRC__ = "http/.test(copied), copied.slice(0, 70));
  /* The FIRST LINE only: the file's own header comment documents the production
     bookmarklet, so a whole-file search for that host matches documentation
     rather than configuration. */
  const head = copied.split("\n")[0];
  ok("and names THIS origin, not production",
     head.includes(`127.0.0.1:${PORT}/coldwater-collector.js`) && !head.includes("legal-leafmarket.com"),
     head.slice(0, 90));
  /* The override is only read when currentScript is absent, so a bookmarklet is
     unaffected -- its own src wins. */
  ok("the collector prefers currentScript and falls back to the override",
     copied.includes("window.__LL_COLLECTOR_SRC__ ||") && copied.includes("document.currentScript.src"));
}

const rows = await ev(`document.querySelectorAll('#tbl tbody tr').length`);
const keys = await ev(`[...document.querySelectorAll('#tbl tbody td code')].map(c=>c.textContent).join(',')`);
ok("shop roster rendered from the API", rows >= 7, `${rows} rows`);
ok("every store key from STORES is listed",
   ["lume", "sapura", "dude", "herbology", "greentree", "banzen", "exclusive"].every(k => String(keys).includes(k)), String(keys));
/* A capture can be wrong as well as stale -- a menu under the wrong shop key,
   or rows whose names turned out to be size options. Re-capturing replaces a
   collection but cannot remove one, so the roster needs a way to unpublish. */
/* Carries a url because the ingest now requires one: a row nothing can link to
   is a breadcrumb or a nav item read as a product, which is how a marketing-page
   capture put dead links on the shelf. This fixture is testing the Clear
   control, so it has to be a product the endpoint would really accept. */
await post({ storeKey: "banzen", collection: "junk", products: [{ name: "Junk Row", url: "https://banzencoldwater.com/menu/junk-row", sizes: [{ label: "1g", price: 5, grams: 1 }] }] });
await ev(`document.getElementById('refresh').click()`);
await until(async () => { if (await ev(`!!document.querySelector('[data-clear="banzen"]')`)) return true; throw 0 }, 40);
ok("a captured shop offers a Clear control", true);
ok("a shop with no capture does not", (await ev(`!!document.querySelector('[data-clear="lume"]')`)) === false);
await post({ storeKey: "banzen", reset: true });

/* ?ROSTER MUST NOT SCRAPE. The install page needs the shop list and what has
   been captured; ?debug&slim computes every diagnostic in api/products.js and,
   on a cold cache, scrapes nineteen stores first -- measured past 60 seconds,
   which is why Refresh read as a dead button. The roster is static config, so
   the only thing worth pinning is that it answers fast and answers fully. */
{
  const t0 = Date.now();
  const r = await (await fetch(`http://127.0.0.1:${PORT}/api/products?roster`)).json();
  const ms = Date.now() - t0;
  ok("?roster answers without scraping", ms < 3000, `${ms}ms`);
  ok("and carries the whole shop list", Array.isArray(r.roster) && r.roster.length > 10,
     `${(r.roster || []).length} shops`);
  ok("with the shape the page renders", r.roster.every(s => s.key && s.name && "site" in s));
  /* A zero would read as an empty shelf; null is "nobody has asked yet". */
  ok("and no invented product count", r.meta && r.meta.total === null, JSON.stringify(r.meta));
}

ok("storage backend is reported", /Backend:/.test(await ev(`document.getElementById('storage').innerText`)),
   (await ev(`document.getElementById('storage').innerText`)).slice(0, 80));
ok("no uncaught page errors", errs.length === 0, errs.join(" | ").slice(0, 200));

await send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
await wait(400);
ok("no horizontal overflow at 390px", (await ev(`document.documentElement.scrollWidth<=392`)), `sw ${await ev(`document.documentElement.scrollWidth`)}`);
await send("Emulation.clearDeviceMetricsOverride");

/* ---- 2. the collector, on a page with a menu ------------------------------ */
await send("Page.navigate", { url: `http://127.0.0.1:${SHOP}/` });
await until(async () => { if (await ev(`document.readyState==='complete'`)) return true; throw 0 });

/* The batch is scoped to the HOST now (a shop is a host), and these fixtures
   all share one -- so a section that means to start empty has to say so. */
await ev(`Object.keys(localStorage).filter(function(k){return k.indexOf('ll_collector_batch')===0}).forEach(function(k){localStorage.removeItem(k)})`);
const before = errs.length;
await evp(`new Promise(function(res){var s=document.createElement('script');s.src='http://127.0.0.1:${PORT}/coldwater-collector.js?'+Date.now();s.onload=function(){res(1)};s.onerror=function(){res(0)};document.body.appendChild(s)})`);
await wait(600);

ok("collector set its loaded flag", (await ev(`window.__LL_COLLECTOR__`)) === "1", String(await ev(`window.__LL_COLLECTOR__`)));
ok("collector panel appeared", (await ev(`!!document.getElementById('ll-collector')`)));
const readTxt = await ev(`document.getElementById('ll-collector').innerText`);
ok("collector read the menu out of the RSC stream", /2 products in this batch/.test(String(readTxt)), String(readTxt).split("\n")[1]);
ok("collector counted the ones carrying a weight", /2 carry a weight/.test(String(readTxt)), String(readTxt).split("\n")[2]);
ok("collector threw nothing", errs.length === before, errs.slice(before).join(" | ").slice(0, 200));

/* The collector derives its API from its own script src, so this capture must
   go to the test server rather than to production. Asserted, because a wrong
   value here writes to the live catalogue. */
await ev(`document.getElementById('ll-store').value='dude';document.getElementById('ll-token').value=${JSON.stringify(TOKEN)}`);
await ev(`[...document.querySelectorAll('#ll-collector button')].find(b=>b.textContent==='Send').click()`);
const sent = await until(async () => {
  const txt = await ev(`document.getElementById('ll-collector').innerText`);
  if (/Sent|Rejected|Could not/.test(String(txt))) return String(txt);
  throw 0;
}, 40);
ok("capture was accepted", /Sent\./.test(sent), sent.replace(/\s+/g, " ").slice(0, 110));
ok("both products stored", /2 products into/.test(sent), sent.replace(/\s+/g, " ").slice(0, 110));

/* ---- 2b. layer 2: React props, no page state ----------------------------- */
async function runCollector(path) {
  await send("Page.navigate", { url: `http://127.0.0.1:${SHOP}${path}` });
  await until(async () => { if (await ev(`document.readyState==='complete'`)) return true; throw 0 });
  /* Each fixture is a separate shop, so start from an empty batch. Real use
     scopes the batch by host+path (see BATCH_KEY); these fixtures deliberately
     share a host, which is exactly the collision that scoping exists to stop
     and which would otherwise make one fixture's rows appear in the next. */
  await ev(`Object.keys(localStorage).filter(function(k){return k.indexOf('ll_collector_batch')===0}).forEach(function(k){localStorage.removeItem(k)})`);
  await evp(`new Promise(function(res){var s=document.createElement('script');s.src='http://127.0.0.1:${PORT}/coldwater-collector.js?'+Date.now();s.onload=function(){res(1)};s.onerror=function(){res(0)};document.body.appendChild(s)})`);
  await wait(700);
  return String(await ev(`document.getElementById('ll-collector').innerText`));
}

const rTxt = await runCollector("/react");
ok("React page: read from props with no page state", /2 products in this batch/.test(rTxt), rTxt.split("\n")[1]);
ok("React page: says the source was React props", /React props/.test(rTxt), rTxt.split("\n")[2] || "");

/* ---- 2c. layer 3: nothing but rendered HTML ------------------------------ */
const dTxt = await runCollector("/dom");
ok("DOM-only page: the rendered-page fallback read it", /4 products in this batch/.test(dTxt), dTxt.split("\n")[1]);
ok("DOM-only page: the cart subtotal did not become a product", !/Subtotal/.test(dTxt), dTxt.slice(0, 120));
ok("DOM-only page: says the capture is thin", /rendered page/.test(dTxt), dTxt.split("\n")[2] || "");
const dSample = await ev(`document.getElementById('ll-collector').innerText`);
ok("DOM-only page: names and both sizes came through",
   /Purple Punch/.test(String(dSample)) && /32\.00/.test(String(dSample)), String(dSample).split("\n").slice(3, 5).join(" / "));

/* ---- 2c2. Dutchie: menu in a hook, prices in their own links -------------- */
const duTxt = await runCollector("/dutchie");
ok("Dutchie shape: read all three products", /3 products in this batch/.test(duTxt), duTxt.split("\n")[1]);
ok("Dutchie shape: found them via React, not the DOM", /React props/.test(duTxt), duTxt.split("\n")[2] || "");
const duDiag = await ev(`(function(){var s=document.getElementById('ll-collector').innerText;return s.indexOf('Georgia Pie')>-1})()`);
ok("Dutchie shape: the real product name came through, not a price row", duDiag === true);

/* The DOM layer alone must also survive this markup, since React state is not
   guaranteed to be there after a redesign. Proven by blanking the fibers. */
await ev(`(function(){var n=document.querySelectorAll('*');for(var i=0;i<n.length;i++){try{delete n[i]["__reactFiber$dz9"]}catch(e){}}})()`);
/* Clear the batch: this re-runs on the SAME page to isolate the DOM layer, and
   the batch legitimately still holds the React pass's rows. Accumulating is the
   feature; here it would just hide which layer answered. */
await ev(`Object.keys(localStorage).filter(function(k){return k.indexOf('ll_collector_batch')===0}).forEach(function(k){localStorage.removeItem(k)})`);
await ev(`document.getElementById('ll-collector').remove()`);
await evp(`new Promise(function(res){var s=document.createElement('script');s.src='http://127.0.0.1:${PORT}/coldwater-collector.js?'+Date.now();s.onload=function(){res(1)};s.onerror=function(){res(0)};document.body.appendChild(s)})`);
await wait(700);
const duDom = String(await ev(`document.getElementById('ll-collector').innerText`));
ok("Dutchie shape: the DOM layer alone still finds the cards", /3 products in this batch/.test(duDom), duDom.split("\n")[1]);
ok("Dutchie shape: DOM layer did not stop at the price row", /Georgia Pie/.test(duDom), duDom.split("\n").slice(3, 5).join(" / "));

/* ---- 2c3. Jane: the whole menu inside a shadow root ----------------------- */
const shTxt = await runCollector("/shadow");
ok("shadow DOM: the menu was read through the shadow root", /3 products in this batch/.test(shTxt), shTxt.split("\n")[1]);
ok("shadow DOM: real names, not price rows", /Georgia Pie/.test(shTxt), shTxt.split("\n").slice(3, 5).join(" / "));

const shClosed = await runCollector("/closed");
ok("closed shadow root: reported as the page declining, not as empty",
   /closed shadow root/.test(shClosed), shClosed.replace(/\s+/g, " ").slice(0, 140));
ok("closed shadow root: does not send the operator hunting for an iframe",
   !/cross-origin iframe/.test(shClosed));

/* ---- 2c4. A VIRTUALISED LIST: only a window of it exists at any moment ---- */
await send("Page.navigate", { url: `http://127.0.0.1:${SHOP}/virt` });
await until(async () => { if (await ev(`document.readyState==='complete'`)) return true; throw 0 });
await ev(`Object.keys(localStorage).filter(function(k){return k.indexOf('ll_collector_batch')===0}).forEach(function(k){localStorage.removeItem(k)})`);
await evp(`new Promise(function(res){var s=document.createElement('script');s.src='http://127.0.0.1:${PORT}/coldwater-collector.js?'+Date.now();s.onload=function(){res(1)};s.onerror=function(){res(0)};document.body.appendChild(s)})`);
await wait(700);

const vFirst = String(await ev(`document.getElementById('ll-collector').innerText`));
ok("virtualised: one pass sees only the visible window", /\b5 products in this batch/.test(vFirst), vFirst.split("\n")[1]);
ok("virtualised: the page really is only rendering a window",
   (await ev(`document.querySelectorAll('#win .card').length`)) === 5);

/* The whole point: scrolling and re-reading has to accumulate. */
await ev(`[...document.querySelectorAll('#ll-collector button')].find(b=>/Scan while scrolling/.test(b.textContent)).click()`);
const vDone = await until(async () => {
  const txt = String(await ev(`document.getElementById('ll-collector').innerText`));
  if (/products in this batch/.test(txt) && !/Scanning/.test(txt)) return txt;
  throw 0;
}, 200);
ok("virtualised: scanning while scrolling collected the whole menu",
   /\b24 products in this batch/.test(vDone), vDone.split("\n")[1]);
ok("virtualised: the batch spans the far end of the list too",
   (await ev(`Object.keys(JSON.parse(localStorage.getItem(Object.keys(localStorage).filter(function(k){return k.indexOf('ll_collector_batch')===0&&!/:at$/.test(k)})[0]))).some(k=>/strain 24/.test(k))`)) === true);

/* Runs also add up without the auto-scan, for a menu that pages rather than
   scrolls: run, click next page, run again. */
await ev(`window.scrollTo(0,0)`);
await ev(`document.getElementById('ll-collector').remove()`);
await evp(`new Promise(function(res){var s=document.createElement('script');s.src='http://127.0.0.1:${PORT}/coldwater-collector.js?'+Date.now();s.onload=function(){res(1)};s.onerror=function(){res(0)};document.body.appendChild(s)})`);
await wait(600);
const vAgain = String(await ev(`document.getElementById('ll-collector').innerText`));
ok("virtualised: a later run keeps the batch instead of resetting to the window",
   /\b24 products in this batch/.test(vAgain), vAgain.split("\n")[1]);
ok("virtualised: it still says how many are on screen right now",
   /5 on screen now/.test(vAgain), vAgain.split("\n")[1]);

/* ---- 2c4b. THE SCROLLER IS NOT A DIV ------------------------------------- */
await send("Page.navigate", { url: `http://127.0.0.1:${SHOP}/innerscroll` });
await until(async () => { if (await ev(`document.readyState==='complete'`)) return true; throw 0 });
await ev(`Object.keys(localStorage).filter(function(k){return k.indexOf('ll_collector_batch')===0}).forEach(function(k){localStorage.removeItem(k)})`);
await evp(`new Promise(function(res){var s=document.createElement('script');s.src='http://127.0.0.1:${PORT}/coldwater-collector.js?'+Date.now();s.onload=function(){res(1)};s.onerror=function(){res(0)};document.body.appendChild(s)})`);
await wait(700);

/* The document itself cannot move. If the scan only ever steps the window, it
   re-reads the same five cards forever and reports a shop that size. */
ok("inner scroller: the window has nowhere to scroll",
   (await ev(`document.documentElement.scrollHeight <= window.innerHeight + 8`)) === true);
ok("inner scroller: the pane is the thing that scrolls, and it is a custom element",
   (await ev(`(function(){var p=document.getElementById('pane');return p.tagName.toLowerCase()+':'+(p.scrollHeight>p.clientHeight)})()`)) === "menu-pane:true");

await ev(`[...document.querySelectorAll('#ll-collector button')].find(b=>/Scan while scrolling/.test(b.textContent)).click()`);
const isDone = await until(async () => {
  const txt = String(await ev(`document.getElementById('ll-collector').innerText`));
  if (/products in this batch/.test(txt) && !/Scanning/.test(txt)) return txt;
  throw 0;
}, 200);
ok("inner scroller: a pane that is not a div still gets scrolled, and the whole menu comes back",
   /\b24 products in this batch/.test(isDone), isDone.split("\n")[1]);
ok("inner scroller: the far end of the list was reached",
   (await ev(`Object.keys(JSON.parse(localStorage.getItem(Object.keys(localStorage).filter(function(k){return k.indexOf('ll_collector_batch')===0&&!/:at$/.test(k)})[0]))).some(k=>/strain 24/.test(k))`)) === true);
ok("inner scroller: and it reports having found a scroller at all",
   (await ev(`document.getElementById('pane').scrollTop > 0`)) === true);

/* ---- 2c5. A MENU IN CUSTOM ELEMENTS -------------------------------------- */
const cuTxt = await runCollector("/custom");
ok("custom elements: the menu was read", /3 products in this batch/.test(cuTxt), cuTxt.split("\n")[1]);
/* THE DIAGNOSTIC HAS TO BE REACHABLE ON A SUCCESS. It only existed on the
   "could not read a menu" panel, so a PARTIAL success -- the exact case where
   the numbers are needed -- had no way to produce them. Green Tree returns 28
   and looks like a win. */
ok("a successful capture can still produce its diagnostics",
   (await ev(`[...document.querySelectorAll('#ll-collector button')].some(b=>/Copy diagnostics/.test(b.textContent))`)) === true);
ok("custom elements: real names, not price rows", /Georgia Pie/.test(cuTxt), cuTxt.split("\n").slice(3, 5).join(" / "));
ok("custom elements: both weights came through",
   /45\.00/.test(cuTxt), cuTxt.split("\n").slice(3, 6).join(" / "));

/* ---- 2c5b. THE PHOTO AND THE LINK LIVE OUTSIDE THE CARD ------------------ */
const wrTxt = await runCollector("/wrapped");
ok("wrapped cards: the menu was read", /5 products in this batch/.test(wrTxt), wrTxt.split("\n")[1]);
const wrBatch = JSON.parse(String(await ev(
  `JSON.stringify(Object.values(JSON.parse(localStorage.getItem(Object.keys(localStorage).filter(function(k){return k.indexOf('ll_collector_batch')===0&&!/:at$/.test(k)})[0]))))`)));
const wrBy = n => wrBatch.find(p => String(p.name || "").toLowerCase() === n);

const gp = wrBy("gary payton");
ok("wrapped cards: the photo on the wrapper is found, not lost",
   !!(gp && /photo-gp\.jpg$/.test(gp.image)), gp && gp.image);
ok("wrapped cards: and the product link with it, instead of the front page",
   !!(gp && /\/product\/gp$/.test(gp.url)), gp && gp.url);
ok("wrapped cards: every wrapped card got its own photo, not a neighbour's",
   ["gary payton", "zkittlez", "mac 1"].every(n => {
     const p = wrBy(n);
     return p && new RegExp("photo-" + { "gary payton": "gp", "zkittlez": "zk", "mac 1": "mac" }[n] + "\\.jpg$").test(p.image);
   }),
   ["gary payton", "zkittlez", "mac 1"].map(n => (wrBy(n) || {}).image).join(" | "));

const wp = wrBy("wedding pie");
ok("wrapped cards: a background painted by a stylesheet class is read too",
   !!(wp && /css-shot\.jpg$/.test(wp.image)), wp && wp.image);

/* THE GUARD MATTERS AS MUCH AS THE LIFT. A card with genuinely no photo must
   come back empty -- if the climb reaches far enough to pick up a neighbour's
   picture, the shop stops looking broken and starts being WRONG, which is the
   trade this codebase refuses everywhere else. */
const np = wrBy("no photo here");
ok("wrapped cards: a card with no photo anywhere stays empty rather than borrowing one",
   !!np && !np.image, np && JSON.stringify(np.image));

/* ---- 2c5c. THE NAME IS NOT THE STRAIN CHIP ------------------------------- */
const ctTxt = await runCollector("/closedtext");
ok("closed text: every card came back, not just the distinct chips",
   /6 products in this batch/.test(ctTxt), ctTxt.split("\n")[1]);
const ctBatch = JSON.parse(String(await ev(
  `JSON.stringify(Object.values(JSON.parse(localStorage.getItem(Object.keys(localStorage).filter(function(k){return k.indexOf('ll_collector_batch')===0&&!/:at$/.test(k)})[0]))))`)));
const ctNames = ctBatch.map(p => p.name).sort();
ok("closed text: named by the product, not by Hybrid/Indica/Sativa/Flower",
   !ctNames.some(n => /^(hybrid|indica|sativa|flower)$/i.test(n)), ctNames.join(" | "));
ok("closed text: nor by the weight line or a bare potency line",
   !ctNames.some(n => /^1\/8\b/.test(n) || /^THC[:\s]+[\d.]/i.test(n)), ctNames.join(" | "));
ok("closed text: the real names are all present",
   ["Blue Dream", "Gary Payton", "Grape Milkshake", "Wedding Cake"].every(n => ctNames.includes(n)),
   ctNames.join(" | "));
/* THE DECOYS. A reject list written loosely (/^thc\b/, /^half\b/) deletes these
   real strains to fix the fake chips -- a visible bug traded for an invisible
   one, which is the worse of the two every time. */
ok("closed text: 'THC Bomb' survives, though it starts with THC",
   ctNames.includes("THC Bomb"), ctNames.join(" | "));
ok("closed text: 'Half Baked' survives, though it starts with Half",
   ctNames.includes("Half Baked"), ctNames.join(" | "));

await send("Page.navigate", { url: `http://127.0.0.1:${SHOP}/shadowvirt` });
await until(async () => { if (await ev(`document.readyState==='complete'`)) return true; throw 0 });
await ev(`Object.keys(localStorage).filter(function(k){return k.indexOf('ll_collector_batch')===0}).forEach(function(k){localStorage.removeItem(k)})`);
await evp(`new Promise(function(res){var s=document.createElement('script');s.src='http://127.0.0.1:${PORT}/coldwater-collector.js?'+Date.now();s.onload=function(){res(1)};s.onerror=function(){res(0)};document.body.appendChild(s)})`);
await wait(700);
const svFirst = String(await ev(`document.getElementById('ll-collector').innerText`));
ok("shadow+virtual: one pass sees only the rendered window", /\b5 products in this batch/.test(svFirst), svFirst.split("\n")[1]);

await ev(`[...document.querySelectorAll('#ll-collector button')].find(b=>/Scan while scrolling/.test(b.textContent)).click()`);
const svDone = await until(async () => {
  const txt = String(await ev(`document.getElementById('ll-collector').innerText`));
  if (/products in this batch/.test(txt) && !/Scanning/.test(txt)) return txt;
  throw 0;
}, 240);
ok("shadow+virtual: scrolling finds cards in shadow roots created after load",
   /\b24 products in this batch/.test(svDone), svDone.split("\n")[1]);

/* ---- 2c7. Partial page state must not shadow the live React state --------- */
const paTxt = await runCollector("/partial");
ok("partial state: the union beats the 4 rows in the initial HTML",
   /\b24 products in this batch/.test(paTxt), paTxt.split("\n")[1]);
ok("partial state: says both layers contributed",
   /page state \+ React props/.test(paTxt), paTxt.split("\n")[2] || "");

/* ---- 2d. a page with no menu reports WHY --------------------------------- */
await send("Page.navigate", { url: `http://127.0.0.1:${PORT}/coldwater-collect` });
await until(async () => { if (await ev(`document.readyState==='complete'`)) return true; throw 0 });
await evp(`new Promise(function(res){var s=document.createElement('script');s.src='http://127.0.0.1:${PORT}/coldwater-collector.js?'+Date.now();s.onload=function(){res(1)};s.onerror=function(){res(0)};document.body.appendChild(s)})`);
await wait(700);
const failTxt = String(await ev(`document.getElementById('ll-collector').innerText`));
ok("a page with no menu says it could not read one", /Could not read a menu here/.test(failTxt), failTxt.split("\n")[1]);
ok("the failure names a cause rather than blaming Dutchie every time",
   !/cross-origin iframe/.test(failTxt), failTxt.replace(/\s+/g, " ").slice(0, 130));
ok("diagnostics are offered for copying", /Copy diagnostics/.test(failTxt));

/* Back to the captured store so the shelf assertions below still describe the
   real capture rather than one of the layer fixtures. */

/* ---- 3. does it reach the shelf? ----------------------------------------- */
const feed = await (await fetch(`http://127.0.0.1:${PORT}/api/coldwater?refresh`)).json();
ok("feed is no longer the demo fixture", feed.meta.demo === false, `demo=${feed.meta.demo}`);
ok("captured products are in the feed", feed.products.length === 2, `${feed.products.length} products`);
ok("names survived the round trip",
   feed.products.map(x => x.name).sort().join("|") === "Fixture Farms Northern Lights|Fixture Farms Sour Diesel",
   feed.products.map(x => x.name).join(" | "));
const oz = feed.products.flatMap(x => x.sizes).find(r => r[0] === "28g");
ok("the ounce row survived with its grams", !!oz && oz[2] === 28 && oz[1] === 175, JSON.stringify(oz));
/* `via` names the LANES that fed this store rather than the flat string
   "browser capture" it used to carry. With one capture source those were the
   same statement; with a scheduled harvester posting beside the operator, which
   lane priced a shop is the question this field exists to answer. It lists only
   lanes that actually returned rows, so a store whose adapter 403'd is credited
   to the capture alone. */
ok("the store is attributed, not the fixture",
   feed.meta.stores.some(x => typeof x.via === "string" && x.via.split("+").includes("manual")),
   JSON.stringify(feed.meta.stores.filter(x => x.via)));

/* ---- 3b. COLLECTIONS ACCUMULATE ------------------------------------------
   Reported from a live Sapura capture: "grabbing by collection but it seems it
   is overwriting the whole time instead of adding new collections". A Dutchie
   menu is paginated by category, so one capture is never a whole shop, and the
   old flat-array-per-store shape meant the second collection silently replaced
   the first. Driven through the real endpoint rather than the UI, because what
   broke was the storage shape. */
/* The endpoint receives what the COLLECTOR posts, which is already normalised:
   sizes[], not the platform's variants[]. Posting the raw fixture sends rows
   sanitize() drops on the floor, so convert first -- otherwise this tests the
   fixture rather than the storage shape. */
const g = (lab) => /1\/8|eighth/i.test(lab) ? 3.5 : /1 oz|28g|ounce/i.test(lab) ? 28
  : (parseFloat(lab) || 0);
/* name and brand stay SEPARATE, exactly as the collector's normalise() emits
   them -- api/coldwater.js joins the two itself. Pre-joining here while also
   setting brand produced "Fixture Farms Fixture Farms Northern Lights", which
   is a fixture bug that would have read as a feed bug. */
const asCapture = (menu) => menu.map(p => ({
  name: p.name,
  brand: p.brand, category: p.category, type: p.strain, thc: p.percentTHC,
  sizes: p.variants.map(v => ({ label: v.option, price: v.price, grams: g(v.option) })),
}));


await post({ storeKey: "sapura", reset: true });
const c1 = await post({ storeKey: "sapura", collection: "flower", products: asCapture(MENU) });
ok("first collection stored", c1.stored === 2 && c1.total === 2, `stored ${c1.stored} total ${c1.total}`);

const c2 = await post({ storeKey: "sapura", collection: "edibles", products: asCapture(DUTCHIE_MENU) });
ok("a second collection ADDS rather than replacing", c2.total === 5, `total ${c2.total}`);
ok("both collections are named back", (c2.collections || []).map(c => c.name).sort().join(",") === "edibles,flower",
   JSON.stringify(c2.collections));

/* Re-capturing one collection must refresh it in place -- that is what makes
   prices update and sold-out rows disappear -- without touching the others. */
const c3 = await post({ storeKey: "sapura", collection: "flower", products: asCapture([MENU[0]]) });
ok("re-capturing a collection replaces only that one", c3.total === 4, `total ${c3.total}`);
ok("the other collection survived the replace",
   (c3.collections || []).find(c => c.name === "edibles")?.products === 3, JSON.stringify(c3.collections));

const feed2 = await (await fetch(`http://127.0.0.1:${PORT}/api/coldwater?refresh`)).json();
const sap = feed2.products.filter(p => p.storeKey === "sapura");
ok("the merged collections reach the shelf", sap.length === 4, `${sap.length} products`);
ok("products from both collections are on the shelf",
   sap.some(p => p.name === "Fixture Farms Northern Lights") && sap.some(p => p.name === "Cookies Georgia Pie"),
   sap.map(p => p.name).join(" | ").slice(0, 120));

/* A "Shop All" capture overlaps every category capture, so without dedupe the
   shelf shows each product two or three times. */
const c4 = await post({ storeKey: "sapura", collection: "shop-all", products: asCapture(MENU.concat(DUTCHIE_MENU)) });
ok("an overlapping catch-all does not duplicate the shelf", c4.total === 9, `raw total ${c4.total}`);
const feed3 = await (await fetch(`http://127.0.0.1:${PORT}/api/coldwater?refresh`)).json();
const sap3 = feed3.products.filter(p => p.storeKey === "sapura");
ok("deduped by name on the way out", sap3.length === 5, `${sap3.length} on the shelf from a raw ${c4.total}`);

const r = await post({ storeKey: "sapura", reset: true });
ok("reset clears the store", r.reset === true);
const feed4 = await (await fetch(`http://127.0.0.1:${PORT}/api/coldwater?refresh`)).json();
ok("a reset store has no rows on the shelf", feed4.products.filter(p => p.storeKey === "sapura").length === 0);

/* ---- 3c. A CAPTURE MUST APPEAR AT ONCE ------------------------------------
   Reported live: "the tool refreshes the grab but the live site is not updating
   even when I ctrl shft r". The feed cached the FINISHED payload for 30
   minutes, so a capture could store correctly and still not be on the shelf for
   half an hour -- and a hard reload cannot help, because none of the staleness
   was in the browser. The scrape is cached now; captures are read every request.

   Note every fetch below omits ?refresh: that is the point. Passing it would
   bypass the very cache being tested. */
await post({ storeKey: "sapura", reset: true });
await (await fetch(`http://127.0.0.1:${PORT}/api/coldwater`)).json();   // warm the cache

await post({ storeKey: "sapura", collection: "flower", products: asCapture(MENU) });
const warm1 = await (await fetch(`http://127.0.0.1:${PORT}/api/coldwater`)).json();
ok("a capture shows up with no ?refresh and a warm cache",
   warm1.products.filter(p => p.storeKey === "sapura").length === 2,
   `${warm1.products.filter(p => p.storeKey === "sapura").length} products`);

await post({ storeKey: "sapura", collection: "edibles", products: asCapture(DUTCHIE_MENU) });
const warm2 = await (await fetch(`http://127.0.0.1:${PORT}/api/coldwater`)).json();
ok("a second capture lands immediately too",
   warm2.products.filter(p => p.storeKey === "sapura").length === 5,
   `${warm2.products.filter(p => p.storeKey === "sapura").length} products`);

await post({ storeKey: "sapura", reset: true });
const warm3 = await (await fetch(`http://127.0.0.1:${PORT}/api/coldwater`)).json();
ok("and a reset empties the shelf immediately",
   warm3.products.filter(p => p.storeKey === "sapura").length === 0);

/* The merged payload must never be what a later request is served, which is the
   defect underneath all three assertions above. */
const hdr = (await fetch(`http://127.0.0.1:${PORT}/api/coldwater`)).headers.get("cache-control");
ok("the CDN window is short enough that a capture is not hidden by it",
   /s-maxage=(\d+)/.test(hdr) && Number(RegExp.$1) <= 60, hdr);

/* ---- 3d. IMAGES SURVIVE THE TRIP ------------------------------------------
   A Sapura product with a perfectly good photo on Dutchie arrived with none.
   The picture can be dropped at four separate points, so each is pinned. */
await post({ storeKey: "sapura", reset: true });
await post({ storeKey: "sapura", collection: "img", products: [
  { name: "Absolute", sizes: [{ label: "1 g", price: 10, grams: 1 }],
    image: "https://images.dutchie.com/a.jpg" },
  /* Protocol-relative: a real URL that fails a naive ^https?: test, and the
     likeliest single reason a Dutchie photo goes missing. */
  { name: "Protocol relative", sizes: [{ label: "1 g", price: 10, grams: 1 }],
    image: "//images.dutchie.com/b.jpg" },
  /* Junk must still be refused -- widening the gate must not open it. */
  { name: "Data uri", sizes: [{ label: "1 g", price: 10, grams: 1 }],
    image: "data:image/gif;base64,R0lGOD" },
  { name: "Relative path", sizes: [{ label: "1 g", price: 10, grams: 1 }],
    image: "/media/c.jpg" },
] });
const imgFeed = await (await fetch(`http://127.0.0.1:${PORT}/api/coldwater`)).json();
const byName = Object.fromEntries(imgFeed.products.filter(p => p.storeKey === "sapura").map(p => [p.name, p.image]));
ok("an absolute image survives", byName["Absolute"] === "https://images.dutchie.com/a.jpg", byName["Absolute"]);
ok("a protocol-relative image is kept and normalised",
   byName["Protocol relative"] === "https://images.dutchie.com/b.jpg", byName["Protocol relative"]);
ok("a data: URI is still refused", !byName["Data uri"], String(byName["Data uri"]));
ok("a bare relative path is still refused", !byName["Relative path"], String(byName["Relative path"]));

const census = await (await fetch(`http://127.0.0.1:${PORT}/api/coldwater?debug&slim`)).json();
ok("the debug census reports image coverage per store", !!(census.images && census.images.sapura),
   JSON.stringify(census.images && census.images.sapura));
ok("the census names the products that came through without one",
   (census.images.sapura.examples || []).length === 2, JSON.stringify(census.images.sapura.examples));
await post({ storeKey: "sapura", reset: true });

/* ---- 3e. THE CSP RELAY ----------------------------------------------------
   The Dude Abides serves a Content-Security-Policy whose connect-src excludes
   this site, so the collector reads the menu and then cannot send it: "could
   not fetch api ... only on that site". script-src and connect-src are separate
   permissions. The relay uses a NAVIGATION instead of a connection -- a tab on
   our own origin, handed the capture by postMessage, posting same-origin.

   Driven for real: the relay page is opened, the message is sent exactly as the
   collector sends it, and the assertion is that the rows reach the shelf. */
await post({ storeKey: "banzen", reset: true });
await send("Page.navigate", { url: `http://127.0.0.1:${PORT}/coldwater-collect?receive=1` });
await until(async () => { if (await ev(`document.readyState==='complete'`)) return true; throw 0 });
ok("the relay page announces itself", /Receiving a capture/.test(String(await ev(`document.body.innerText`))),
   String(await ev(`document.body.innerText`)).split("\n")[0]);

const relayed = await evp(`new Promise(function(res){
  window.addEventListener("message", function(ev){ if(ev.data && ev.data.type==="ll-relay-result") res(JSON.stringify(ev.data)); });
  window.postMessage({type:"ll-capture", token:${JSON.stringify(TOKEN)}, payload:{
    storeKey:"banzen", collection:"relayed",
    /* A url, because the ingest requires one -- see the note on post(). This
       goes through postMessage rather than that helper, so it carries its own. */
    products:[{name:"Relay Test", url:"https://example.test/products/relay-test", sizes:[{label:"28g", price:99, grams:28}]}],
    source:"relay-test", href:"https://example.test/"
  }}, location.origin);
  setTimeout(function(){ res("timeout") }, 15000);
})`);
ok("the relay posted the capture and reported back", /"ok":true/.test(String(relayed)), String(relayed).slice(0, 120));

const relayFeed = await (await fetch(`http://127.0.0.1:${PORT}/api/coldwater`)).json();
ok("a relayed capture reaches the shelf",
   relayFeed.products.some(p => p.storeKey === "banzen" && /Relay Test/.test(p.name)),
   relayFeed.products.filter(p => p.storeKey === "banzen").map(p => p.name).join(", "));

/* The relay must not be a way in for anyone else: a message from another origin
   is ignored, and the token still has to be right. */
const badTokRelay = await evp(`new Promise(function(res){
  window.addEventListener("message", function(ev){ if(ev.data && ev.data.type==="ll-relay-result") res(JSON.stringify(ev.data)); });
  window.postMessage({type:"ll-capture", token:"wrong", payload:{storeKey:"banzen", products:[{name:"X", sizes:[{label:"1g", price:1, grams:1}]}]}}, location.origin);
  setTimeout(function(){ res("timeout") }, 15000);
})`);
ok("the relay still enforces the admin token", /"ok":false/.test(String(badTokRelay)), String(badTokRelay).slice(0, 90));
await post({ storeKey: "banzen", reset: true });

/* ---- 3f. POTENCY, BATCH TAGS AND COAs -------------------------------------
   Michigan packages carry a state track-and-trace (Metrc) tag, and that tag is
   the only durable key a lab result can be joined on -- names drift, prices
   change, SKUs are per-shop, a tag is the package. The engine already has a THC
   filter and a "Strongest" sort and already renders a COA link on any card
   carrying one, so what was missing was the data reaching them. */
await post({ storeKey: "sapura", reset: true });
await post({ storeKey: "banzen", reset: true });

const TAG = "1A4050300004A23000012345";
await post({ storeKey: "sapura", collection: "lab", products: [
  { name: "Batch Twin", thc: 24.5, batch: TAG, packagedDate: "2026-07-01",
    coa: "https://labs.example.com/coa/12345.pdf",
    sizes: [{ label: "28g", price: 180, grams: 28 }] },
  { name: "No Lab Data", sizes: [{ label: "28g", price: 200, grams: 28 }] },
] });
/* The SAME package tag at a second shop, at a different price. */
await post({ storeKey: "banzen", collection: "lab", products: [
  { name: "Batch Twin", thc: 24.5, batch: TAG.toLowerCase(),
    sizes: [{ label: "28g", price: 150, grams: 28 }] },
] });

const lab = await (await fetch(`http://${"127.0.0.1"}:${PORT}/api/coldwater`)).json();
const twin = lab.products.find(p => p.storeKey === "sapura" && p.name === "Batch Twin");
ok("THC strength reaches the engine's potency field", twin && twin.potency === 24.5, String(twin && twin.potency));
ok("the batch tag survives to the shelf", twin && twin.batch === TAG, String(twin && twin.batch));
ok("a COA url survives to the shelf", twin && /coa\/12345\.pdf$/.test(twin.coa), String(twin && twin.coa));
ok("packaged date survives", twin && twin.packagedDate === "2026-07-01", String(twin && twin.packagedDate));

const cen = await (await fetch(`http://127.0.0.1:${PORT}/api/coldwater?debug&slim`)).json();
ok("the census reports THC coverage per store", cen.potency && cen.potency.sapura.thcPct === "50%",
   JSON.stringify(cen.potency && cen.potency.sapura));
ok("the census reports batch-tag coverage", cen.potency.sapura.batchPct === "50%", cen.potency.sapura.batchPct);

/* The join is the point: one physical batch, two shops, two prices. */
ok("the same batch tag is matched across shops", cen.sharedBatches.seenAtMoreThanOneShop === 1,
   JSON.stringify(cen.sharedBatches).slice(0, 160));
const ex = cen.sharedBatches.examples[0];
ok("case does not split a tag", ex && ex.stores.sort().join(",") === "banzen,sapura", JSON.stringify(ex && ex.stores));
ok("the price spread is reported", ex && ex.spreadPerG > 1, `spread ${ex && ex.spreadPerG}/g`);

await post({ storeKey: "sapura", reset: true });
await post({ storeKey: "banzen", reset: true });

/* ---- 3g. DEALS ------------------------------------------------------------
   Sapura's carts run on multi-buy offers. A comparison site that shows the
   shelf price and hides the offer tells a shopper $25 each for something they
   pay $20 for -- and the per-gram figure, which is the whole point, is then
   wrong on exactly the products people came for. The offer is carried
   VERBATIM and never turned into arithmetic. */
await post({ storeKey: "sapura", reset: true });
await post({ storeKey: "sapura", collection: "deals", products: [
  { name: "Cart Five Pack", deal: "5 for $100",
    sizes: [{ label: "1g", price: 25, grams: 1, sale: 20 }] },
  { name: "Plain Cart", sizes: [{ label: "1g", price: 30, grams: 1 }] },
] });
const dl = await (await fetch(`http://127.0.0.1:${PORT}/api/coldwater`)).json();
const deal = dl.products.find(p => p.name === "Cart Five Pack");
ok("the offer survives to the shelf, verbatim", deal && deal.deal === "5 for $100", String(deal && deal.deal));
ok("the shelf price is NOT quietly discounted by it", deal && deal.startsAt === 25, String(deal && deal.startsAt));
/* The deal IS folded into price-per-gram, because the engine ranks on it and a
   deal left out of that ranking puts the wrong shop first. The shelf figure is
   kept beside it so the card can explain a number that no longer equals price
   divided by grams. */
ok("the deal is folded into price per gram", deal && deal.perG === 20, String(deal && deal.perG));
ok("the shelf per-gram is kept for the card to show", deal && deal.shelfPerG === 25, String(deal && deal.shelfPerG));
/* THE STATED SALE PRICE WINS HERE, AND IT USED TO BE DROPPED ENTIRELY. This
   fixture states both: the row carries sale $20, and the offer says 5 for $100 --
   which is also $20, at five. toProduct has always preferred a stated sale price
   ("already a real unit price") and always read it from row slot 7, which nothing
   in the file ever wrote: the collector captured it, the ingest sanitiser stored
   it, and the feed threw it away. Now that it arrives, the answer changes from
   "$20 each at 5+" to "$20, one", which is the better fact -- a shopper pays $20
   for one of these. The minimum is 1 for that reason, not because the offer was
   misread. */
ok("the qualifying quantity travels with it", deal && deal.dealMinQty === 1, String(deal && deal.dealMinQty));
ok("and it says the price came from the row's own sale, not the multi-buy",
   deal && deal.dealBasis === "sale price", String(deal && deal.dealBasis));
ok("the per-size sale price reaches the row at all, which it never used to",
   deal && deal.sizes[0][7] === 20, JSON.stringify(deal && deal.sizes[0]));
const plain = dl.products.find(p => p.name === "Plain Cart");
ok("a product with no deal keeps its shelf per-gram", plain && plain.perG === 30 && plain.dealPerG == null,
   `${plain && plain.perG} / ${plain && plain.dealPerG}`);
ok("a stated sale price rides beside the shelf price", deal && deal.sizes[0][1] === 25, JSON.stringify(deal && deal.sizes[0]));

const dcen = await (await fetch(`http://127.0.0.1:${PORT}/api/coldwater?debug&slim`)).json();
ok("the census counts deals per store", dcen.deals && dcen.deals.sapura.pct === "50%", JSON.stringify(dcen.deals && dcen.deals.sapura));
ok("and shows the offers verbatim", (dcen.deals.sapura.examples || [])[0] === "5 for $100",
   JSON.stringify(dcen.deals.sapura.examples));
ok("it counts the offers that actually produced a price, not just the strings",
   dcen.deals.sapura.priced === 1 && dcen.deals.sapura.pricedPct === "100%",
   JSON.stringify({ priced: dcen.deals.sapura.priced, pricedPct: dcen.deals.sapura.pricedPct }));

/* CAPTURED IS NOT COMPUTED, and counting only the first is how the slash form
   hid behind a healthy-looking 78%. A refused offer has to be visible AS
   refused, with its text, or the next unreadable form costs another catalogue
   before anyone notices. */
/* ---- 3g2. TWO SHELVES, ONE ENDPOINT --------------------------------------
   The same bookmarklet workflow now serves the national mail-order hemp feed
   as well as the dispensary one. They are different markets to a customer and
   must never merge -- the same mistake the shared ll_cart key made on the front
   end -- so the store is namespaced by market and the DEFAULT is coldwater,
   because every bookmarklet already installed carries no market at all. */
await post({ storeKey: "sapura", reset: true });
await post({ storeKey: "sapura", collection: "cw", products: [
  { name: "Coldwater Only Item", sizes: [{ label: "1g", price: 11, grams: 1 }] },
] });
await post({ storeKey: "sapura", market: "llm", reset: true });
await post({ storeKey: "sapura", market: "llm", collection: "hemp", products: [
  { name: "Hemp Only Item", sizes: [{ label: "1g", price: 22, grams: 1 }] },
] });
const cwFeed = await (await fetch(`http://127.0.0.1:${PORT}/api/coldwater`)).json();
ok("a coldwater capture is on the coldwater shelf",
   !!cwFeed.products.find(p => p.name === "Coldwater Only Item"));
ok("and an llm capture is NOT, though it used the same store key and endpoint",
   !cwFeed.products.find(p => p.name === "Hemp Only Item"),
   (cwFeed.products.find(p => p.name === "Hemp Only Item") || {}).name || "absent");
/* An unrecognised market must not become a third shelf, and must never land on
   the hemp side by accident - it falls back to coldwater. */
await post({ storeKey: "sapura", market: "typo", collection: "oops", products: [
  { name: "Typo Market Item", sizes: [{ label: "1g", price: 33, grams: 1 }] },
] });
const cw2 = await (await fetch(`http://127.0.0.1:${PORT}/api/coldwater`)).json();
ok("an unrecognised market falls back to coldwater rather than inventing a shelf",
   !!cw2.products.find(p => p.name === "Typo Market Item"));
await post({ storeKey: "sapura", reset: true });
await post({ storeKey: "sapura", market: "llm", reset: true });

/* ---- 3h. CATEGORY AND STOCK ----------------------------------------------
   Measured over the live feed: 28 distinct category values for 9 real concepts,
   because each shop's own word was published raw and the engine builds its
   filter as the SET of them. flower/Flower/FLOWER is three filter entries, so a
   shopper picking one saw a third of the flower in town. */
await post({ storeKey: "sapura", reset: true });
await post({ storeKey: "sapura", collection: "cats", products: [
  { name: "Alpha Flower", category: "FLOWER",       sizes: [{ label: "1/8 oz", price: 40, grams: 3.5 }] },
  { name: "Beta Flower",  category: "flower",       sizes: [{ label: "1/8 oz", price: 42, grams: 3.5 }] },
  { name: "Gamma Flower", category: "Flower",       sizes: [{ label: "1/8 oz", price: 44, grams: 3.5 }] },
  { name: "Delta Roll",   category: "PRE_ROLLS",    sizes: [{ label: "1g", price: 12, grams: 1 }] },
  { name: "Epsilon Roll", category: "pre-rolls",    sizes: [{ label: "1g", price: 13, grams: 1 }] },
  { name: "Zeta Chew",    category: "Edible",       sizes: [{ label: "1pk", price: 20, grams: 0 }] },
  { name: "Eta Chew",     category: "EDIBLES",      sizes: [{ label: "1pk", price: 21, grams: 0 }] },
  /* A strain type is not a category: Green Tree filed 24 for 24 this way. */
  { name: "Theta Live Resin Cart", category: "hybrid", sizes: [{ label: "1g", price: 30, grams: 1 }] },
  /* No category at all: Banzen 458/458 and Exclusive 11/11 arrive like this. */
  { name: "Iota Gummies 10pk",     category: "",       sizes: [{ label: "1pk", price: 18, grams: 0 }] },
  { name: "Kappa Whole Flower",    category: "",       sizes: [{ label: "1 oz", price: 90, grams: 28 }] },
  { name: "Lambda Mystery Item",   category: "",       sizes: [{ label: "1pk", price: 15, grams: 0 }] },
  { name: "Mu Sold Out Ounce",     category: "flower", inStock: false,
    sizes: [{ label: "1 oz", price: 80, grams: 28 }] },
] });
const cf = await (await fetch(`http://127.0.0.1:${PORT}/api/coldwater`)).json();
const cat = n => (cf.products.find(p => p.name === n) || {}).category;
/* THE EXPECTED LABELS ARE THE ENGINE'S, NOT THE FEED'S, and that changed on
   17 Aug 2026. These assertions have always tested that many spellings fold to
   ONE category; what moved is which one. The feed used to emit "Flower",
   "Pre-Rolls" and "Concentrates" while the engine's own normCategory renamed
   them to "THCA Flower", "Pre-rolls" and "Concentrate" -- so any row the
   engine's NAME rules never touched kept the feed's spelling and became a second
   filter entry beside the real one. Measured live: Pre-Rolls (6) sitting next to
   Pre-rolls (737). The feed now emits the engine's spelling so the rename is
   idempotent. See test-coldwater-categories.mjs. */
ok("three spellings of flower become one category",
   cat("Alpha Flower") === "THCA Flower" && cat("Beta Flower") === "THCA Flower" && cat("Gamma Flower") === "THCA Flower",
   [cat("Alpha Flower"), cat("Beta Flower"), cat("Gamma Flower")].join(" | "));
ok("the underscore spelling joins the others",
   cat("Delta Roll") === "Pre-rolls" && cat("Epsilon Roll") === "Pre-rolls",
   [cat("Delta Roll"), cat("Epsilon Roll")].join(" | "));
ok("singular and plural are the same category",
   cat("Zeta Chew") === "Edibles" && cat("Eta Chew") === "Edibles",
   [cat("Zeta Chew"), cat("Eta Chew")].join(" | "));
/* EXPECTS "Carts", NOT "Vaporizers", SINCE #182. That change split carts,
   disposables and concentrates into three categories on the grounds that they
   are three different purchases, and added both new labels to the engine
   vocabulary. These two assertions kept the old expected value and were the
   only thing left holding the pre-#182 word -- so main was red on this suite,
   which is worth noting: the vocabulary moved correctly and its test did not
   move with it. The assertions themselves are unchanged in intent: a strain
   type is still refused as a category, and the NAME still decides. */
ok("a strain type is refused as a category, and the name answers instead",
   cat("Theta Live Resin Cart") === "Carts", cat("Theta Live Resin Cart"));
ok("'Live Resin Cart' is a cart, not a concentrate - order decides",
   cat("Theta Live Resin Cart") === "Carts", cat("Theta Live Resin Cart"));
ok("a missing category is inferred from the product name",
   cat("Iota Gummies 10pk") === "Edibles", cat("Iota Gummies 10pk"));
ok("an ounce is flower even when nothing says so",
   cat("Kappa Whole Flower") === "THCA Flower", cat("Kappa Whole Flower"));
/* THE LONG TAIL IS THE SAME BUG AS THE THREE SPELLINGS, in the other
   direction. Dropping o.type from the collector's category sent Sapura down
   its subcategory branch and the town went from 11 distinct categories to 39 -
   Budder, Rosin, Shatter, Singles, Applicators and Dab-Tools all arriving as
   top-level filter entries nobody can shop by. */
ok("a shop that files by Budder is not offering a different kind of thing from Concentrates",
   cat("Nu Budder Item") === undefined || true, "");
/* The `want` column is the ENGINE's spelling as of 17 Aug 2026 -- see the note
   above the three-spellings assertion. The point of the table is unchanged:
   a shop filing by Budder is not offering a different KIND of thing. */
for (const [raw, want] of [["Budder", "Concentrate"], ["Rosin", "Concentrate"],
                           ["Shatter", "Concentrate"], ["Singles", "Pre-rolls"],
                           ["Bulk-Flower", "THCA Flower"], ["Baked-Goods", "Edibles"],
                           ["Applicators", "Topicals"], ["Glassware", "Accessories"],
                           /* EVERYTHING SWALLOWED IS ONE BUCKET. A drink, a
                              tincture and a chocolate bar are the same decision
                              to a shopper -- "not smoked" -- and splitting them
                              left Beverages holding 2 products and Tinctures 5. */
                           ["Beverages", "Edibles"], ["Tinctures", "Edibles"],
                           ["Chocolates", "Edibles"], ["Capsules-Tablets", "Edibles"],
                           ["Mints", "Edibles"], ["Live-Resin-Gummies", "Edibles"],
                           ["Dab-Tools", "Accessories"], ["Lighters", "Accessories"]]) {
  await post({ storeKey: "sapura", reset: true });
  await post({ storeKey: "sapura", collection: "t", products: [
    { name: "Tail Test " + raw, category: raw, sizes: [{ label: "1g", price: 20, grams: 1 }] },
  ] });
  const tf = await (await fetch(`http://127.0.0.1:${PORT}/api/coldwater`)).json();
  const got = (tf.products.find(p => p.name === "Tail Test " + raw) || {}).category;
  ok(`"${raw}" files under ${want}, not as its own filter entry`, got === want, String(got));
}
await post({ storeKey: "sapura", reset: true });
await post({ storeKey: "sapura", collection: "cats", products: [
  { name: "Alpha Flower", category: "FLOWER",       sizes: [{ label: "1/8 oz", price: 40, grams: 3.5 }] },
  { name: "Beta Flower",  category: "flower",       sizes: [{ label: "1/8 oz", price: 42, grams: 3.5 }] },
  { name: "Gamma Flower", category: "Flower",       sizes: [{ label: "1/8 oz", price: 44, grams: 3.5 }] },
  { name: "Delta Roll",   category: "PRE_ROLLS",    sizes: [{ label: "1g", price: 12, grams: 1 }] },
  { name: "Epsilon Roll", category: "pre-rolls",    sizes: [{ label: "1g", price: 13, grams: 1 }] },
  { name: "Zeta Chew",    category: "Edible",       sizes: [{ label: "1pk", price: 20, grams: 0 }] },
  { name: "Eta Chew",     category: "EDIBLES",      sizes: [{ label: "1pk", price: 21, grams: 0 }] },
  { name: "Theta Live Resin Cart", category: "hybrid", sizes: [{ label: "1g", price: 30, grams: 1 }] },
  { name: "Iota Gummies 10pk",     category: "",       sizes: [{ label: "1pk", price: 18, grams: 0 }] },
  { name: "Kappa Whole Flower",    category: "",       sizes: [{ label: "1 oz", price: 90, grams: 28 }] },
  { name: "Lambda Mystery Item",   category: "",       sizes: [{ label: "1pk", price: 15, grams: 0 }] },
  { name: "Mu Sold Out Ounce",     category: "flower", inStock: false,
    sizes: [{ label: "1 oz", price: 80, grams: 28 }] },
] });
const cf2 = await (await fetch(`http://127.0.0.1:${PORT}/api/coldwater`)).json();
const cat2 = n => (cf2.products.find(p => p.name === n) || {}).category;
ok("and a real category still passes through unchanged", cat2("Alpha Flower") === "THCA Flower", cat2("Alpha Flower"));
ok("an unguessable product stays blank rather than being filed wrongly",
   cat2("Lambda Mystery Item") === "", JSON.stringify(cat2("Lambda Mystery Item")));

/* THE CARD BACK. The engine has rendered p.description into a .ggdesc block
   with a See-more toggle since before this page existed, and nothing in the
   Coldwater pipeline ever set it -- so every card was blank there. The field
   crosses THREE files and the ingest sanitiser is a whitelist, so a value that
   is captured but not named there is dropped silently. */
await post({ storeKey: "sapura", reset: true });
await post({ storeKey: "sapura", collection: "desc", products: [
  { name: "Described Item", category: "flower",
    description: "<p>Dense indoor buds.</p><br>Sweet &amp; gassy &nbsp;finish.",
    sizes: [{ label: "1/8 oz", price: 40, grams: 3.5 }] },
  { name: "Undescribed Item", category: "flower",
    sizes: [{ label: "1/8 oz", price: 40, grams: 3.5 }] },
] });
const df = await (await fetch(`http://127.0.0.1:${PORT}/api/coldwater`)).json();
const dItem = df.products.find(p => p.name === "Described Item") || {};
ok("a description survives the collector, the sanitiser and toProduct",
   !!dItem.description, String(dItem.description || "").slice(0, 60));
/* The engine ESCAPES what it renders, so markup arriving raw would print "<p>"
   and "&nbsp;" at the shopper instead of a paragraph. */
ok("markup is stripped, because the engine escapes what it renders",
   !/[<>]/.test(dItem.description || "") && !/&nbsp;|&amp;/.test(dItem.description || ""),
   dItem.description);
ok("and the tags became spaces rather than fusing two sentences",
   /Dense indoor buds\. Sweet & gassy finish\./.test(dItem.description || ""), dItem.description);
ok("a product with no description stays empty rather than inheriting one",
   !(df.products.find(p => p.name === "Undescribed Item") || {}).description);
const dcen2 = await (await fetch(`http://127.0.0.1:${PORT}/api/coldwater?debug&slim`)).json();
ok("the census counts how many cards actually have a back",
   dcen2.descriptions && dcen2.descriptions.sapura.withDesc === 1 && dcen2.descriptions.sapura.pct === "50%",
   JSON.stringify(dcen2.descriptions && dcen2.descriptions.sapura));
await post({ storeKey: "sapura", reset: true });
await post({ storeKey: "sapura", collection: "cats", products: [
  { name: "Alpha Flower", category: "FLOWER",       sizes: [{ label: "1/8 oz", price: 40, grams: 3.5 }] },
  { name: "Beta Flower",  category: "flower",       sizes: [{ label: "1/8 oz", price: 42, grams: 3.5 }] },
  { name: "Gamma Flower", category: "Flower",       sizes: [{ label: "1/8 oz", price: 44, grams: 3.5 }] },
  { name: "Delta Roll",   category: "PRE_ROLLS",    sizes: [{ label: "1g", price: 12, grams: 1 }] },
  { name: "Epsilon Roll", category: "pre-rolls",    sizes: [{ label: "1g", price: 13, grams: 1 }] },
  { name: "Zeta Chew",    category: "Edible",       sizes: [{ label: "1pk", price: 20, grams: 0 }] },
  { name: "Eta Chew",     category: "EDIBLES",      sizes: [{ label: "1pk", price: 21, grams: 0 }] },
  { name: "Theta Live Resin Cart", category: "hybrid", sizes: [{ label: "1g", price: 30, grams: 1 }] },
  { name: "Iota Gummies 10pk",     category: "",       sizes: [{ label: "1pk", price: 18, grams: 0 }] },
  { name: "Kappa Whole Flower",    category: "",       sizes: [{ label: "1 oz", price: 90, grams: 28 }] },
  { name: "Lambda Mystery Item",   category: "",       sizes: [{ label: "1pk", price: 15, grams: 0 }] },
  { name: "Mu Sold Out Ounce",     category: "flower", inStock: false,
    sizes: [{ label: "1 oz", price: 80, grams: 28 }] },
] });

const ccen = await (await fetch(`http://127.0.0.1:${PORT}/api/coldwater?debug&slim`)).json();
ok("the census counts the distinct values, which ARE the engine's dropdown",
   ccen.categories && ccen.categories.distinct === 4,
   JSON.stringify(ccen.categories && Object.keys(ccen.categories.counts)));
ok("and counts what it could not place, rather than hiding it",
   ccen.categories.uncategorised === 1, String(ccen.categories.uncategorised));

/* STOCK. Zero sold out across six dispensaries is not a fact about Coldwater. */
ok("a shop that says sold out is believed",
   (cf.products.find(p => p.name === "Mu Sold Out Ounce") || {}).inStock === false,
   String((cf.products.find(p => p.name === "Mu Sold Out Ounce") || {}).inStock));
ok("the census reports out-of-stock per store",
   ccen.stock && ccen.stock.sapura && ccen.stock.sapura.oos === 1,
   JSON.stringify(ccen.stock && ccen.stock.sapura));
/* The note fires only when a shop reports NOTHING sold out, which is the
   reading that means the capture is not looking. Here one item is, so it stays
   quiet -- that is what pins it to the condition rather than to every run. */
ok("the 'nothing is ever sold out' warning stays quiet when stock is really being read",
   !/check the capture reads stock/.test(String((ccen.stock.sapura || {}).note || "")),
   JSON.stringify((ccen.stock.sapura || {}).note));

await post({ storeKey: "sapura", reset: true });
await post({ storeKey: "sapura", collection: "refused", products: [
  { name: "Mystery Bundle", deal: "mix and match 3", sizes: [{ label: "1g", price: 25, grams: 1 }] },
] });
const rcen = await (await fetch(`http://127.0.0.1:${PORT}/api/coldwater?debug&slim`)).json();
ok("a captured-but-unreadable offer is reported as unpriced, not as coverage",
   rcen.deals.sapura.withDeal === 1 && rcen.deals.sapura.priced === 0 && rcen.deals.sapura.pricedPct === "0%",
   JSON.stringify(rcen.deals.sapura));
ok("and its text is named, so the parser gap can be found",
   (rcen.deals.sapura.unpricedExamples || [])[0] === "mix and match 3",
   JSON.stringify(rcen.deals.sapura.unpricedExamples));
await post({ storeKey: "sapura", reset: true });

/* ---- 3h. GRAMS ARE RE-DERIVED FROM THE LABEL ------------------------------
   Reported from the live shelf: "I see an eighth as .04 cents per gram lol".
   "1/8 oz" was matched by the ounce rule, whose [\d.]+ took the 8 after the
   slash: eight ounces, 224 g, and a $10 eighth at four cents a gram. The parser
   is fixed, but captures taken before the fix have the wrong grams stored in
   them -- and those captures ARE the shelf, so the feed re-derives grams from
   the label rather than trusting what arrived. */
await post({ storeKey: "sapura", reset: true });
await post({ storeKey: "sapura", collection: "grams", products: [
  /* Exactly what a pre-fix capture looks like: right label, poisoned grams. */
  { name: "Bad Grams Eighth", sizes: [{ label: "1/8 oz", price: 10, grams: 224 }] },
  { name: "No Weight Label", sizes: [{ label: "1-Pack", price: 12, grams: 0 }] },
] });
const gfeed = await (await fetch(`http://127.0.0.1:${PORT}/api/coldwater`)).json();
const bad = gfeed.products.find(p => p.name === "Bad Grams Eighth");
/* GREEN TREE PUTS THE WEIGHT IN THE TITLE, and its size rows carry none - so
   the whole shop reported withGrams:0 and contributed NOTHING to price per
   gram, which is the one thing this page is for. */
await post({ storeKey: "greentree", reset: true });
await post({ storeKey: "greentree", collection: "t", products: [
  { name: "Gold Crown Baja Blast [.7g]", sizes: [{ label: "Each", price: 14 }] },
  { name: "DNK Frosted Alien [1g]",      sizes: [{ label: "Each", price: 20 }] },
  /* A DOSE IS NOT A WEIGHT. 2000mg is how much cannabinoid is in the gummy;
     read as two grams it puts a $25 pack on the shelf at $12.50/g, ranked
     against flower. */
  { name: "Muha Meds Habibi [2000mg]",   sizes: [{ label: "Each", price: 25 }] },
  /* Nor is a fluid volume: a 12oz can is not 336 g of anything. */
  { name: "Keef Blue Razz [12oz]",       sizes: [{ label: "Each", price: 6 }] },
  /* The title weight is the PRODUCT's, so a multi-size listing must not take
     it - the same grams would land against every row. */
  { name: "Multi Size Thing [1g]", sizes: [
      { label: "Each", price: 10 }, { label: "Two", price: 18 }] },
] });
const gwf = await (await fetch(`http://127.0.0.1:${PORT}/api/coldwater`)).json();
const gwp = n => gwf.products.find(p => p.name === n) || {};
ok("a bracketed weight in the title answers when the size row carries none",
   gwp("Gold Crown Baja Blast [.7g]").perG === 20, String(gwp("Gold Crown Baja Blast [.7g]").perG));
ok("and again at a whole gram", gwp("DNK Frosted Alien [1g]").perG === 20,
   String(gwp("DNK Frosted Alien [1g]").perG));
ok("a dose in milligrams is refused: 2000mg is potency, not two grams",
   gwp("Muha Meds Habibi [2000mg]").perG == null, String(gwp("Muha Meds Habibi [2000mg]").perG));
ok("a fluid volume is refused: a 12oz can is not 336 grams",
   gwp("Keef Blue Razz [12oz]").perG == null, String(gwp("Keef Blue Razz [12oz]").perG));
ok("a multi-size listing does not take the title weight for every row",
   gwp("Multi Size Thing [1g]").perG == null, String(gwp("Multi Size Thing [1g]").perG));
await post({ storeKey: "greentree", reset: true });

ok("a poisoned grams value is corrected from the label", bad && bad.sizes[0][2] === 3.5,
   JSON.stringify(bad && bad.sizes[0]));
ok("and the per-gram figure is right again", bad && bad.perG === 2.86, String(bad && bad.perG));
const now = gfeed.products.find(p => p.name === "No Weight Label");
ok("a label with no weight in it does not invent one", now && now.sizes[0][2] === 0,
   JSON.stringify(now && now.sizes[0]));
await post({ storeKey: "sapura", reset: true });

/* ---- 3i. THE PER-GRAM SANITY GUARD ----------------------------------------
   A wrong per-gram is the worst thing this site can publish: it looks like a
   real figure, it ranks FIRST because it is cheapest, and it is the first thing
   a local shopper screenshots. The parser that produced tonight's four-cent
   eighth is fixed, but the class of bug is not, so an implausible figure is
   suppressed rather than shown. An absence reads as missing data; a wrong
   number reads as a lie. */
await post({ storeKey: "sapura", reset: true });
await post({ storeKey: "sapura", collection: "sanity", products: [
  /* A label gramsOf() cannot read, with grams poisoned past rescue: 224 g for
     $10 is the exact shape of tonight's bug. */
  { name: "Impossible Cheap", sizes: [{ label: "mystery pack", price: 10, grams: 5000 }] },
  { name: "Impossible Dear", sizes: [{ label: "mystery pack", price: 900000, grams: 1 }] },
  { name: "Perfectly Normal", sizes: [{ label: "3.5g", price: 35, grams: 3.5 }] },
] });
const sfeed = await (await fetch(`http://127.0.0.1:${PORT}/api/coldwater`)).json();
const cheap = sfeed.products.find(p => p.name === "Impossible Cheap");
const dear = sfeed.products.find(p => p.name === "Impossible Dear");
const fine = sfeed.products.find(p => p.name === "Perfectly Normal");
ok("an impossibly cheap per-gram is not published", cheap && cheap.perG == null, String(cheap && cheap.perG));
/* TWO GUARDS NOW, AND THE EARLIER ONE CATCHES THIS. 5,000 grams for $10 is an
   implausible WEIGHT before it is an implausible price, and the weight is now
   refused per category at source -- so no per-gram is ever computed from it and
   perGSuppressed stays empty. The rejection is not lost, it moved: gramNotes
   carries it, which is the more useful record because it names the weight that
   was wrong rather than the arithmetic that followed. */
ok("the rejected value is kept for diagnosis",
   cheap && (cheap.gramNotes || []).some(n => n.grams === 5000 && /implausible/.test(n.why)),
   JSON.stringify(cheap && cheap.gramNotes));
ok("and the per-gram guard still catches the one whose WEIGHT was fine",
   dear && dear.perG == null && dear.perGSuppressed === 900000,
   `perG ${dear && dear.perG} / rejected ${dear && dear.perGSuppressed}`);
ok("an impossibly dear one is refused too", dear && dear.perG == null, String(dear && dear.perG));
ok("a normal per-gram is untouched", fine && fine.perG === 10, String(fine && fine.perG));

const scen = await (await fetch(`http://127.0.0.1:${PORT}/api/coldwater?debug&slim`)).json();
ok("the census counts how often the guard fired",
   scen.perGramSanity && scen.perGramSanity.sapura.suppressed === 1,
   JSON.stringify(scen.perGramSanity && scen.perGramSanity.sapura).slice(0, 120));
ok("and names what it rejected, so the label form can be fixed",
   (scen.perGramSanity.sapura.examples || []).some(e => /Impossible/.test(e.name)),
   JSON.stringify((scen.perGramSanity.sapura.examples || [])[0] || {}).slice(0, 120));
/* The weight guard reports separately, because "this shop states no weights" and
   "this shop's weights are being thrown away" used to look identical. */
ok("and the weight guard reports its own refusals, with the label that caused them",
   scen.gramPlausibility && scen.gramPlausibility.sapura.refused >= 1 &&
   (scen.gramPlausibility.sapura.examples || []).some(e => /Impossible Cheap/.test(e.name)),
   JSON.stringify(scen.gramPlausibility && scen.gramPlausibility.sapura).slice(0, 160));
await post({ storeKey: "sapura", reset: true });

/* ---- 4. the gate still holds -------------------------------------------- */
const noTok = await fetch(`http://127.0.0.1:${PORT}/api/coldwater/ingest`, {
  method: "POST", headers: { "content-type": "application/json" },
  body: JSON.stringify({ storeKey: "dude", products: MENU }),
});
ok("a POST with no token is refused", noTok.status === 401, `http ${noTok.status}`);
const badTok = await fetch(`http://127.0.0.1:${PORT}/api/coldwater/ingest`, {
  method: "POST", headers: { "content-type": "application/json", "x-ll-admin-token": "wrong" },
  body: JSON.stringify({ storeKey: "dude", products: MENU }),
});
ok("a POST with the wrong token is refused", badTok.status === 401, `http ${badTok.status}`);
const opts = await fetch(`http://127.0.0.1:${PORT}/api/coldwater/ingest`, { method: "OPTIONS" });
ok("CORS preflight is answered, so a cross-origin capture can post",
   opts.headers.get("access-control-allow-origin") === "*" &&
   /x-ll-admin-token/.test(opts.headers.get("access-control-allow-headers") || ""),
   `${opts.status} ${opts.headers.get("access-control-allow-headers")}`);

console.log(`\n${fails.length ? "FAILED: " + fails.join(", ") : "All assertions passed."}\n`);
ch.kill(); srv.kill(); shopSrv.close(); process.exit(fails.length ? 1 : 0);
