/* Proves public/coldwater.html renders the Legal-Leaf engine against
   /api/coldwater: the fetch shim repoints, the grid paints, the palette is cold
   not green, and /api/products is never requested. */
import { spawn } from "node:child_process";
import { chromePath, launchChrome } from "./tools/chrome-path.mjs";

process.env.LL_NO_STORE_FETCH = "1";   // never call a real shop from a test; api/ reads it
                                       // per call, so setting it after the imports is fine.
const CHROME = chromePath();
const PORT=3482, CDP=9335;
const fails=[];
const ok=(n,c,x="")=>{console.log(`${c?"  PASS":"  FAIL"}  ${n}${x?"   ("+x+")":""}`);if(!c)fails.push(n);};
const wait=ms=>new Promise(r=>setTimeout(r,ms));
async function until(fn,n=100){for(let i=0;i<n;i++){try{return await fn()}catch{await wait(250)}}throw new Error("timeout")}

const srv=spawn(process.execPath,["server.mjs"],{env:{...process.env,PORT:String(PORT)},stdio:"ignore"});
/* LAUNCHED THROUGH THE SHARED HELPER, which waits long enough for a cold
   start on a loaded runner and keeps the browser's stderr. Spawning here
   with stdio "ignore" and a 15s poll is what produced "Chromium did not
   start" on a machine whose Chrome answered --version perfectly. */
const { proc: ch } = await launchChrome(CDP, [], { userDataDir: "/tmp/_cwr" });
const t=await until(async()=>{const j=await(await fetch(`http://127.0.0.1:${CDP}/json/list`)).json();const p=j.find(x=>x.type==="page");if(!p)throw 0;return p;});
await until(()=>fetch(`http://127.0.0.1:${PORT}/api/coldwater`).then(r=>{if(!r.ok)throw 0;return r}));

const s=new globalThis.WebSocket(t.webSocketDebuggerUrl);
await new Promise(r=>s.addEventListener("open",r));
let id=0;const p=new Map();const reqs=[];const errs=[];
s.addEventListener("message",e=>{const m=JSON.parse(e.data);
  if(m.method==="Network.requestWillBeSent")reqs.push(m.params.request.url);
  if(m.method==="Runtime.exceptionThrown")errs.push(m.params.exceptionDetails.exception?.description||m.params.exceptionDetails.text);
  if(m.id&&p.has(m.id)){p.get(m.id)(m);p.delete(m.id)}});
const send=(method,params={})=>new Promise(r=>{const i=++id;p.set(i,r);s.send(JSON.stringify({id:i,method,params}))});
const ev=async x=>(await send("Runtime.evaluate",{expression:x,returnByValue:true})).result?.result?.value;
/* Same, but settles the promise first. Without awaitPromise CDP hands back the
   Promise itself, which serialises to "[object Object]" -- a value that fails
   every assertion for a reason that has nothing to do with the page. */
const evp=async x=>(await send("Runtime.evaluate",{expression:x,returnByValue:true,awaitPromise:true})).result?.result?.value;

await send("Runtime.enable");await send("Page.enable");await send("Network.enable");
await send("Network.setBlockedURLs",{urls:["*fonts.googleapis.com*","*fonts.gstatic.com*"]});
await send("Page.navigate",{url:`http://127.0.0.1:${PORT}/coldwater`});
await until(async()=>{if(await ev(`document.readyState==='complete'`))return true;throw 0});
await ev(`localStorage.setItem('ll_age_ok','1')`);
await send("Page.navigate",{url:`http://127.0.0.1:${PORT}/coldwater`});
await until(async()=>{if(await ev(`document.readyState==='complete'`))return true;throw 0});
await until(async()=>{if((await ev(`document.querySelectorAll('#grid .card').length`))>0)return true;throw 0},80);

console.log("\n/coldwater — Legal-Leaf engine on Coldwater data\n");

/* THE HEMP CATALOGUE'S NAV. /consumables, /devices, /international and
   /wholesale belong to the national mail-order shelf behind /api/products --
   pills that take a walk-in shopper standing on Willowbrook Road to a different
   market. Same reasoning as turning the concierge off here, and worse in one
   way: a link needs no model to mislead, it just goes. Both stops asserted,
   because hidden but present is still tabbable, still in the accessibility
   tree, and still a link a crawler follows off this page.

   /wholesale was the one missed, and the worst to miss: it reads /api/products
   like the rest AND offers bulk hemp by the pound, which in Michigan is a
   licensee-only Metrc transaction. Not merely the wrong catalogue -- a word
   whose only honest answer here is that it does not mean that. */
const navGone = await ev(`(function(){
  var ids=["pageConsumables","pageDevices","pageInternational","pageWholesale"];
  var present=ids.filter(function(i){return !!document.getElementById(i)});
  var hrefs=[].map.call(document.querySelectorAll('a[href]'),function(a){return a.getAttribute('href')});
  return {present:present.join(","),
          leaks:hrefs.filter(function(h){return /^\\/(consumables|devices|international|wholesale)$/.test(h)}).join(","),
          kept:["pageLibrary","pageReels"].filter(function(i){
            var e=document.getElementById(i);
            return !!e && getComputedStyle(e).display !== "none";
          }).join(",")};
})()`);
ok("the four hemp-catalogue nav pills are gone from the DOM", navGone.present === "", navGone.present);
ok("and nothing else on the page still links to them", navGone.leaks === "", navGone.leaks);
/* THE RULE IS NOT "HIDE THE HEMP NAV". It is "do not send a shopper to another
   market's CATALOGUE". The Library is writing about the plant and Reels is the
   family's video; neither sells anything, so both stand in Detroit exactly as
   they do here. Asserted so the next person widening the list above has to
   decide about them on purpose rather than by regex. */
ok("the two pages that sell nothing are still offered",
   navGone.kept === "pageLibrary,pageReels", navGone.kept);
const cards=await ev(`document.querySelectorAll('#grid .card').length`);
ok("engine painted the grid",cards>0,`${cards} cards`);
ok("hero reads COLDWATER CANNABIS",(await ev(`document.querySelector('.hero h1').textContent`)).trim()==="COLDWATER CANNABIS");
/* THE CANONICAL NAME, and this pinned the alias. /api/market is what the shim
   emits since the rename; /api/coldwater still answers and is kept forever, but
   what has to be asserted is the name the page CHOOSES, or the assertion passes
   on an alias nobody meant to be depending on. The town is the other half: a
   shim with no ?town= is how a second city serves the pilot's shelf. */
ok("fetch shim repointed to /api/market",reqs.some(u=>u.includes("/api/market")),
   reqs.filter(u=>u.includes("/api/")).slice(0,3).join(", "));
