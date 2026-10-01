/* test-shelf-back.mjs — coming back is a restore, not a reload.
 *
 * "This site reloads, like, a lot ... it can't decide if it's loading a static
 *  seed or something else. And then even more horribly, you're not saving and
 *  caching where the people were on a page. You should just be hitting back to
 *  the same spot, not hitting home again. Why would you hit home and refresh
 *  again? ... It should be like when you tab over to Reels on Facebook, and you
 *  come back to your main feed, and it's there."
 *
 * BOTH HALVES WERE MEASURED IN THIS BROWSER BEFORE ANY OF IT WAS WRITTEN, and
 * the numbers are why the fix is shaped the way it is.
 *
 * 1. THE PRODUCT PAGE'S ONLY WAY OUT WAS `<a href="https://legal-leafmarket.com/">`.
 *    Three separate faults in one attribute: it goes to `/` even from /devices,
 *    so the shopper's shelf is not restored but REPLACED; it is a fresh
 *    navigation, so the browser's own back/forward cache -- which would hand
 *    back the identical document, scrolled, instantly -- is never used; and it
 *    defeats shelf-return.js, whose snapshot is keyed on the path it was taken
 *    from and is discarded when you land somewhere else. That is the "hitting
 *    home again", exactly.
 *
 * 2. THE SHELF REBUILT ITSELF EIGHT TIMES ON EVERY LOAD (ten on a warm one):
 *    seed at 12, seed topped up to 24, feed back to 12, then 24, 36, 48, then
 *    the deal. Four of those were shelf-shuffle pressing Load more one press per
 *    animation frame, and two were the baked seed being dressed up as a shelf a
 *    moment before the real one replaced it. Watching that is what "it can't
 *    decide what it's loading" describes.
 *
 * THE ASSERTION THAT MATTERS IS NOT THE SCROLL. A restored scroll can be
 * produced by a full reload plus a jump, which is what this site did and what
 * felt broken. So the test is that the DOCUMENT ITSELF SURVIVED: a marker set
 * on `window` before leaving is still there afterwards. Nothing but a genuine
 * back/forward restore can do that, and no amount of rebuilding can fake it.
 *
 *     node test-shelf-back.mjs
 */
import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { extname, join } from "node:path";
import { launchChrome } from "./tools/chrome-path.mjs";

const PORT = 3557, CDP = 9675;
process.env.LL_NO_STORE_FETCH = "1";
process.env.LL_SITE_HOST = "127.0.0.1:" + PORT;   // so the real /p/ handler reads THIS catalogue

const fails = [];
const ok = (n, c, x = "") => { console.log(`${c ? "  PASS" : "  FAIL"}  ${n}${x ? "   (" + x + ")" : ""}`); if (!c) fails.push(n); };
const wait = (ms) => new Promise(r => setTimeout(r, ms));
async function until(fn, n = 160) { for (let i=0;i<n;i++){ try { return await fn() } catch { await wait(250) } } throw new Error("timeout") }

const { heatOf } = await import("./api/heat.js");
const { shelfFor, shelfGroup } = await import("./api/shelves.js");
const shareMod = await import("./api/share.js");

