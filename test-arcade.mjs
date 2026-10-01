/* test-arcade.mjs — the arcade wall and the house cabinet.
 *
 * Three claims, and the first two are about RESTRAINT rather than function:
 *
 *   1. AN UNLISTED CABINET IS NOT IN THE DOM. Two of the three games are
 *      Brayton's (Dean's) and do not have his sign-off yet, so "not promoted"
 *      has to mean not present -- not merely hidden with CSS, which is one
 *      view-source away from being published anyway. ?all=1 is how the owner
 *      looks without publishing.
 *   2. NOTHING LOADS UNTIL IT IS PRESSED, and closing a cabinet TEARS IT DOWN.
 *      The built-in runs a requestAnimationFrame loop; leaving it running
 *      behind a hidden panel is a phone battery drain nobody would ever
 *      attribute to this file.
 *   3. The canvas is actually PAINTING -- asserted by reading pixels back,
 *      because a mounted canvas of the right size that draws nothing passes
 *      every other check anyone would think to write.
 *
 *     node test-arcade.mjs
 */
import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { extname, join } from "node:path";
import { launchChrome } from "./tools/chrome-path.mjs";
const PORT = 3517, CDP = 9371;
const MIME = {".html":"text/html",".js":"text/javascript",".css":"text/css",".svg":"image/svg+xml",".png":"image/png",".txt":"text/plain"};
const srv = createServer(async (req,res)=>{
  const u=new URL(req.url,"http://x");
  /* MIRRORS server.mjs's serveStatic tryFiles, deliberately. A suite that
     resolves paths its own way tests its own resolver, not the site's -- and
     the first draft of this one appended ".html" to everything, so the
     vendored game at /arcade/dino/ and its LICENSE.txt both 404'd and the
     iframe came back empty. That reads as a broken game, not a broken test. */
  const base=u.pathname==="/"?"/index.html":u.pathname;
  const cands = extname(base) ? [base] : [base+".html", join(base,"index.html")];
  for (const c of cands){
    try{ const b=await readFile(join("public", c.replace(/^\//,"")));
      res.writeHead(200,{"content-type":MIME[extname(c)]||"application/octet-stream"});
      return res.end(b);
    }catch{}
  }
  res.writeHead(404).end("no");
});
await new Promise(r=>srv.listen(PORT,"127.0.0.1",r));
const {proc:ch}=await launchChrome(CDP,[],{userDataDir:"/tmp/_llar"});
const wait=ms=>new Promise(r=>setTimeout(r,ms));
let t=null; for(let i=0;i<80;i++){ try{ const j=await(await fetch(`http://127.0.0.1:${CDP}/json/list`)).json(); t=j.find(x=>x.type==="page"); if(t)break; }catch{} await wait(250); }
const s=new globalThis.WebSocket(t.webSocketDebuggerUrl);
await new Promise(r=>s.addEventListener("open",r));
let id=0; const p=new Map(); const errs=[];
s.addEventListener("message",e=>{ const m=JSON.parse(e.data);
  if(m.method==="Runtime.exceptionThrown") errs.push(m.params.exceptionDetails.exception?.description||m.params.exceptionDetails.text);
  if(m.id&&p.has(m.id)){p.get(m.id)(m);p.delete(m.id)} });
const send=(method,params={})=>new Promise(r=>{const i=++id;p.set(i,r);s.send(JSON.stringify({id:i,method,params}))});
const ev=async x=>(await send("Runtime.evaluate",{expression:x,returnByValue:true})).result?.result?.value;
await send("Runtime.enable"); await send("Page.enable"); await send("Network.enable");
await send("Network.setBlockedURLs",{urls:["*fonts.googleapis.com*","*fonts.gstatic.com*","*bigcartel.com*"]});
await send("Emulation.setDeviceMetricsOverride",{width:1280,height:1000,deviceScaleFactor:1,mobile:false});
await send("Page.navigate",{url:`http://127.0.0.1:${PORT}/arcade`});
await wait(2200);
await ev(`(()=>{const g=document.querySelector(".ll-age,.age-gate,#llAge");if(g)g.remove();return 1})()`);
const ok=(n,c,x="")=>console.log(`${c?"  PASS":"  FAIL"}  ${n}${x?"   ("+x+")":""}`);
ok("the wall rendered", await ev(`document.querySelectorAll("#arWall .ar-cab").length`) >= 1,
   String(await ev(`document.querySelectorAll("#arWall .ar-cab").length`)));
ok("only listed+installed cabinets show by default",
   (await ev(`document.querySelectorAll("#arWall .ar-cab").length`)) === 2);
ok("...and the unlisted ones are not even in the DOM",
   (await ev(`document.querySelector("#arWall").innerText.indexOf("Deep Water")`)) < 0);
ok("the player is closed at rest", await ev(`document.getElementById("arPlay").hidden`) === true);
await ev(`document.querySelector('[data-game="invaders"]').click()`);
await wait(900);
ok("pressing a cabinet opens the player", await ev(`document.getElementById("arPlay").hidden`) === false);
ok("...and mounts a real canvas", await ev(`!!document.querySelector("#arStage canvas")`));
const w = await ev(`(()=>{const c=document.querySelector("#arStage canvas");return c?c.width+"x"+c.height:""})()`);
ok("...at a real size", /^\d+x\d+$/.test(w) && w !== "0x0", w);
ok("...that is actually painting", await ev(`(()=>{const c=document.querySelector("#arStage canvas");
  const d=c.getContext("2d").getImageData(0,0,c.width,c.height).data;
  let n=0; for(let i=0;i<d.length;i+=4) if(d[i]||d[i+1]||d[i+2]) n++;
  return n>500})()`));
ok("the title bar credits the author", /Legal-Leaf/.test(await ev(`document.getElementById("arBy").textContent`)),
   await ev(`document.getElementById("arBy").textContent`));
await ev(`document.getElementById("arClose").click()`);
await wait(300);
ok("closing hides the player", await ev(`document.getElementById("arPlay").hidden`) === true);
ok("...and tears the canvas down", (await ev(`document.querySelectorAll("#arStage canvas").length`)) === 0);
await send("Page.navigate",{url:`http://127.0.0.1:${PORT}/arcade?all=1`});
await wait(1500);
ok("?all=1 shows every cabinet", (await ev(`document.querySelectorAll("#arWall .ar-cab").length`)) === 4,
   String(await ev(`document.querySelectorAll("#arWall .ar-cab").length`)));
ok("...with the not-yet-installed ones disabled",
   (await ev(`document.querySelectorAll("#arWall .ar-cab[disabled]").length`)) === 2);
ok("it is noindex", /noindex/.test(await ev(`(document.querySelector("meta[name=robots]")||{}).content||""`)));
/* THE VENDORED CABINET, driven for real. The dino is a third-party BSD-3
   build in an iframe, and the thing that would break silently is the iframe
   loading a 404 or a white Chrome offline page instead of the game -- both of
   which look like "a cabinet" from outside. So: it loads, it is skinned to the
   site's ground rather than Chrome's white, and its canvas exists. */
await send("Page.navigate",{url:`http://127.0.0.1:${PORT}/arcade`});
await wait(1200);
await ev(`(()=>{const g=document.querySelector(".ll-age,.age-gate,#llAge");if(g)g.remove();return 1})()`);
await ev(`document.querySelector('[data-game="dino"]').click()`);
await wait(1600);
ok("the vendored cabinet mounts an iframe", await ev(`!!document.querySelector("#arStage iframe")`));
const dinoDoc = await ev(`(()=>{const f=document.querySelector("#arStage iframe");
  try{ const d=f.contentDocument; return d?{canvas:!!d.querySelector(".runner-canvas"),
    bg:getComputedStyle(d.body).backgroundColor, title:d.title.slice(0,30)}:null }catch(e){return "blocked:"+e.message}})()`);
ok("...the game's own canvas is inside it", !!(dinoDoc && dinoDoc.canvas), JSON.stringify(dinoDoc));
ok("...and it is skinned to this site's ground, not Chrome's white",
   !!(dinoDoc && /rgb\(8, 15, 20\)/.test(dinoDoc.bg || "")), dinoDoc && dinoDoc.bg);
/* The licence has to travel with the build -- BSD-3 requires the notice be
   retained, and a vendored game whose LICENSE got tidied away is the failure
   nobody notices until somebody else does. */
const lic = await (await fetch(`http://127.0.0.1:${PORT}/arcade/dino/LICENSE.txt`)).text();
ok("the BSD-3 licence is served beside the build", /BSD 3-Clause/.test(lic));
ok("...with the copyright notice intact", /Copyright \(c\)/.test(lic));
await ev(`document.getElementById("arClose").click()`);
await wait(300);
ok("closing the vendored cabinet blanks the frame",
   (await ev(`document.querySelectorAll("#arStage iframe").length`)) === 0);

await send("Emulation.setDeviceMetricsOverride",{width:390,height:844,deviceScaleFactor:2,mobile:true});
await wait(400);
ok("no horizontal overflow at 390px", await ev(`document.documentElement.scrollWidth <= 391`),
   String(await ev(`document.documentElement.scrollWidth`)));
ok("no uncaught errors", errs.length===0, errs.slice(0,2).join(" | "));
try{ch.kill()}catch{} srv.close(); process.exit(0);