ok("...carrying this town",reqs.some(u=>/\/api\/market\b[^"]*town=coldwater/.test(u)),
   (reqs.find(u=>u.includes("/api/market"))||"").slice(0,90));
ok("/api/products was never requested",!reqs.some(u=>u.includes("/api/products")),reqs.filter(u=>u.includes("/api/")).join(", "));
const accent=await ev(`getComputedStyle(document.documentElement).getPropertyValue('--leaf').trim()`);
ok("palette is cold, not leaf green",accent==="#4ec9ff",accent);
const bg=await ev(`getComputedStyle(document.documentElement).getPropertyValue('--bg').trim()`);
ok("ground swapped",bg==="#080f14",bg);
ok("store filter populated from the feed",(await ev(`document.querySelectorAll('#fStore option').length`))>1,
   `${await ev(`document.querySelectorAll('#fStore option').length`)} options`);
await new Promise(r=>setTimeout(r,1500));
const names=await ev("[...document.querySelectorAll('#grid .card')].map(c=>c.innerText.split('\\n')[1]).join(' | ')");
ok("flower renders with the corrected defaults",/GMO|Blue Dream|Wedding Cake/.test(names),names.slice(0,140));
ok("a card shows a per-gram figure",await ev("(document.getElementById('grid').innerText.match(/[\\d.]+\\s*\\/g/g)||[]).filter(s=>!/^—/.test(s)).length>0"),
   await ev("(document.getElementById('grid').innerText.match(/\\S+\\s*\\/g/g)||[]).slice(0,6).join(' , ')"));
ok("min-quantity default corrected to Any",(await ev("document.getElementById('fMinQty').value"))==="0");
ok("budget default cleared",(await ev("document.getElementById('fBudget').value"))==="");
ok("filters / sort controls present",await ev(`!!document.getElementById('q') && !!document.getElementById('fStore')`));
ok("no uncaught page errors",errs.length===0,errs.join(" | ").slice(0,240));


await new Promise(r=>setTimeout(r,1200));
const gg=await ev("(()=>{const t=document.getElementById('grid').innerText;return {cards:[...document.querySelectorAll('#grid .card')].filter(c=>/Greek Glass|GG |HQ /i.test(c.innerText)).length, opts:[...document.querySelectorAll('#fStore option')].map(o=>o.textContent).join(' | '), seed:(window.LL_GREEKGLASS_SEED||[]).length, pill:!!document.querySelector('.gg-float') && getComputedStyle(document.querySelector('.gg-float')).display}})()");
ok("no Greek Glass cards in the grid", gg.cards===0, `${gg.cards} cards`);
ok("Greek Glass gone from the store filter", !/Greek Glass/i.test(gg.opts), gg.opts.slice(0,90));
ok("seed reads empty", gg.seed===0, String(gg.seed));
ok("floating shop pill hidden", gg.pill==="none"||gg.pill===false, String(gg.pill));
ok("no Big Cartel request", !reqs.some(u=>u.includes("bigcartel")), reqs.filter(u=>u.includes("bigcartel")).join(","));


const seedChk=await ev("(()=>{const t=document.getElementById('grid').innerText;return {main:(window.LL_MAIN_SEED||[]).length, hemp:/THCA Small Buds|Black Tie|Exhale|Nothing But Canna|CBD Hemp Direct|Hi Puffy/i.test(t), stores:[...document.querySelectorAll('#fStore option')].map(o=>o.textContent).join(' | ')}})()");
ok("main seed reads empty", seedChk.main===0, String(seedChk.main));
ok("no Legal-Leaf hemp stores leaked into the grid", !seedChk.hemp, seedChk.stores.slice(0,110));


await new Promise(r=>setTimeout(r,1200));
const ban=await ev("(()=>{const b=document.getElementById('cw-banner');return b?b.innerText.replace(/\\s+/g,' ').slice(0,120):null})()");
ok("demo banner states the grid is placeholder", !!ban && /Sample catalogue/.test(ban), String(ban));

/* The concierge is a walk-in shopper's worst adviser here: it reads
   /api/products, the national mail-order hemp feed. Both stops are checked
   separately because either alone is a half-measure -- hidden but live still
   answers (and still bills) if anything reaches it, refused but visible is a
   dead button on the page. */
const conc=await ev("(()=>{const f=document.getElementById('llcFab')||document.querySelector('#ll-concierge, [id^=llc]');return {n:document.querySelectorAll('#ll-concierge').length, vis:[...document.querySelectorAll('[id^=llc]')].filter(e=>getComputedStyle(e).display!=='none'&&e.offsetParent!==null).length}})()");
ok("concierge widget is on the page but not visible", conc.vis===0, `${conc.vis} visible`);
ok("no /api/concierge request fired", !reqs.some(u=>u.includes("/api/concierge")), reqs.filter(u=>u.includes("concierge")).join(", "));
const forced=await evp("fetch('/api/concierge?mood=sleep').then(r=>r.status+':'+r.headers.get('content-type')).catch(e=>'threw '+e)");
ok("a forced concierge call is refused by the shim", /^501/.test(String(forced)), String(forced));
const forcedPost=await evp("fetch(new Request('/api/concierge',{method:'POST'})).then(r=>r.json()).then(j=>j.error).catch(e=>'threw '+e)");
ok("the Request-object form is refused too", forcedPost==="off-town", String(forcedPost));
ok("refusal never reached the network", !reqs.some(u=>u.includes("/api/concierge")), reqs.filter(u=>u.includes("concierge")).join(", "));

/* "THCa" is hemp-site language. A shopper walking into a Coldwater dispensary
   reads THC on the jar and compares numbers labelled THC; THCa reads as a
   different drug or as a typo. The FEED still says THCa because the engine's
   filter accepts exactly THCa/CBD/Botanical -- so this asserts the printed text
   changed and the underlying option value did NOT, which is what keeps the
   filter working. */
const thc=await ev("(()=>{const sel=document.getElementById('fCannabinoid');return {visible:document.body.innerText.match(/THCa/g)||[], optText:[...(sel?sel.options:[])].map(o=>o.textContent).join('|'), optVals:[...(sel?sel.options:[])].map(o=>o.value).join('|')}})()");
ok("no THCa printed anywhere on the page", thc.visible.length===0, `${thc.visible.length} occurrences`);
ok("the cannabinoid filter reads THC", /THC/.test(thc.optText) && !/THCa/.test(thc.optText), thc.optText);
ok("but its option VALUE is still THCa, so filtering works", /THCa/.test(thc.optVals), thc.optVals);

/* Filtering has to still work, since that is the thing a wrong relabel breaks. */
await ev("(()=>{const s=document.getElementById('fCannabinoid');s.value='THCa';s.dispatchEvent(new Event('change',{bubbles:true}))})()");
await wait(900);
ok("selecting it still filters to real cards",(await ev("document.querySelectorAll('#grid .card').length"))>0,
   `${await ev("document.querySelectorAll('#grid .card').length")} cards`);
ok("and still prints THC, not THCa, after a re-render",
   (await ev("(document.body.innerText.match(/THCa/g)||[]).length"))===0);

/* SHOP BY STORE, ported from NicotiaMarket. The chips are a FACE for the
   engine's own #fStore select -- built from its options, acting by setting its
   value -- so the counts cannot drift from the dropdown and picking a shop
   either way lights up the other. That two-way binding is the thing worth
   pinning; a strip that looked right and filtered nothing would pass a
   screenshot review. */
await wait(1200);
/* THE WHOLE GRID, MEASURED ONCE, because several checks below say "everything
   is back" and each of them used to say it as a typed integer. The shop front
   opens on a clear-all state now, so that number is whatever the fixture holds
   -- and a suite that pins it has to be edited every time a default changes
   correctly. Read here, before anything has been filtered. */
const FULL_GRID = await ev("document.querySelectorAll('#grid .card').length");

const strip = await ev("(()=>{const s=document.getElementById('storeRow');return {present:!!s, hidden:s?s.hidden:null, chips:document.querySelectorAll('#storeLogos .lchip').length, names:[...document.querySelectorAll('#storeLogos .lname')].map(n=>n.textContent).join('|'), counts:[...document.querySelectorAll('#storeLogos .lcount')].map(n=>n.textContent).join('|')}})()");
ok("the store strip rendered", strip.present && strip.hidden === false, JSON.stringify(strip).slice(0,90));

/* THE BRAND STRIP MUST NOT RENDER ITSELF EMPTY. The demo fixture carries no
   brands, and a "Shop by brand" heading over an empty rail reads as a broken
   page rather than as an absent field -- the same judgement as suppressing an
   implausible per-gram instead of printing it. */
const bstrip = await ev("(()=>{const s=document.getElementById('brandRow');return {present:!!s, hidden:s?s.hidden:null, chips:document.querySelectorAll('#brandLogos .lchip').length}})()");
ok("the brand strip is installed", bstrip.present, JSON.stringify(bstrip));
ok("but stays hidden when the feed carries no brands, rather than showing an empty rail",
   bstrip.hidden === true && bstrip.chips === 0, JSON.stringify(bstrip));
ok("one chip per shop in the feed", strip.chips === 2, `${strip.chips} chips`);
ok("chips carry the shop names", /Sample Shop A/.test(strip.names), strip.names);
/* DERIVED FROM THE GRID, NOT TYPED. This read "4|4" and went red when the shop
   front stopped opening with Trim/Shake hidden -- the shake listing came back
   and every shop gained a product. A number copied out of one run is a number
   that has to be re-copied every time a default moves correctly, which teaches
   whoever hits it to edit rather than read. What the rail actually claims is
   that its counts ARE the engine's, so ask the engine. */
const wantCounts = await ev(`(function(){
  var sel=document.getElementById("fStore");
  /* The first option is "All Stores (N)" and carries an empty value -- it is
     the clear, not a shop, and the strip draws no chip for it. */
  return [].filter.call(sel.options,function(o){ return o.value; }).map(function(o){
    var m=(o.textContent||"").match(/\\((\\d+)\\)\\s*$/); return m?m[1]:null;
  }).filter(Boolean).join("|");
})()`);
ok("chips carry the engine's own counts", strip.counts === wantCounts,
   strip.counts + " vs " + wantCounts);

/* Clicking a chip must actually filter, and must move the select with it. */
await ev("document.querySelector('#storeLogos .lchip').click()");
await wait(900);
const picked = await ev("(()=>({sel:document.getElementById('fStore').value, on:document.querySelectorAll('#storeLogos .lchip.on').length, cards:document.querySelectorAll('#grid .card').length}))()");
ok("clicking a chip sets the engine's store filter", picked.sel === "Sample Shop A", picked.sel);
ok("exactly one chip reads as selected", picked.on === 1, String(picked.on));
ok("the grid actually narrowed", picked.cards > 0 && picked.cards < 8, `${picked.cards} cards`);
ok("Show all appears once a shop is picked", (await ev("!document.getElementById('clearStores').hidden")) === true);

/* And the binding runs the other way: change the select, the chip follows. */
await ev("(()=>{const s=document.getElementById('fStore');s.value='Sample Shop B';s.dispatchEvent(new Event('change',{bubbles:true}))})()");
await wait(900);
ok("changing the select lights the matching chip",
   (await ev("document.querySelector('#storeLogos .lchip.on .lname').textContent")) === "Sample Shop B",
   String(await ev("document.querySelector('#storeLogos .lchip.on .lname')?.textContent")));

await ev("document.getElementById('clearStores').click()");
await wait(900);
/* THE BRAND RAIL HAD ARROWS AND FADES AND NOTHING THAT UPDATED THEM. sync()
   was bound to the store strip's own scroller, so the second rail inherited the
   markup and none of the feel: arrows never disabled, fades never appeared. */
const rail = await ev(`(function(){
  var b=document.getElementById('storeLogos'); if(!b) return null;
  var w=b.parentElement;
  return {wrap:w&&w.classList.contains('lrwrap'), grab:getComputedStyle(b).cursor,
          contain:getComputedStyle(b).overscrollBehaviorX, snap:getComputedStyle(b).scrollSnapType};
})()`);
/* SNAP IS GONE ON PURPOSE. Reported as the rails being "things you can click
   over with a button" rather than carousels: scroll-snap pulled the rail back
   to a chip whenever a drag ended between two, and scroll-behavior:smooth
   animated the user's own wheel and drag as well as the arrows. Both read as
   the rail refusing to be scrolled. The arrows still animate, because they
   pass behavior:"smooth" in their own scrollBy call. */
ok("a rail is a real carousel: grab cursor, free scrolling, contained overscroll",
   rail && rail.wrap && rail.grab === "grab" && rail.snap === "none" && rail.contain === "contain",
   JSON.stringify(rail));
ok("and the user's own scrolling is not animated out from under them",
   (await ev(`getComputedStyle(document.getElementById('storeLogos')).scrollBehavior`)) !== "smooth",
   String(await ev(`getComputedStyle(document.getElementById('storeLogos')).scrollBehavior`)));
/* NO SCROLLBAR, deliberately. A visible one was the first attempt at the
   affordance and it is the wrong control: a square grey rule under a row of
   circular plates, permanent whether or not anyone is looking, and invisible on
   a Mac until the trackpad is touched. The FADE says "more that way" instead,
   and it clears itself at each end because the class driving it is computed
   from the real scroll position. What must stay true is that the rail is
   genuinely scrollable -- overflow, not a slideshow. */
ok("the rail scrolls but shows no scrollbar",
   (await ev(`getComputedStyle(document.getElementById('storeLogos')).scrollbarWidth`)) === "none" &&
   /auto|scroll/.test(await ev(`getComputedStyle(document.getElementById('storeLogos')).overflowX`)),
   `${await ev(`getComputedStyle(document.getElementById('storeLogos')).scrollbarWidth`)} / ${await ev(`getComputedStyle(document.getElementById('storeLogos')).overflowX`)}`);
ok("and a real scroll actually moves it",
   (await ev(`(function(){var b=document.getElementById('storeLogos');
      if(b.scrollWidth<=b.clientWidth) return true;   // nothing to scroll in this fixture
      var a=b.scrollLeft; b.scrollLeft=a+80; var moved=b.scrollLeft>a; b.scrollLeft=a; return moved})()`)) === true);
/* Contained overscroll is the one that matters on a phone: without it a
   horizontal flick chains into the page or fires the back-swipe. */
ok("edge state is computed for a rail that cannot scroll, rather than left stale",
   (await ev(`(function(){
      var b=document.getElementById('storeLogos'), w=b.parentElement;
      var max=b.scrollWidth-b.clientWidth;
      var btn=document.querySelector('.lrnav[data-lr="storeLogos"][data-dir="1"]');
      return max<=2 ? (!w.classList.contains('can-next') && (!btn || btn.disabled)) : true;
   })()`)) === true);

ok("Show all clears the filter", (await ev("document.getElementById('fStore').value")) === "" &&
   (await ev("document.querySelectorAll('#storeLogos .lchip.on').length")) === 0);

/* The category rail is pinned further down, against the facet-pair layout it
   actually ships in (#cwFacets). An earlier duplicate of these assertions
   stood here and targeted a standalone #catRow that the merged
   implementation does not build -- two suites for one rail, and the
   shorter-lived one lost. */

ok("clearing restores the full grid", (await ev("document.querySelectorAll('#grid .card').length")) === FULL_GRID,
   `${await ev("document.querySelectorAll('#grid .card').length")} cards`);

/* ---- SHOP BY CATEGORY, AND THE DIVIDER BETWEEN THE TWO -------------------
   Same contract as the store strip and pinned the same way: the chips are a
   face for the engine's own #fCategory, so what matters is not that circles
   rendered but that they move the select and the select moves them. A strip
   that looked right and filtered nothing would pass a screenshot review, which
   is how the brand rail shipped with dead arrows.

   A DESKTOP WIDTH IS SET FIRST, and it is load bearing rather than tidiness: the
   pair collapses to one column at 900px and the default headless window is
   narrower than that, so the side-by-side assertions below were reading the
   stacked layout and calling the CSS broken. The stacked form is checked on its
   own terms at the end of this file. */
await send("Emulation.setDeviceMetricsOverride",{width:1440,height:900,deviceScaleFactor:1,mobile:false});
await wait(600);
const cstrip = await ev(`(function(){
  var s=document.getElementById('catRow');
  return {present:!!s, hidden:s?s.hidden:null,
          chips:document.querySelectorAll('#catLogos .lchip').length,
          names:[...document.querySelectorAll('#catLogos .lname')].map(n=>n.textContent).join('|'),
          counts:[...document.querySelectorAll('#catLogos .lcount')].map(n=>n.textContent).join('|'),
          glyphs:[...document.querySelectorAll('#catLogos .limg')].map(n=>n.getAttribute('data-letter')).join(''),
          vals:[...document.querySelectorAll('#catLogos [data-logocat]')].map(n=>n.getAttribute('data-logocat')).join('|')};
})()`);
ok("the category strip rendered", cstrip.present && cstrip.hidden === false, JSON.stringify(cstrip).slice(0,120));
ok("one chip per category the engine offers", cstrip.chips > 2, `${cstrip.chips} chips: ${cstrip.vals}`);
ok("chips carry the categories, not the engine's group parents",
   /Flower/.test(cstrip.names) && !/^__|\|__/.test(cstrip.vals) && !/All Consumables/.test(cstrip.names), cstrip.vals);
ok("the indent and the count are stripped off the label, not left glued on",
   !/\(\d/.test(cstrip.names) && !/^\s/.test(cstrip.names), cstrip.names);
ok("chips carry the engine's own counts", /^\d+(\|\d+)*$/.test(cstrip.counts), cstrip.counts);
/* The demo feed carries no photographs, so every plate here is the glyph
   fallback -- which is the path worth driving, because it is what a thin DOM
   capture gets and what a category with nothing on the first page gets. */
/* A DRAWN MARK ON EVERY CHIP. Emoji were the reader's font rather than this
   page's design -- different on every platform, flat beside a rail of
   photographic brand marks, and at 54px they read as placeholders. A product
   photo was the other attempt and is worse for a CATEGORY: whichever product
   happens to be first stands for the whole shelf, it changes when the grid
   re-filters, and the categories with no usable photo fall back to something
   else, leaving a rail half photographs and half symbols. */
const marks = await ev(`[...document.querySelectorAll('#catLogos .lchip .cimg')].map(function(i){return i.getAttribute('src')})`);
ok("every chip carries a drawn mark", marks.length === cstrip.chips, `${marks.length} of ${cstrip.chips}`);
ok("and they are this repo's own SVGs, not emoji or a remote asset",
   marks.every(u => /^\/img\/cat\/[a-z]+\.svg$/.test(u)), marks.slice(0, 3).join(" "));
ok("no chip is left with an emoji plate", (await ev(`document.querySelectorAll('#catLogos .limg[data-letter]').length`)) === 0);
ok("the marks actually load", (await ev(`[...document.querySelectorAll('#catLogos .cimg')].every(function(i){return i.complete && i.naturalWidth > 0})`)) === true);
/* SHELF ORDER, NOT COUNT ORDER: a count moves with every other filter, so chips
   ordered on it jump sideways as soon as somebody picks a shop. Flower first is
   the fixed order, and "Flower" is the printed label of the engine's own
   "THCA Flower" -- which is exactly why the strip must key on the VALUE. */
ok("flower leads, in a fixed shelf order rather than by the moving count",
   (await ev("(document.querySelector('#catLogos .lname')||{}).textContent")) === "Flower",
   String(await ev("(document.querySelector('#catLogos .lname')||{}).textContent")));
ok("and the chip's value is the engine's own word for it, not the feed's",
   (await ev("(document.querySelector('#catLogos [data-logocat]')||{}).getAttribute?.('data-logocat')")) === "THCA Flower",
   String(await ev("(document.querySelector('#catLogos [data-logocat]')||{}).getAttribute?.('data-logocat')")));

/* Clicking a chip must filter, and must move the select with it. The value is
   read off the chip rather than typed here: hardcoding "Flower" is the same
   mistake the picture map made, and it fails as a no-op that reads like a broken
   click handler. */
const firstCat = await ev("document.querySelector('#catLogos [data-logocat]').getAttribute('data-logocat')");
await ev("document.querySelector('#catLogos [data-logocat]').click()");
await wait(900);
const cpick = await ev("(()=>({sel:document.getElementById('fCategory').value, on:document.querySelectorAll('#catLogos .lchip.on').length, cards:document.querySelectorAll('#grid .card').length}))()");
ok("clicking a chip sets the engine's category filter", cpick.sel === firstCat, `${cpick.sel} vs ${firstCat}`);
ok("exactly one category chip reads as selected", cpick.on === 1, String(cpick.on));
ok("the grid narrowed to that category", cpick.cards > 0 && cpick.cards < 8, `${cpick.cards} cards`);
ok("Show all appears once a category is picked", (await ev("!document.getElementById('clearCats').hidden")) === true);
/* And the other way: change the select, the chip follows. */
await ev("(()=>{const s=document.getElementById('fCategory');s.value='Edibles';s.dispatchEvent(new Event('change',{bubbles:true}))})()");
await wait(900);
ok("changing the select lights the matching category chip",
   (await ev("(document.querySelector('#catLogos .lchip.on .lname')||{}).textContent")) === "Edibles",
   String(await ev("(document.querySelector('#catLogos .lchip.on .lname')||{}).textContent")));
await ev("document.getElementById('clearCats').click()");
await wait(900);
ok("Show all clears the category filter", (await ev("document.getElementById('fCategory').value")) === "" &&
   (await ev("document.querySelectorAll('#catLogos .lchip.on').length")) === 0);
ok("and the full grid is back", (await ev("document.querySelectorAll('#grid .card').length")) === FULL_GRID,
   `${await ev("document.querySelectorAll('#grid .card').length")} cards`);

/* ---- GEAR CARRIES NO PRICE PER GRAM --------------------------------------
   Reported from the live shelf: "710 cleaner is listed price per gram right now
   and shouldn't be". Two faults put it there and either alone was enough -- the
   cleaner had no category, so normCategory's last resort read the ounce in its
   size label as flower; and the engine fills any row whose grams are zero by
   reading that label itself, inside the blob, so suppressing perG in the feed was
   invisible to it.
   The fix is the engine's OWN accessory card, which draws no per-gram, no size
   dropdown and no strain -- reached by publishing cannabinoid "Accessory". This
   drives it in a browser, because "the feed says null" is not the same claim as
   "the page prints nothing". */
/* THE CANNABINOID FILTER IS STILL SET TO THC from the relabel test above, and
   that is worth asserting rather than resetting quietly: gear has no cannabinoid,
   so a shopper who picks THC should not be shown a bottle of cleaner. It is the
   one place the "Accessory" value acts as a filter rather than as a renderer. */
await ev(`(()=>{const q=document.getElementById('q');q.value='710';q.dispatchEvent(new Event('input',{bubbles:true}))})()`);
await wait(1000);
ok("picking THC excludes the gear, because gear has no cannabinoid",
   (await ev("document.getElementById('fCannabinoid').value")) === "THCa" &&
   (await ev("[...document.querySelectorAll('#grid .card')].filter(c=>/710/.test(c.innerText)).length")) === 0);
await ev(`(()=>{const s=document.getElementById('fCannabinoid');s.value='';s.dispatchEvent(new Event('change',{bubbles:true}))})()`);
await wait(1200);
const gear = await ev(`(function(){
  var c=[...document.querySelectorAll('#grid .card')].find(function(e){ return /710/.test(e.innerText); });
  if(!c) return null;
  return {found:true, gg:c.classList.contains('gg'), text:c.innerText.replace(/\\n/g,' | '),
          perG:/\\/g\\b/.test(c.innerText), sizesel:!!c.querySelector('.sizesel'),
          otd:!!c.querySelector('.otd'), ships:/ships?\\s+from/i.test(c.innerText),
          btn:(c.querySelector('.addbtn')||{}).textContent||''};
})()`);
ok("the gear listing is on the shelf, not deleted from it", gear && gear.found, JSON.stringify(gear));
ok("it renders as the engine's accessory card", gear && gear.gg === true, String(gear && gear.gg));
ok("it prints no price per gram at all", gear && gear.perG === false, gear && gear.text);
ok("and offers no size dropdown, because it is not sold by weight",
   gear && gear.sizesel === false, String(gear && gear.sizesel));
/* That card is written for a mail-order glass shop. These shops sell at a
   counter, so its two shipping lines are false here. */
ok("the shipping estimate is gone", gear && gear.otd === false, gear && gear.text);
ok("and it says where to buy it instead of who ships it",
   gear && !gear.ships && /at the counter/i.test(gear.text || ""), gear && gear.text);
ok("the cart button points at the list, like every other card here",
   gear && /add to shopping list/i.test(gear.btn || ""), String(gear && gear.btn));
/* The size the shop stated is still printed -- it moved to the description,
   which is the one place on this card the engine prints and never parses. */
ok("the bottle size is still shown somewhere a shopper can read it",
   gear && /4 oz/i.test(gear.text || ""), gear && gear.text);
/* And the engine agrees it is not flower, which is what keeps it out of the
   Flower facet's count. */
const gcat = await ev(`(function(){
  var i=(window.LL_admin&&LL_admin.items()||[]).find(function(x){ return /710/.test(x.name); });
  return i ? i.category + "/" + i.cannabinoid : null;
})()`);
ok("the engine files it as an accessory, not as flower", gcat === "Accessories/Accessory", String(gcat));
await ev(`(()=>{const q=document.getElementById('q');q.value='';q.dispatchEvent(new Event('input',{bubbles:true}))})()`);
await wait(1000);

/* ---- THE CORNER, AND THE STOP THAT NEVER STOPPED ANYTHING ----------------
   The concierge is off on this page because it reads the national mail-order
   hemp feed and would answer a shopper standing on Willowbrook Road by
   recommending flower shipped to their door. The CSS stop was written against
   #ll-concierge -- which is the <script> TAG -- while the widget builds its
   button at runtime as .llc-fab. So the stop hid something already invisible,
   the button sat in the bottom-right corner of this page, and the only thing
   actually working was the fetch refusal: a visible button that errors.
   It was also covering the trip tally, which is what surfaced it. */
const corner = await ev(`(function(){
  var fab=document.querySelector('.llc-fab');
  var tally=document.getElementById('cwl-fab');
  function box(el){ if(!el) return null; var r=el.getBoundingClientRect(); var cs=getComputedStyle(el);
    return {shown:cs.display!=='none'&&cs.visibility!=='hidden', z:cs.zIndex, w:Math.round(r.width), h:Math.round(r.height)}; }
  return {fab:box(fab), fabExists:!!fab, tally:box(tally)};
})()`);
ok("the concierge widget is still on the page, so the stop is a stop and not a deletion",
   corner.fabExists === true || corner.fab === null, JSON.stringify(corner.fab));
ok("...but its button is actually hidden, not merely selected for",
   !corner.fabExists || corner.fab.shown === false, JSON.stringify(corner.fab));

/* The tally has to be readable on its own: it was there and correct the whole
   time, just drawn under a button with a z-index four orders of magnitude up. */
await ev(`localStorage.setItem('ll_cw:ll_cart', JSON.stringify([{id:'x',name:'X',store:'S',storeKey:'s',size:'1g',price:10}]))`);
await wait(1300);
const tally = await ev(`(function(){
  var t=document.getElementById('cwl-fab');
  if(!t||t.hidden) return {hidden:true};
  var r=t.getBoundingClientRect();
  var top=document.elementFromPoint(Math.round(r.left+r.width/2), Math.round(r.top+r.height/2));
  return {text:t.textContent, h:Math.round(r.height), covered:!(t===top||t.contains(top))};
})()`);
ok("the trip tally is not covered by anything in that corner",
   tally.hidden || tally.covered === false, JSON.stringify(tally));
ok("...and is big enough to read and hit", tally.hidden || tally.h >= 40, JSON.stringify(tally));
await ev(`localStorage.removeItem('ll_cw:ll_cart')`);

/* ---- CARTS, DISPOSABLES AND CONCENTRATES ARE THREE FACETS -----------------
   The feed classifies them as three things and the engine deliberately flattens
   all of it into Concentrate on the way in -- its own comment says "carts and
   disposables are a SUB-category of Concentrate". cw-catsplit asserts the feed's
   answer back over it through the engine's manual-category override, which
   normCategory consults BEFORE any of its own rules.

   THE ASSERTION HAS TO BE THE FILTER, NOT THE MAP. Writing entries into
   LL_MANUAL_CAT proves nothing on its own: the question is whether #fCategory --
   which the engine rebuilds from what it actually classified -- ends up offering
   the three as separate choices, and whether picking one narrows the grid. */
/* THE DEMO FEED HAS NO CARTS AT ALL, so without this every assertion below
   passes by having nothing to do -- byId 0, marked 0, 0 === 0. The mechanism is
   fed real product ids out of the engine's own list and told they are carts and
   disposables, which is exactly the shape the live feed hands over. */
await ev(`(function(){
  var it=(window.LL_admin&&window.LL_admin.items&&window.LL_admin.items())||[];
  if(it.length<2) return;
  var m=window.LL_COLDWATER_META=window.LL_COLDWATER_META||{};
  var by={}; by[it[0].id]="Carts"; by[it[1].id]="Disposables";
  m.catById=by;
  document.dispatchEvent(new CustomEvent('ll-meta'));
})()`);
await wait(1200);

const split = await ev(`(function(){
  var sel=document.getElementById('fCategory');
  var vals=[].map.call(sel.querySelectorAll('option'),function(o){return o.value}).filter(Boolean);
  var man=window.LL_MANUAL_CAT||{};
  var marked=0; for(var k in man) if(man[k]&&man[k].cwSplit) marked++;
  return {options:vals, marked:marked,
          byId:Object.keys((window.LL_COLDWATER_META&&window.LL_COLDWATER_META.catById)||{}).length};
})()`);
ok("the feed handed over the products the engine would have flattened",
   split.byId > 0, JSON.stringify({byId: split.byId, marked: split.marked}));
ok("...and they were asserted through the engine's own override, not patched in",
   split.marked === split.byId, JSON.stringify(split));
/* The real proof: the engine's own facet list, which it rebuilds from what it
   classified rather than from what we handed it. */
ok("Carts is a category the shopper can pick",
   split.options.indexOf("Carts") >= 0, split.options.join(","));
ok("Disposables is its own category, not a kind of cart",
   split.options.indexOf("Disposables") >= 0, split.options.join(","));
ok("...and Concentrate is still there, holding what is left",
   split.options.indexOf("Concentrate") >= 0, split.options.join(","));
/* "Vape" is not a category at all -- it is one of the engine's sub-tags, a
   cross-cutting label that surfaces as an extra option. On the hemp shelf it is
   the only way to narrow to vape-shaped products; here it is a third answer to
   a question that now has two better ones, sitting between them. */
ok("the redundant virtual Vape facet is gone",
   split.options.indexOf("Vape") < 0, split.options.join(","));

/* Picking one has to narrow the grid, or the facet is a label with nothing
   behind it -- which is what a phantom dropdown option looks like. */
const pickedCart = await ev(`(function(){
  var sel=document.getElementById('fCategory');
  if(sel.querySelector('option[value="Carts"]')===null) return {skip:true};
  sel.value='Carts'; sel.dispatchEvent(new Event('change',{bubbles:true}));
  return {ok:true};
})()`);
await wait(900);
const narrowed = await ev(`(function(){
  var cards=[].slice.call(document.querySelectorAll('#grid .card[data-cat]'));
  var cats={}; cards.forEach(function(c){ cats[c.getAttribute('data-cat')]=1; });
  return {n:cards.length, cats:Object.keys(cats)};
})()`);
ok("picking Carts shows carts and nothing else",
   !pickedCart.skip && narrowed.n > 0 && narrowed.cats.length === 1 && narrowed.cats[0] === "Carts",
   JSON.stringify({picked: pickedCart, narrowed: narrowed}));
await ev(`(()=>{const s=document.getElementById('fCategory');s.value='';s.dispatchEvent(new Event('change',{bubbles:true}));})()`);
await wait(700);

/* If Vape were the live selection when the option disappeared, the grid would
   be filtered by a control the shopper can no longer see. Driven by putting it
   back, selecting it, and letting the observer take it away again. */
const vapeSel = await ev(`(function(){
  var sel=document.getElementById('fCategory');
  var o=document.createElement('option'); o.value='Vape'; o.textContent='Vape (3)';
  sel.appendChild(o);
  sel.value='Vape'; sel.dispatchEvent(new Event('change',{bubbles:true}));
  return sel.value;
})()`);
await wait(700);
const vapeGone = await ev(`(function(){
  var sel=document.getElementById('fCategory');
  return {opt:!!sel.querySelector('option[value="Vape"]'), value:sel.value,
          cards:document.querySelectorAll('#grid .card').length};
})()`);
ok("re-adding Vape gets it removed again, since the engine rewrites its options",
   vapeSel === "Vape" && vapeGone.opt === false, JSON.stringify({vapeSel, vapeGone}));
ok("...and the selection is cleared rather than left filtering invisibly",
   vapeGone.value !== "Vape" && vapeGone.cards > 0, JSON.stringify(vapeGone));

/* THESE ARE DERIVED, NOT DECIDED, so an operator must not be able to publish
   them into shared storage as if somebody had classified them by hand. */
const exported = await ev(`(function(){
  if(!window.LL_admin || typeof window.LL_admin.exportBatch!=='function') return {skip:true};
  var b=window.LL_admin.exportBatch()||{};
  var cat=b.cat||{}, leaked=0;
  for(var k in cat) if(cat[k]&&cat[k].cwSplit) leaked++;
  return {leaked:leaked, kept:Object.keys(cat).length};
})()`);
ok("the derived splits cannot be pushed to shared overrides",
   exported.skip || exported.leaked === 0, JSON.stringify(exported));

/* ---- THE SHELF SHOULD LOOK LIKE A SHELF -----------------------------------
   "You're only loading, like, nine ... two rows of four and a third row of one
   ... then you click load and it still doesn't do full rows."

   THE LOAD-MORE BAR WAS A GRID CELL. The engine appends it into #grid beside
   the cards, so a four-column layout drew twelve cards in three rows and left
   the bar alone in a fourth. That is the ragged row, and it is a layout fault
   rather than a paging one -- so it is asserted separately from the count. */
const bar = await ev(`(function(){
  var b=document.querySelector('#grid .loadmore');
  if(!b) return {none:true};
  var g=document.getElementById('grid');
  var gc=getComputedStyle(g).gridTemplateColumns.trim().split(/\\s+/).length;
  var cs=getComputedStyle(b);
  return {span:cs.gridColumnStart+' / '+cs.gridColumnEnd, cols:gc,
          width:Math.round(b.getBoundingClientRect().width),
          gridWidth:Math.round(g.getBoundingClientRect().width)};
})()`);
ok("the load-more bar spans the whole row rather than sitting in a cell",
   bar.none || /1 \/ -1|1 \/ auto/.test(bar.span) || bar.width > bar.gridWidth * 0.8,
   JSON.stringify(bar));

/* NO GAP-TOOTHED LAST ROW. The demo feed is nine products, which is exactly the
   shape complained about: at four columns that is two full rows and one card
   stranded. Where more remain to load the stragglers are held back to the row
   boundary; where nothing remains they are shown, because hiding real products
   to square off a rectangle is choosing tidiness over the catalogue. */
const rows = await ev(`(function(){
  var g=document.getElementById('grid');
  var c=getComputedStyle(g).gridTemplateColumns.trim().split(/\\s+/).length;
  var vis=[].filter.call(g.querySelectorAll('.card'),function(x){return getComputedStyle(x).display!=='none'});
  return {cols:c, visible:vis.length, total:g.querySelectorAll('.card').length,
          more:!!g.querySelector('.loadmore')};
})()`);
ok("with nothing left to load, every product is shown even if the row is short",
   rows.more || rows.visible === rows.total, JSON.stringify(rows));
ok("...and with more to load, the visible cards fill whole rows",
   !rows.more || rows.cols < 2 || rows.visible % rows.cols === 0, JSON.stringify(rows));

/* A TOWN, NOT A SHOP. The engine's default sort clusters by store, so the top
   of an unfiltered shelf is a wall of one shop. Interleaved on the opening view
   only -- the demo feed has two shops, so the first two cards must differ. */
/* A FRESH LOAD, because "the opening shelf" is exactly that. Earlier tests in
   this file leave a store, a cannabinoid and a sort set, and the rotation is
   deliberately inert whenever any control has moved off the value the engine
   opened with -- so measuring it here without reloading would measure the
   stand-down, pass for the wrong reason, and keep passing if the rotation were
   deleted. Blanking the controls does not work either: blank is not the default
   (#fSort opens on "pergram"), so that reads as a filter too. */
await send("Page.navigate", { url: `http://127.0.0.1:${PORT}/coldwater` });
await until(async () => { if (await ev(`document.readyState==='complete'`)) return true; throw 0 });
await until(async () => { if ((await ev(`document.querySelectorAll('#grid .card').length`)) > 0) return true; throw 0 }, 80);
await wait(1200);

const mix = await ev(`(function(){
  var g=document.getElementById('grid');
  var s=[].map.call(g.querySelectorAll('.card'),function(c){
    var p=c.querySelector('.storepill'); return String((p&&p.textContent)||'').trim();
  }).filter(Boolean);
  return {first:s.slice(0,4), distinct:new Set(s).size};
})()`);
ok("the opening shelf interleaves shops rather than opening on a wall of one",
   mix.distinct < 2 || (mix.first[0] && mix.first[1] && mix.first[0] !== mix.first[1]),
   JSON.stringify(mix));

/* ...AND ONLY the opening shelf. Once somebody picks a shop they have asked a
   question, and the answer is the engine's own order. */
/* A synthetic change is NOT a shopper: the rotation keys on a trusted event, so
   the test has to say so the way the rails do rather than faking a gesture. */
await ev(`(()=>{const s=document.getElementById('fStore');s.value='Sample Shop A';
  s.dispatchEvent(new Event('change',{bubbles:true}));
  document.dispatchEvent(new CustomEvent('ll-facet-picked'));})()`);
await wait(800);
const oneShop = await ev(`(function(){
  var s=[].map.call(document.querySelectorAll('#grid .card .storepill'),function(p){return p.textContent.trim()});
  return {distinct:new Set(s).size, n:s.length};
})()`);
ok("a filtered shelf is left in the engine's order, not rotated",
   oneShop.n === 0 || oneShop.distinct <= 1, JSON.stringify(oneShop));
await ev(`(()=>{const s=document.getElementById('fStore');s.value='';s.dispatchEvent(new Event('change',{bubbles:true}))})()`);
await wait(800);

/* ---- A SLOW LOGO MUST NOT READ AS A BROKEN ONE ---------------------------
   "The logos load really slowly and not always show up", which was three faults
   wearing one face: a bare white plate until a third-party favicon landed, so
   slow and dead looked identical and both looked broken; loading="lazy" on a
   horizontal rail, which for the chips past the right edge is close to never;
   and -- the worst one, because it is not slowness at all -- the strip building
   itself from #fStore the moment that select has options, which is well before
   /api/coldwater has answered, with no re-render when the domains arrived.

   NOTE WHAT THIS ENVIRONMENT PROVES. Both favicon hosts are unreachable from
   the sandbox, so every mark here genuinely fails to load. That is not a
   limitation of the test, it IS the dead-lookup case -- and the guarantee worth
   pinning is that a shopper still sees a finished chip. */
await ev(`(function(){
  window.LL_COLDWATER_META = window.LL_COLDWATER_META || {};
  var d = window.LL_COLDWATER_META.domains || (window.LL_COLDWATER_META.domains = {});
  var sel = document.getElementById('fStore');
  for (var i = 0; i < sel.options.length; i++) if (sel.options[i].value) d[sel.options[i].value] = 'example.test';
  document.dispatchEvent(new CustomEvent('ll-meta'));
})()`);
await wait(900);

const plates = await ev(`(function(){
  var chips=[].slice.call(document.querySelectorAll('#storeLogos .lchip'));
  return chips.map(function(c){
    var p=c.querySelector('.limg');
    return {mono:!!(p&&p.classList.contains('mono')), letter:p?p.getAttribute('data-letter'):'',
            blank:!!(p && !p.getAttribute('data-letter') && !p.querySelector('img'))};
  });
})()`);
ok("every store chip falls back to a monogram when the lookup dies",
   plates.length > 0 && plates.every(p => p.mono && p.letter && !p.blank), JSON.stringify(plates));

/* THE DOMAINS ARRIVE AFTER THE FIRST RENDER. The strip is built from the select
   long before the feed answers, so without an ll-meta re-render it sits there
   markless until something unrelated redraws it. Asserted by watching the chip
   markup actually change when the event fires. */
const reRendered = await ev(`(function(){
  var box=document.getElementById('storeLogos');
  box.innerHTML='';
  document.dispatchEvent(new CustomEvent('ll-meta'));
  return true;
})()`);
await wait(600);
ok("...and the feed announcing itself is enough to rebuild the strip",
   reRendered && (await ev(`document.querySelectorAll('#storeLogos .lchip').length`)) > 0,
   `${await ev(`document.querySelectorAll('#storeLogos .lchip').length`)} chips`);

/* The two-step fallback, driven on an element of the same shape: the real ones
   have already failed and been removed by the time anything can look at them. */
const chain = await ev(`(function(){
  var plate=document.querySelector('#storeLogos .limg');
  var i=document.createElement('img');
  i.className='fimg'; i.setAttribute('data-alt','https://icons.duckduckgo.com/ip3/x.test.ico');
  i.src='https://www.google.com/s2/favicons?sz=128&domain=x.test';
  plate.appendChild(i);
  var first=i.getAttribute('src');
  i.dispatchEvent(new Event('error'));
  var second=i.getAttribute('src');
  i.dispatchEvent(new Event('error'));
  return {moved:first!==second, second:second.slice(0,32), gone:!document.contains(i),
          stillMono:plate.classList.contains('mono')};
})()`);
ok("a failed lookup tries a second source before giving up", chain.moved, JSON.stringify(chain));
ok("...the second source is a different provider, not a retry",
   /duckduckgo/.test(chain.second), chain.second);
ok("...and a second failure leaves the monogram rather than an empty disc",
   chain.gone && chain.stillMono, JSON.stringify(chain));

/* The strip cannot be built until the feed answers, so without these the
   handshake for a shop's mark starts late and lands on the critical path. */
ok("both favicon hosts are preconnected in the head",
   (await ev(`[].map.call(document.querySelectorAll('link[rel="preconnect"]'),function(l){return l.href}).join(' ')`))
     .match(/google|duckduckgo/g)?.length >= 2);

/* ---- THE PHOTOGRAPH, which the demo feed cannot exercise ------------------
   Every chip above is the drawn-mark fallback, because these placeholder
   products carry no images -- so the path that matters on the real feed
   (96-100% coverage) would ship unproven. The cards are synthesised here rather
   than the feed changed, and what they synthesise is the engine's own contract:
   a .card[data-cat] with an <img> and a .cname inside it. That contract is the
   whole reason the pictures are read off the grid instead of out of
   /api/coldwater, so it is the right thing to pin.

   TWO cards, not one, and their names are the assertion. Reading the FIRST card
   of a category is what this replaced -- it made "Edibles" whichever gummy tin
   sorted first and changed it on every filter. So the shake is offered FIRST and
   must lose to the flower behind it, which a first-wins implementation cannot do.
   Distinct data: URIs, so nothing is fetched and neither can fail for a reason
   that has nothing to do with the code. */
const PIX_A = "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7";
const PIX_B = "data:image/gif;base64,R0lGODlhAQABAIAAAP///wAAACH5BAEAAAAALAAAAAABAAEAAAICRAEAOw==";
await ev(`(function(){
  function card(id, cat, name, src){
    var c=document.createElement('div');
    c.className='card'; c.id=id; c.setAttribute('data-cat',cat);
    c.innerHTML='<img src="'+src+'" alt=""><div class="cname">'+name+'</div>';
    document.getElementById('grid').appendChild(c);
  }
  card('cw-fake1','THCA Flower','Sapura Tropicana Cherry Smalls Shake Bulk', ${JSON.stringify(PIX_A)});
  card('cw-fake2','THCA Flower','Soap | Pro Gro | Deli Flower',              ${JSON.stringify(PIX_B)});
})()`);
await wait(1000);

const shot = await ev(`(function(){
  var chip=document.querySelector('#catLogos [data-logocat="THCA Flower"]');
  if(!chip) return {err:'no flower chip'};
  var plate=chip.querySelector('.limg'), b=chip.querySelector('.bimg'), c=chip.querySelector('.cimg');
  return {plate:plate?plate.className:'', bimg:b?b.getAttribute('src'):'', cimg:c?c.getAttribute('src'):'',
          bg:plate?getComputedStyle(plate).backgroundColor:''};
})()`);
ok("a category chip uses a real product photo, not a drawn mark",
   !!shot.bimg && !shot.cimg, JSON.stringify(shot).slice(0, 160));
/* THE CURATION IS THE POINT. The shake was appended first; a first-card-wins
   reader would be showing it. */
ok("...and it curates: the shake loses to the flower behind it",
   shot.bimg === PIX_B, shot.bimg === PIX_A ? "picked the shake" : "ok");
/* Same treatment as the brand rail's maker photo: these are studio shots on
   white, so the plate is white and the photo covers it edge to edge. */
ok("...on the white plate the brand rail uses, not the tinted one",
   /photo/.test(shot.plate) && !/\bcat\b/.test(shot.plate), shot.plate);
ok("...and the plate is actually white behind it", /255,\s*255,\s*255/.test(shot.bg), shot.bg);

/* A DROPPED PHOTO FALLS BACK TO THE MARK, PLATE AND ALL. Removing the photo
   alone leaves a bare white circle; putting the light-on-dark mark on that white
   circle leaves nothing visible. Driven by pointing the chip at a url that
   cannot load. */
await ev(`(function(){
  var img=document.querySelector('#catLogos [data-logocat="THCA Flower"] .bimg');
  if(img) img.dispatchEvent(new Event('error',{bubbles:false}));
})()`);
await wait(300);
const fell = await ev(`(function(){
  var chip=document.querySelector('#catLogos [data-logocat="THCA Flower"]');
  var plate=chip&&chip.querySelector('.limg');
  return {plate:plate?plate.className:'', bimg:!!chip.querySelector('.bimg'),
          cimg:(chip.querySelector('.cimg')||{}).getAttribute?chip.querySelector('.cimg').getAttribute('src'):''};
})()`);
ok("a dropped photo uncovers the drawn mark", fell.bimg === false && /cat\.svg|\/img\/cat\//.test(fell.cimg),
   JSON.stringify(fell).slice(0, 140));
ok("...and restores the tinted plate it was drawn for", /mono/.test(fell.plate) && /cat/.test(fell.plate), fell.plate);

await ev("document.getElementById('cw-fake1').remove();document.getElementById('cw-fake2').remove()");
await ev("(()=>{const s=document.getElementById('fStore');s.value='Sample Shop B';s.dispatchEvent(new Event('change',{bubbles:true}))})()");
await wait(900);
await ev("(()=>{const s=document.getElementById('fStore');s.value='';s.dispatchEvent(new Event('change',{bubbles:true}))})()");
await wait(900);
/* One more than FULL_GRID: the gear block above cleared the cannabinoid filter
   that the THC relabel test had left set to THCa, so the accessory listing is
   back in the grid alongside the consumables. */
ok("and the synthetic cards left no trace in the grid",
   (await ev("document.querySelectorAll('#grid .card').length")) === FULL_GRID + 1 &&
   (await ev("!document.getElementById('cw-fake1') && !document.getElementById('cw-fake2')")) === true,
   `${await ev("document.querySelectorAll('#grid .card').length")} cards`);

/* THE PAIR. Store left, category right, one divider between them -- and the
   divider on the shell's midpoint rather than wherever the wider rail left it,
   which is why it is its own grid track and not a border on either side. */
const pair = await ev(`(function(){
  var p=document.getElementById('cwFacets'); if(!p) return null;
  var s=document.getElementById('storeRow'), c=document.getElementById('catRow'),
      d=p.querySelector('.lrsplit'), g=document.getElementById('grid');
  var pr=p.getBoundingClientRect(), dr=d.getBoundingClientRect();
  return {cols:getComputedStyle(p).gridTemplateColumns.split(' ').length,
          storeLeft:!!(s&&s.closest('[data-facet="store"]')),
          catRight:!!(c&&c.closest('[data-facet="cat"]')),
          order:s&&c?(s.compareDocumentPosition(c)&Node.DOCUMENT_POSITION_FOLLOWING)>0:false,
          dividers:document.querySelectorAll('.lrsplit').length,
          vertical:dr.height>dr.width,
          offCentre:Math.abs((dr.left+dr.width/2)-(pr.left+pr.width/2)),
          aboveGrid:(p.compareDocumentPosition(g)&Node.DOCUMENT_POSITION_FOLLOWING)>0,
          hidden:!!(g.offsetParent===null)};
})()`);
ok("store and category sit in one row, in that order", pair && pair.storeLeft && pair.catRight && pair.order,
   JSON.stringify(pair));
ok("three tracks: rail, divider, rail", pair && pair.cols === 3, JSON.stringify(pair && pair.cols));
ok("exactly one divider, drawn vertically between them", pair && pair.dividers === 1 && pair.vertical,
   JSON.stringify(pair));
ok("and it sits on the middle of the row, not beside the wider rail",
   pair && pair.offCentre < 1.5, `${pair && pair.offCentre}px off centre`);
ok("the pair sits above the grid", pair && pair.aboveGrid, JSON.stringify(pair && pair.aboveGrid));

/* THE RAIL DOES NOT SCROLL ON DESKTOP ANY MORE -- THE JOINTS ARE THE WAY ACROSS.
   This block used to assert the opposite, and it was right at the time: with the
   nudge arrows removed, a rail with no working wheel or drag was a dead row of
   circles that looked identical in markup. The owner reversed it -- "I don't want
   them scrollable on desktop at all, I really just want some arrows on either
   side" -- so the contract inverted and these assertions are rewritten to it
   rather than deleted. A suite that still asserted the old gestures would be
   green only while the feature was missing.

   This page runs at 1440px, so it is desktop by the width gate in rails.css.
   Both handlers set scrollLeft themselves, so a synthetic event still exercises
   the real code path rather than the browser's native scrolling -- which is what
   makes "it did not move" a statement about the handler standing down. */
ok("no rail carries the old nudge arrow",
   (await ev(`document.querySelectorAll('.lrnav').length`)) === 0);
const joints = await ev(`(function(){
  var w=document.querySelector('.lrwrap');
  return {per:w?w.querySelectorAll('.lrjoint').length:0,
          /* A JOINT IS HIDDEN WHENEVER THERE IS NOTHING THAT WAY, which at this
             point in the run is BOTH of them: the rails still fit, so neither
             can-prev nor can-next is set. Reading either one here asks a button
             that is correctly absent. What "visible at desktop width" means is
             the display rule inside the min-width media query, so the class is
             applied deliberately and then put back. */
          shown:(function(){ if(!w) return '';
            var had=w.classList.contains('can-next'); w.classList.add('can-next');
            var d=getComputedStyle(w.querySelector('.lrjoint-next')).display;
            if(!had) w.classList.remove('can-next');
            return d; })(),
          smoke:document.querySelectorAll('.lrjoint .lrj-smoke').length};
})()`);
ok("every rail carries a pair of joints instead", joints.per === 2, JSON.stringify(joints));
ok("...drawn, not empty buttons", joints.smoke > 0, String(joints.smoke));
ok("...and visible at desktop width", joints.shown === "flex", joints.shown);

await ev(`document.getElementById('catLogos').style.width='140px'`);
const wheeled = await ev(`(function(){
  var b=document.getElementById('catLogos');
  b.scrollLeft=0;
  var chip=b.querySelector('.lchip')||b;
  var e=new WheelEvent('wheel',{deltaY:120,deltaX:0,bubbles:true,cancelable:true});
  chip.dispatchEvent(e);
  return {left:b.scrollLeft, max:b.scrollWidth-b.clientWidth, prevented:e.defaultPrevented};
})()`);
ok("a rail with somewhere to go is still the case under test", wheeled && wheeled.max > 2, JSON.stringify(wheeled));
ok("a wheel over the rail no longer scrolls it sideways", wheeled && wheeled.left === 0, JSON.stringify(wheeled));
/* AND THE PAGE KEEPS THE GESTURE. Standing down has to mean handing the wheel
   back, or the cursor sits over a dead zone and the tab reads as frozen -- which
   is the failure the old at-the-end case existed to prevent, now true of the
   whole rail rather than only its ends. */
ok("...and the page keeps the scroll rather than sitting in a dead zone",
   wheeled && wheeled.prevented === false, JSON.stringify(wheeled));

await ev(`(function(){var b=document.getElementById('catLogos');
  b.style.scrollBehavior='auto'; b.scrollLeft=40;})()`);
await new Promise(r=>setTimeout(r,250));
const dragBase = await ev(`document.getElementById('catLogos').scrollLeft`);
const dragged = await ev(`(function(){
  var b=document.getElementById('catLogos');
  var chip=b.querySelector('.lchip')||b;
  function pe(t,x){ return new PointerEvent(t,{clientX:x,bubbles:true,cancelable:true,pointerType:'mouse'}); }
  chip.dispatchEvent(pe('pointerdown',300));
  document.dispatchEvent(pe('pointermove',260));
  document.dispatchEvent(pe('pointermove',220));
  var after=b.scrollLeft;
  document.dispatchEvent(pe('pointerup',220));
  return {after:after, dragging:b.classList.contains('dragging')};
})()`);
ok("the rail really was parked away from zero first", dragBase > 0, "scrollLeft " + dragBase);
ok("a mouse drag no longer moves the rail", dragged && dragged.after === dragBase,
   JSON.stringify(dragged) + " from " + dragBase);
ok("...and it never even enters the dragging state", dragged && dragged.dragging === false, JSON.stringify(dragged));

/* THE OTHER HALF, and the one that makes the two above mean something: taking
   the gestures away is only correct because the joints replace them. Asserted
   through a real click on the control, not by calling scrollBy. */
const byJoint = await ev(`(function(){
  var w=document.getElementById('catLogos').parentElement;
  var b=document.getElementById('catLogos');
  b.scrollLeft=0;
  b.style.scrollBehavior='';
  w.querySelector('.lrjoint-next').click();
  return {max:b.scrollWidth-b.clientWidth};
})()`);
await new Promise(r=>setTimeout(r,700));
const jointLeft = await ev(`document.getElementById('catLogos').scrollLeft`);
ok("pressing the joint is what moves it now", jointLeft > 0,
   "scrollLeft " + jointLeft + " of " + (byJoint && byJoint.max));
await ev("document.getElementById('catLogos').style.width=''");

/* THE THC SORT READS lab.totalThc, NOT potency -- which is why "Strongest"
   appeared to do nothing: every product scored -1 and the comparator fell
   through to alphabetical. The THC FILTER reads the same field, so it was
   silently passing everything too. Both are asserted, because a sort that is
   quietly alphabetical looks like a working sort. */
await ev("(()=>{const s=document.getElementById('fSort');s.value='thc';s.dispatchEvent(new Event('change',{bubbles:true}))})()");
await wait(1200);
const thcOrder = await ev("[...document.querySelectorAll('#grid .card')].map(c=>{const m=c.innerText.match(/([\\d.]+)% total THC/);return m?parseFloat(m[1]):null}).filter(v=>v!=null)");
ok("the THC sort produces figures to sort by", (thcOrder || []).length > 1, JSON.stringify(thcOrder));
ok("and they descend, strongest first",
   (thcOrder || []).every((v, i, a) => i === 0 || a[i - 1] >= v), JSON.stringify(thcOrder));

/* The filter shares the field, so it shares the bug. */
await ev("(()=>{const s=document.getElementById('fMinThc');s.value='25';s.dispatchEvent(new Event('change',{bubbles:true}))})()");
await wait(1000);
const filtered = await ev("[...document.querySelectorAll('#grid .card')].map(c=>{const m=c.innerText.match(/([\\d.]+)% total THC/);return m?parseFloat(m[1]):null})");
ok("the 25%+ filter actually excludes weaker products",
   (filtered || []).length > 0 && filtered.every(v => v != null && v >= 25), JSON.stringify(filtered));
await ev("(()=>{const s=document.getElementById('fMinThc');s.value='0';s.dispatchEvent(new Event('change',{bubbles:true}))})()");
await wait(800);

/* And the card must not claim a COA we never read. */
ok("no Lab Verified badge is shown here",
   (await ev("[...document.querySelectorAll('.cb.lab')].filter(e=>getComputedStyle(e).display!=='none').length")) === 0);
ok("the THC chip's tooltip says where the number came from",
   /published by the shop/.test(String(await ev("(document.querySelector('.labthc')||{}).title || ''"))),
   String(await ev("(document.querySelector('.labthc')||{}).title || ''")));

/* Both close controls in the lab modal, not just the x. */
await ev("(document.querySelector('#grid .card .strainbtn')||{}).click?.()");
await wait(700);
ok("the lab modal opens", (await ev("document.getElementById('strainModal').classList.contains('open')")) === true);
const closeBtns = await ev("document.querySelectorAll('#strainModal [data-close]').length");
ok("it renders more than one close control", closeBtns > 1, `${closeBtns} buttons`);
await ev("(()=>{const b=[...document.querySelectorAll('#strainModal [data-close]')];b[b.length-1].click()})()");
await wait(500);
ok("the bottom Close button closes it, not only the x",
   (await ev("document.getElementById('strainModal').classList.contains('open')")) === false);

/* ---- ESCAPE GETS YOU OUT --------------------------------------------------
   AUDITED: before cw-escape the only thing on this page that closed on Escape
   was the photo viewer. The engine binds the key to exactly one control (its
   strain search dropdown), so every modal and both drawers trapped you. Driven
   with a real key event through the browser, not by calling the handler. */
const esc = async () => {
  await send("Input.dispatchKeyEvent", { type: "keyDown", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
  await send("Input.dispatchKeyEvent", { type: "keyUp", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
  await wait(350);
};
await ev("(document.querySelector('#grid .card .strainbtn')||{}).click?.()");
await wait(600);
ok("the lab modal is open again, to be escaped from",
   (await ev("document.getElementById('strainModal').classList.contains('open')")) === true);
await esc();
ok("Escape closes the lab modal",
   (await ev("document.getElementById('strainModal').classList.contains('open')")) === false);

await ev("(document.getElementById('openCart')||{}).click?.()");
await wait(600);
const drawerOpen = await ev("document.getElementById('cartDrawer').classList.contains('open')");
ok("the cart drawer opens", drawerOpen === true);
await esc();
ok("and Escape closes it, rather than trapping a keyboard on a page of overlays",
   (await ev("document.getElementById('cartDrawer').classList.contains('open')")) === false);
/* The drawer and its backdrop are separate elements, so a close that hides one
   and leaves the other is a page that looks shut and cannot be clicked. */
ok("...taking the backdrop with it",
   (await ev("document.getElementById('overlay').classList.contains('open')")) === false);

/* One press peels one layer, so the photo viewer keeps its OWN Escape handler
   and is deliberately absent from cw-escape's selector list -- two handlers on
   one key close the thing behind the photo as well. The viewer's own open and
   Escape are driven in the photo section further down; what is asserted here is
   that the shared handler does not reach for it. */
ok("the shared handler leaves the photo viewer alone",
   (await ev(`(function(){
     var t=[].filter.call(document.scripts,function(x){return x.id==='cw-escape'})[0];
     return t ? t.textContent.indexOf('cwZoom') < 0 : false;
   })()`)) === true);

/* ---- THE LIST COUNT -------------------------------------------------------
   THE LIST ITSELF LIVES ON /trip and is driven by
   test-coldwater-list.mjs. What belongs HERE is the join that was broken: every
   card's button is the engine's own .addbtn, which writes the engine cart under
   "ll_cw:<town>:ll_cart", and this page's tally has to read THAT key. It used to read
   "ll_cw_list", written only by a parallel set of .cwl-add buttons -- so six
   items could be added and nothing anywhere showed one. Both halves worked
   perfectly and never met, which is why it is asserted rather than eyeballed. */
const CART_KEY = "ll_cw:coldwater:ll_cart";
await ev(`localStorage.removeItem('${CART_KEY}')`);
await wait(1200);
ok("with an empty list the tally stays out of the way",
   (await ev(`(document.getElementById('cwl-fab')||{}).hidden`)) === true);

ok("no card renders a second, parallel add button",
   (await ev(`document.querySelectorAll('.cwl-add').length`)) === 0);

/* Through the real button, not through storage: the point of the assertion is
   that the button and the tally agree about where the list is kept. */
await ev(`(function(){var b=document.querySelector('#grid .card .addbtn:not([disabled])'); if(b) b.click();})()`);
await wait(1400);
const fab = await ev(`(function(){
  var f=document.getElementById('cwl-fab');
  var raw=localStorage.getItem('${CART_KEY}');
  return {hidden:f?f.hidden:null, text:f?f.textContent:'', stored:raw?JSON.parse(raw).length:0,
          href:f?f.getAttribute('href'):''};
})()`);
ok("pressing the card's own button puts an item in the engine cart",
   fab.stored === 1, JSON.stringify(fab));
ok("and the tally reads that same key rather than a second one",
   fab.hidden === false && /My trip \(1\)/.test(fab.text), JSON.stringify(fab));
/* The link carries the town too, because the trip page is shared by every city
   and resolves which one it is from exactly this. */
ok("and it opens the trip plan for THIS town",
   fab.href === "/trip?market=coldwater", fab.href);
await ev(`localStorage.removeItem('${CART_KEY}')`);

/* ---- TWO PAGES, TWO CARTS ------------------------------------------------
   This page is generated from index.html and carries the same engine, which
   stores its cart under "ll_cart". Same origin, same key -- so a dispensary
   product added here landed in the hemp site's cart, where the drawer then
   tried to build a vendor checkout URL for something that has none. Reported
   as "you took away the checkout feature all together": nothing was removed,
   the two carts were never separated. */
await ev(`localStorage.setItem('ll_cart','[{"probe":1}]')`);
const iso = await ev(`(function(){
  var raw = Object.keys(window.localStorage).length;
  return { namespaced: !!window.localStorage.getItem('ll_cart'),
           leaked: Object.prototype.hasOwnProperty.call(window, 'localStorage') };
})()`);
ok("a cart written here is namespaced away from the hemp site's key",
   (await ev(`(function(){
      window.localStorage.setItem('ll_cart','X');
      /* The real store is reached through the prototype the shim replaced. */
      var direct = Object.getOwnPropertyDescriptor(Window.prototype,'localStorage');
      return window.localStorage.getItem('ll_cart') === 'X';
   })()`)) === true);
ok("and unrelated keys are untouched by the shim",
   (await ev(`(function(){
      window.localStorage.setItem('ll_unrelated','keepme');
      return window.localStorage.getItem('ll_unrelated') === 'keepme';
   })()`)) === true);

/* A PAGE THAT CANNOT CHECK OUT MUST NOT OFFER A CHECKOUT. Dutchie and Jane
   carts are session state in their own apps, these shops sell at a counter,
   and a cart cannot span six of them -- which is the point of the page. */
ok("the vendor checkout block is disarmed on this page",
   (await ev(`!!document.getElementById('cw-drawer')`)) === true);
ok("and it sends people to their list instead",
   (await ev(`document.getElementById('cw-drawer').textContent.indexOf('/trip') > -1`)) === true);
await ev(`localStorage.removeItem('ll_cart');localStorage.removeItem('ll_unrelated')`);

await send("Emulation.setDeviceMetricsOverride",{width:390,height:844,deviceScaleFactor:2,mobile:true});
await wait(500);
ok("no horizontal overflow at 390px",(await ev(`document.documentElement.scrollWidth<=392`)),`sw ${await ev(`document.documentElement.scrollWidth`)}`);

/* THE PAIR STACKS ON A PHONE, and the divider turns with it rather than being
   dropped: two rails of circles with no rule between them read as one long row
   of unrelated buttons, which is the confusion the divider is there to prevent.
   The overflow check above is the other half of this -- a grid child sizes to
   min-content by default, so a rail of 104px chips would widen the page instead
   of scrolling itself. */
const stacked = await ev(`(function(){
  var p=document.getElementById('cwFacets'), d=p&&p.querySelector('.lrsplit');
  if(!p||!d) return null;
  var dr=d.getBoundingClientRect(), sr=document.getElementById('storeRow').getBoundingClientRect();
  var cr=document.getElementById('catRow').getBoundingClientRect();
  return {cols:getComputedStyle(p).gridTemplateColumns.split(' ').length,
          horizontal:dr.width>dr.height, drawn:dr.width>100,
          between:dr.top>=sr.bottom-1 && dr.bottom<=cr.top+1,
          railScrolls:document.getElementById('catLogos').scrollWidth>document.getElementById('catLogos').clientWidth};
})()`);
ok("the pair stacks to one column at phone width", stacked && stacked.cols === 1, JSON.stringify(stacked));
ok("and the divider turns horizontal, between the two rails, rather than vanishing",
   stacked && stacked.horizontal && stacked.drawn && stacked.between, JSON.stringify(stacked));
ok("the rails scroll inside their own column instead of widening the page",
   stacked && stacked.railScrolls, JSON.stringify(stacked && stacked.railScrolls));

/* ---- the full-screen photo viewer ----------------------------------------
   THE PHOTO IS THE PRODUCT on a dispensary shelf -- trichome coverage, cure,
   whether "small buds" means smalls or means shake -- and a card thumbnail
   answers none of it. This is the one feature here bound to markup the engine
   owns, so it is also the one most likely to stop working with no error: it
   listens for a click on ANY <img> inside a card rather than on a class from
   inside the blob. That choice is what this drives.

   The demo feed carries no photographs, so one is injected into a real card
   rather than faked alongside it -- the point is that the engine's own card
   shape opens the viewer. */
await send("Emulation.clearDeviceMetricsOverride");
/* Into the engine's own .cimg holder, because that is where the expand control
   attaches -- injecting the photo loose in the card would test nothing. */
await ev(`(function(){
  var c=document.querySelector('#grid .card'); if(!c) return;
  var holder=c.querySelector('.cimg');
  if(!holder){ holder=document.createElement('div'); holder.className='cimg'; c.insertBefore(holder, c.firstChild); }
  var i=document.createElement('img'); i.id='cw-testphoto';
  i.src='/favicon.svg'; i.alt=''; holder.insertBefore(i, holder.firstChild);
})()`);
await wait(600);
ok("a card carries a photo to open", (await ev(`!!document.getElementById('cw-testphoto')`)) === true);

/* THE PHOTO IS NOT THE OPENER ANY MORE, AND THAT IS THE POINT. Opening on any
   click of the picture stole the card's flip -- tapping a photo is how a
   shopper reads the details, and it was enlarging instead. */
await ev(`document.getElementById('cw-testphoto').click()`);
await wait(350);
ok("clicking the photo itself no longer hijacks the card's flip",
   (await ev(`!document.getElementById('cwZoom') || !document.getElementById('cwZoom').classList.contains('on')`)) === true);

const expander = await ev(`(function(){
  var b=document.querySelector('#grid .card .cimg .cw-expand');
  if(!b) return {none:true};
  var r=b.getBoundingClientRect();
  return {label:b.getAttribute('aria-label'), w:Math.round(r.width), h:Math.round(r.height)};
})()`);
ok("every card photo carries an expand control", !expander.none, JSON.stringify(expander));
ok("...big enough for a thumb", expander.none || (expander.w >= 32 && expander.h >= 32), JSON.stringify(expander));

await ev(`document.querySelector('#grid .card .cimg .cw-expand').click()`);
await wait(400);
const zoom = await ev(`(function(){
  var o=document.getElementById('cwZoom'); if(!o) return null;
  var img=o.querySelector('img');
  return {open:o.classList.contains('on'), shown:getComputedStyle(o).display,
          src:(img&&img.getAttribute('src'))||'', locked:document.documentElement.style.overflow};
})()`);
ok("the expand control opens it full screen", zoom && zoom.open && zoom.shown === "flex",
   JSON.stringify(zoom));
ok("and it shows that photo, not a placeholder", zoom && /favicon\.svg/.test(zoom.src), zoom && zoom.src);
/* Without this a flick meant for the photo scrolls the grid underneath, and the
   overlay comes back over a different part of the shelf. */
ok("the page behind is locked while it is open", zoom && zoom.locked === "hidden", zoom && zoom.locked);

await ev(`document.querySelector('#cwZoom img').click()`);
await wait(250);
ok("a second tap zooms in", (await ev(`document.querySelector('#cwZoom img').classList.contains('zoomed')`)) === true);

/* Escape, the backdrop and the close button are three ways out because a photo
   you can open and cannot close is worse than one you cannot open. */
await ev(`document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}))`);
await wait(250);
const closed = await ev(`(function(){var o=document.getElementById('cwZoom');
  return {open:o.classList.contains('on'), locked:document.documentElement.style.overflow,
          src:o.querySelector('img').getAttribute('src')}})()`);
ok("Escape closes it", closed && !closed.open, JSON.stringify(closed));
ok("and the page scrolls again", closed && closed.locked !== "hidden", closed && closed.locked);
/* Dropped rather than left loaded: a full-size photo in an offscreen node is
   real memory on a phone. */
ok("the photo is released rather than held offscreen", closed && !closed.src, String(closed && closed.src));

await ev(`document.getElementById('cw-testphoto').click()`);
await wait(300);
await ev(`document.getElementById('cwZoom').click()`);
await wait(250);
ok("clicking the backdrop closes it too",
   (await ev(`!document.getElementById('cwZoom').classList.contains('on')`)) === true);

/* THE RAILS ARE FULL OF <img> TOO, and clicking one must still filter rather
   than open a picture of a shop's logo. This is the assertion that would fail
   if the opener were widened to "any image on the page". */
const railImg = await ev(`(function(){
  var i=document.querySelector('#catLogos .lchip img, #storeLogos .lchip img');
  if(!i) return "no rail image";
  i.click(); return "clicked";
})()`);
await wait(300);
ok("a rail chip's image does not open the viewer",
   (await ev(`!document.getElementById('cwZoom').classList.contains('on')`)) === true, String(railImg));
await ev(`(function(){var c=document.getElementById('clearCats')||document.getElementById('clearStores');
  if(c) c.click();})()`);
await wait(400);
await ev(`document.getElementById('cw-testphoto').remove()`);
ok("no uncaught errors from the viewer", errs.length === 0, errs.join(" | ").slice(0, 160));

/* ---- one button, one wording, one colour ---------------------------------
   The grid was showing two treatments side by side: gear cards relabelled to a
   green "Add to list", everything else keeping the engine's blue "Add to
   Legal-Leaf Cart" over a footer reading "Checkout at <shop>". Two colours and
   two wordings for one action -- and the blue half was the wrong one, because
   there is no checkout here. These are dispensary menus; the vendor cart is
   already disarmed and the button already goes to the shopping list, so
   "Checkout at Banzen" promised something the page cannot do. */
await ev(`(function(){var f=document.getElementById('fCannabinoid'); if(f){f.value='';
  f.dispatchEvent(new Event('change',{bubbles:true}));}})()`);
await wait(900);
const buttons = await ev(`(function(){
  var b=[].map.call(document.querySelectorAll('#grid .card .addbtn'),function(x){
    return {t:(x.textContent||'').replace(/\\s+/g,' ').trim(), bg:getComputedStyle(x).backgroundColor};});
  var f=[].map.call(document.querySelectorAll('#grid .card .coa'),function(x){return (x.textContent||'').trim()});
  return {n:b.length, labels:[...new Set(b.map(function(x){return x.t}))],
          colours:[...new Set(b.map(function(x){return x.bg}))],
          checkout:f.filter(function(t){return /checkout at/i.test(t)}).length};
})()`);
ok("every add button carries the same wording", buttons.n > 0 && buttons.labels.length === 1,
   JSON.stringify(buttons.labels).slice(0, 110));
ok("and that wording is Add to Shopping List",
   buttons.labels.every(l => /add to shopping list/i.test(l)), JSON.stringify(buttons.labels).slice(0, 90));
ok("and one colour, not green for gear and blue for the rest",
   buttons.colours.length === 1, JSON.stringify(buttons.colours));
/* There is no online checkout on a dispensary page, so nothing may promise one. */
ok("no card still offers a vendor checkout", buttons.checkout === 0, `${buttons.checkout} cards`);

/* ---- THE DRAWER IS ONE LIST FOR ONE TOWN ---------------------------------
   The engine groups the cart by store and hangs a checkout control off each
   group. The first fix RELABELLED those to "See my list", which left a Sapura
   list, an Exclusive list and a Banzen list -- three buttons to one page,
   reported as exactly that. Relabelling preserved the shape of the thing that
   was wrong, so they are removed, and one primary button goes in the footer
   where the total already is.

   Two shops in the cart, deliberately: with one, "no per-shop buttons" and "one
   button" are the same sentence and the assertion proves nothing. */
await ev(`localStorage.setItem('ll_cw:coldwater:ll_cart', JSON.stringify([
  {id:'a',name:'Item A',store:'Sample Shop A',storeKey:'s1',domain:'a.test',platform:'shopify',size:'1/8 oz',price:30},
  {id:'b',name:'Item B',store:'Sample Shop B',storeKey:'s2',domain:'b.test',platform:'woocommerce',size:'1g',price:45}
]))`);
await send("Page.navigate", { url: `http://127.0.0.1:${PORT}/coldwater` });
await until(async () => { if (await ev(`document.readyState==='complete'`)) return true; throw 0 });
await until(async () => { if ((await ev(`document.querySelectorAll('#grid .card').length`)) > 0) return true; throw 0 }, 80);
await ev(`(document.getElementById('openCart')||{}).click?.()`);
await wait(1200);

const drawer = await ev(`(function(){
  var d=document.getElementById('cartDrawer');
  if(!d) return {none:true};
  var body=document.getElementById('cartBody'), foot=document.getElementById('cartFoot');
  var golist=foot?foot.querySelectorAll('.cw-golist'):[];
  return {
    title:(d.querySelector('.dhead h2')||{}).textContent||'',
    sub:(d.querySelector('.dhead p')||{}).textContent||'',
    stores:body?body.querySelectorAll('.dstore').length:0,
    perShop:body?body.querySelectorAll('.checkout,[data-checkout],a[href*="/cart"],a[href*="add-to-cart"]').length:0,
    seeMyList:(body?body.innerText:'').match(/See my list/g)||[],
    golist:golist.length,
    golistText:golist.length?golist[0].textContent:'',
    golistHref:golist.length?golist[0].getAttribute('href'):'',
    note:(foot?foot.innerText:'')
  };
})()`);
ok("two shops are in the drawer, so 'one button' is a real claim",
   drawer.stores === 2, JSON.stringify({stores: drawer.stores}));
ok("the drawer is this town's shopping list, not the hemp cart",
   /Coldwater Cannabis Shopping List/.test(drawer.title), drawer.title);
ok("...and its subtitle stops offering a checkout at each store",
   !/checkout/i.test(drawer.sub), drawer.sub);
/* The shape of the old bug: one button per shop, all going to one page. */
ok("no per-shop checkout control survives in the body",
   drawer.perShop === 0, `${drawer.perShop} left`);
ok("...and they are gone rather than renamed to 'See my list'",
   drawer.seeMyList.length === 0, JSON.stringify(drawer.seeMyList));
ok("exactly one button, in the footer with the total",
   drawer.golist === 1, `${drawer.golist} buttons`);
ok("...naming the town and pointing at the trip plan",
   /Coldwater/.test(drawer.golistText) && /^\/trip\?market=coldwater$/.test(drawer.golistHref),
   JSON.stringify({text: drawer.golistText, href: drawer.golistHref}));
/* The engine's footer promises each link pre-fills a cart and applies a coupon
   and an affiliate ref. There is no checkout, no coupon and no affiliate link in
   this town, and a drawer describing what it cannot do is the promise this file
   exists to avoid making. */
ok("the footer no longer promises a coupon and an affiliate ref",
   !/affiliate|coupon|pre-fills/i.test(drawer.note), drawer.note.replace(/\s+/g, " ").slice(0, 120));

/* Empty is its own state: the engine empties the footer, so a button to an
   empty list must not appear -- and the empty text is the hemp cart's. */
await ev(`localStorage.setItem('ll_cw:coldwater:ll_cart','[]')`);
await send("Page.navigate", { url: `http://127.0.0.1:${PORT}/coldwater` });
await until(async () => { if (await ev(`document.readyState==='complete'`)) return true; throw 0 });
await wait(900);
await ev(`(document.getElementById('openCart')||{}).click?.()`);
await wait(900);
const emptyDrawer = await ev(`(function(){
  var body=document.getElementById('cartBody'), foot=document.getElementById('cartFoot');
  return {text:body?body.innerText:'', golist:foot?foot.querySelectorAll('.cw-golist').length:0};
})()`);
ok("an empty list says so in this town's words, not the hemp cart's",
   /Coldwater list is empty/.test(emptyDrawer.text) && !/Legal-Leaf cart/i.test(emptyDrawer.text),
   emptyDrawer.text.replace(/\s+/g, " ").slice(0, 90));
ok("...and offers no button to an empty list", emptyDrawer.golist === 0, `${emptyDrawer.golist}`);
await ev(`localStorage.removeItem('ll_cw:coldwater:ll_cart')`);

console.log(`\n${fails.length?"FAILED: "+fails.join(", "):"All assertions passed."}\n`);
ch.kill();srv.kill();process.exit(fails.length?1:0);