const SHOPS = [["Black Tie CBD","blacktiecbd"],["THCA Small Buds","thcasmallbuds"],["Puffy","hipuffy"],["Grasscity","grasscity"],["Chill Steel Pipes","chill"],["CBD Hemp Direct","cbdhempdirect"]];
const N = 600;
function prod(i){
  const [store,storeKey] = SHOPS[i % SHOPS.length];
  const gear = i % 2 === 0;
  const p = { id:"p"+i, name:(gear?"Beaker Bong ":"Strain ")+i, store, storeKey, domain:"e.test", platform:"shopify",
    cannabinoid: gear?"Accessory":"THCa", category: gear?"Bongs & Rigs":"THCA Flower",
    type: gear?"":(i%2?"Indica":"Sativa"), strain: gear?"":"Strain "+i,
    image:"/favicon.svg", gallery:[], url:"https://e.test/p"+i, brand: gear?"Chill":"BT", brandKey: gear?"chill":"bt",
    description:"Words about it.", inStock:true, startsAt:20+(i%120), sale:20+(i%120), ship:0, badges:[], intl:false,
    potency: gear?0:20+(i%10), perG: gear?0:(0.9+(i%50)/50),
    sizes:[[gear?"One Size":"28g", 20+(i%120), 0, "p"+i+"a", true, "https://e.test/p"+i, "", gear?0:28]] };
  p.heat = heatOf(p); p.group = shelfGroup(p); return p;
}
const ALL = Array.from({length:N},(_,i)=>prod(i));
const FEED = rows => ({ meta:{updated:new Date(0).toISOString(), total:rows.length,
  stores:SHOPS.map(([name])=>({name,count:Math.round(rows.length/SHOPS.length)}))}, products:rows });

const MIME={".html":"text/html",".js":"text/javascript",".css":"text/css",".svg":"image/svg+xml",".json":"application/json",".png":"image/png",".webmanifest":"application/manifest+json"};
const srv = createServer(async (req,res)=>{
  const u = new URL(req.url,"http://x");
  if (/^\/api\/(products|market|coldwater)/.test(u.pathname)){
    const sh = shelfFor(u.searchParams.get("shelf")||"");
    res.writeHead(200,{"content-type":"application/json","cache-control":"public"});
    return res.end(JSON.stringify(FEED(sh ? ALL.filter(p=>sh.test(p)) : ALL)));
  }
  if (/^\/p\//.test(u.pathname)){
    /* THE REAL HANDLER. A fixture product page would be a fixture testing
       itself -- the crumb is the thing under test and it is built in there. */
    const id = decodeURIComponent(u.pathname.slice(3));
    const fake = { url:"/api/share?id="+encodeURIComponent(id), method:"GET",
                   headers:{ host:"127.0.0.1:"+PORT }, query:{ id } };
    let code = 200, headers = {}, body = "";
    const resp = { setHeader:(k,v)=>{headers[k]=v;}, status(c){ code=c; return this; },
      send(b){ body=b; }, end(b){ if(b!==undefined) body=b; }, json(o){ body=JSON.stringify(o); },
      writeHead(c,h){ code=c; Object.assign(headers,h||{}); return this; } };
    try { await shareMod.default(fake, resp); } catch(e){ code=500; body="handler threw: "+e.message; }
    res.writeHead(code, Object.assign({"content-type":"text/html; charset=utf-8"}, headers));
    return res.end(body);
  }
  if (u.pathname.startsWith("/api/")){ res.writeHead(200,{"content-type":"application/json"}); return res.end('{"p":{}}'); }
  const f = u.pathname === "/" ? "index.html" : u.pathname.replace(/^\//,"");
  for (const c of [f, f+".html"]){
    try { const b = await readFile(join("public", c));
      res.writeHead(200,{"content-type":MIME[extname(c)]||"application/octet-stream"}); return res.end(b);} catch {}
  }
  res.writeHead(404).end("no");
});
await new Promise(r=>srv.listen(PORT,"127.0.0.1",r));

const { proc: ch } = await launchChrome(CDP, [], { userDataDir:"/tmp/_llshelfback" });
const t = await until(async()=>{const j=await(await fetch(`http://127.0.0.1:${CDP}/json/list`)).json();const p=j.find(x=>x.type==="page");if(!p)throw 0;return p});
const s = new globalThis.WebSocket(t.webSocketDebuggerUrl);
await new Promise(r=>s.addEventListener("open",r));
let id=0; const pend=new Map(); const errs=[];
s.addEventListener("message",e=>{const m=JSON.parse(e.data);
  if(m.method==="Runtime.exceptionThrown")errs.push((m.params.exceptionDetails.exception?.description||m.params.exceptionDetails.text||"").slice(0,140));
  if(m.id&&pend.has(m.id)){pend.get(m.id)(m);pend.delete(m.id)}});
const send=(m,p={})=>new Promise(r=>{const i=++id;pend.set(i,r);s.send(JSON.stringify({id:i,method:m,params:p}))});
const ev=async x=>(await send("Runtime.evaluate",{expression:x,returnByValue:true,awaitPromise:true})).result?.result?.value;

await send("Runtime.enable"); await send("Page.enable"); await send("Network.enable");
await send("Network.setBlockedURLs",{urls:["*fonts.googleapis.com*","*fonts.gstatic.com*","*bigcartel.com*"]});
await send("Emulation.setDeviceMetricsOverride",{width:1280,height:1000,deviceScaleFactor:1,mobile:false});

/* The repaint counter, armed before any of the page's own script runs. */
await send("Page.addScriptToEvaluateOnNewDocument",{source:`
(function(){ window.__repaints=0;
  (function arm(){ var g=document.getElementById("grid"); if(!g) return setTimeout(arm,10);
    new MutationObserver(function(ms){ var a=0,r=0;
      ms.forEach(function(m){a+=m.addedNodes.length;r+=m.removedNodes.length;});
      if(a>=6||r>=6) window.__repaints++;
    }).observe(g,{childList:true});
  })();
})();`});

async function goto(path){
  await send("Page.navigate",{url:`http://127.0.0.1:${PORT}${path}`});
  await until(async()=>{ if((await ev(`document.querySelectorAll('#grid .card[data-pid]').length`))>0) return true; throw 0 });
  await wait(2200);
}

/* ---------- 1. the shelf settles, and it does not rebuild itself ---------- */

console.log("\nThe shelf settles once\n");
await goto("/");
await ev(`try{localStorage.clear();sessionStorage.clear()}catch(e){}`);
await goto("/");
const cold = await ev(`JSON.stringify({repaints:window.__repaints, cards:document.querySelectorAll('#grid .card[data-pid]').length})`);
const c = JSON.parse(cold);
console.log("  cold load: " + cold);
/* Measured at 8 before this change and 4 after. Six is the budget: it fails on
   the old behaviour and leaves room for one extra render on a slow run. */
ok("a cold load rebuilds the grid a handful of times, not eight", c.repaints <= 6, "repaints=" + c.repaints);
ok("...and settles on a full shelf rather than one page", c.cards >= 40, "cards=" + c.cards);

/* THE FLOOR IS REACHED EVERY TIME. This was a race: gating the deal on the
   `ll-meta` EVENT lost it whenever the feed was parsed before this file was
   listening, and the shelf then sat at 12 cards with no second chance. It moved
   between runs and between pages, which is how a race announces itself, so it
   is asserted repeatedly rather than once. */
let floors = [];
for (const p of ["/", "/devices", "/consumables"]) { await goto(p);
  floors.push(p + ":" + await ev(`document.querySelectorAll('#grid .card[data-pid]').length`)); }
ok("every shelf reaches the floor, not just usually", floors.every(f => Number(f.split(":")[1]) >= 40), floors.join(" "));

/* ---------- 2. the crumb is a back ---------- */

console.log("\nThe way off a product page\n");
await goto("/devices");
await ev(`for(var i=0;i<3;i++){var b=document.querySelector('#grid > .loadmore'); if(b) b.click();} window.scrollTo(0,2200)`);
await wait(500);
const before = JSON.parse(await ev(`JSON.stringify({cards:document.querySelectorAll('#grid .card[data-pid]').length,y:Math.round(window.scrollY)})`));
console.log("  on /devices: " + JSON.stringify(before));
ok("the shelf is paged and scrolled before we leave", before.cards > 24 && before.y > 1000, JSON.stringify(before));

/* THE MARKER IS THE WHOLE TEST. It lives on `window`, so it survives exactly
   one thing: this document being handed back rather than built again. */
await ev(`window.__stillHere = "yes"`);
const pid = await ev(`document.querySelectorAll('#grid .card[data-pid]')[6].getAttribute('data-pid')`);
await ev(`document.querySelectorAll('#grid .card[data-pid]')[6].querySelector('.cname').click()`);
await until(async()=>{ if(/^\/p\//.test(await ev(`location.pathname`))) return true; throw 0 }, 80);
await wait(600);

const crumb = await ev(`(function(){ var a=document.getElementById("llBack");
  return a ? JSON.stringify({text:a.textContent, href:a.getAttribute("href"), home:a.hasAttribute("data-home")}) : "NO CRUMB"; })()`);
console.log("  crumb: " + crumb);
const cr = crumb === "NO CRUMB" ? null : JSON.parse(crumb);
ok("the product page opened", /^\/p\//.test(await ev(`location.pathname`)), pid);
ok("the crumb names the shelf they came from", !!cr && /Back to Devices & Misc/.test(cr.text), crumb);
ok("...and points at that shelf, not the home page", !!cr && cr.href === "/devices", crumb);
ok("...and is no longer flagged as the home link", !!cr && cr.home === false);

await ev(`document.getElementById("llBack").click()`);
await until(async()=>{ if((await ev(`location.pathname`))==="/devices") return true; throw 0 }, 80);
await wait(1200);

const after = JSON.parse(await ev(`JSON.stringify({
  cards:document.querySelectorAll('#grid .card[data-pid]').length,
  y:Math.round(window.scrollY), marker:window.__stillHere||null, repaints:window.__repaints})`));
console.log("  back on /devices: " + JSON.stringify(after));
ok("we land on the shelf we left, not the home page", (await ev(`location.pathname`)) === "/devices");
/* The one that cannot be faked by a rebuild. */
ok("THE DOCUMENT ITSELF CAME BACK -- it was restored, not reloaded",
   after.marker === "yes", "marker=" + after.marker);
ok("...so every card is still there", after.cards === before.cards, after.cards + " vs " + before.cards);
ok("...at the same scroll position", Math.abs(after.y - before.y) <= 4, after.y + " vs " + before.y);

/* ---------- 3. the counter-cases ---------- */

console.log("\nAnd it is still a home link where home is the right answer\n");
await send("Page.navigate",{url:`http://127.0.0.1:${PORT}/p/${pid}`});
await until(async()=>{ if(await ev(`!!document.getElementById("llBack")`)) return true; throw 0 }, 60);
const direct = JSON.parse(await ev(`JSON.stringify({text:document.getElementById("llBack").textContent,
  href:document.getElementById("llBack").getAttribute("href")})`));
console.log("  arrived cold: " + JSON.stringify(direct));
ok("arriving with no referrer keeps the site link", /Legal-Leaf Market/.test(direct.text), JSON.stringify(direct));
ok("...pointing at the home page", /\/$/.test(direct.href), direct.href);

/* A shelf we do NOT publish must not become a back target: the map is built
   from the registries, so anything else is somebody's link, not our shelf. */
await goto("/");
await ev(`history.pushState(null,"","/library")`);
await send("Page.navigate",{url:`http://127.0.0.1:${PORT}/p/${pid}`});
await until(async()=>{ if(await ev(`!!document.getElementById("llBack")`)) return true; throw 0 }, 60);
const nonShelf = await ev(`document.getElementById("llBack").getAttribute("href")`);
ok("a referrer that is not one of our shelves is not offered as a back", /\/$/.test(String(nonShelf)), String(nonShelf));

ok("no page exceptions", errs.length === 0, errs.slice(0,2).join(" | "));

s.close(); ch.kill(); srv.close();
console.log(fails.length ? `\n${fails.length} FAILED: ${fails.join(", ")}` : "\nall good");
process.exit(fails.length ? 1 : 0);
