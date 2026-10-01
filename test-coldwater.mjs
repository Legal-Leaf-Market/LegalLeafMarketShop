/* Drives /coldwater in real Chromium over raw CDP (no Playwright module here).
   Asserts the price-per-gram tool: the default eighth-vs-ounce rows, ranking,
   the state-average comparison, the "Other" custom-grams path and that the
   custom field cannot collide with the select, escaping, and mobile layout.

   fonts.googleapis.com / fonts.gstatic.com are BLOCKED at the network layer.
   Not to change the page -- because this container's proxy refuses them, the
   render-blocking <link> stalls for ~13s and every script after it waits, which
   reads as "the tool is broken" when it is the sandbox. Blocking them makes the
   test measure the page instead of the proxy. */
import { spawn } from "node:child_process";

import { chromePath, launchChrome } from "./tools/chrome-path.mjs";

process.env.LL_NO_STORE_FETCH = "1";   // never call a real shop from a test; api/ reads it
                                       // per call, so setting it after the imports is fine.
const CHROME = chromePath();
const PORT = 3478, CDP = 9333;
const fails = [];
const ok = (n, c, extra = "") => {
  console.log(`${c ? "  PASS" : "  FAIL"}  ${n}${extra ? "   (" + extra + ")" : ""}`);
  if (!c) fails.push(n);
};
const wait = ms => new Promise(r => setTimeout(r, ms));
async function until(fn, n = 80){ for (let i=0;i<n;i++){ try { return await fn(); } catch { await wait(250); } } throw new Error("timeout"); }

const srv = spawn(process.execPath, ["server.mjs"], { env:{...process.env, PORT:String(PORT)}, stdio:"ignore" });
/* LAUNCHED THROUGH THE SHARED HELPER, which waits long enough for a cold
   start on a loaded runner and keeps the browser's stderr. Spawning here
   with stdio "ignore" and a 15s poll is what produced "Chromium did not
   start" on a machine whose Chrome answered --version perfectly. */
const { proc: chrome } = await launchChrome(CDP, [], { userDataDir: "/tmp/_cwprof2" });

const target = await until(async () => {
  const j = await (await fetch(`http://127.0.0.1:${CDP}/json/list`)).json();
  const p = j.find(t => t.type === "page");
  if (!p) throw new Error("no page");
  return p;
});
await until(() => fetch(`http://127.0.0.1:${PORT}/coldwater-guide`).then(r => { if (!r.ok) throw 0; return r; }));

const sock = new globalThis.WebSocket(target.webSocketDebuggerUrl);
await new Promise((res, rej) => { sock.addEventListener("open", res); sock.addEventListener("error", rej); });
let id = 0; const pending = new Map(); const errors = [];
sock.addEventListener("message", ev => {
  const m = JSON.parse(ev.data);
  if (m.method === "Runtime.exceptionThrown")
    errors.push(m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
});
const send = (method, params = {}) => new Promise(r => { const i = ++id; pending.set(i, r); sock.send(JSON.stringify({ id:i, method, params })); });
const ev = async expr => (await send("Runtime.evaluate", { expression: expr, returnByValue:true })).result?.result?.value;

await send("Runtime.enable"); await send("Page.enable"); await send("Network.enable");
await send("Network.setBlockedURLs", { urls: ["*fonts.googleapis.com*", "*fonts.gstatic.com*"] });

await send("Page.navigate", { url:`http://127.0.0.1:${PORT}/coldwater-guide` });
await until(async () => { if (await ev(`document.readyState==='complete'`)) return true; throw 0; });
await ev(`localStorage.setItem('ll_age_ok','1')`);
await send("Page.navigate", { url:`http://127.0.0.1:${PORT}/coldwater-guide` });
await until(async () => { if (await ev(`document.querySelectorAll('.cw-row').length>0`)) return true; throw 0; });

console.log("\n/coldwater-guide — price-per-gram tool\n");

ok("page rendered", await ev(`!!document.querySelector('.cw-hero h1')`));
ok("age gate not blocking", !(await ev(`!!document.querySelector('.llg-overlay,[id*=llg]')`)));
ok("opens with two rows", (await ev(`document.querySelectorAll('.cw-row').length`)) === 2);
ok("row 1 defaults to the eighth", (await ev(`document.querySelectorAll('.cw-row')[0].querySelector('.cw-wt').value`)) === "3.5");
ok("row 2 defaults to the ounce", (await ev(`document.querySelectorAll('.cw-row')[1].querySelector('.cw-wt').value`)) === "28");
ok("output hidden before input", await ev(`document.getElementById('cwOut').hidden`));

await ev(`(()=>{const r=document.querySelectorAll('.cw-row');
  const set=(el,v)=>{el.value=v;el.dispatchEvent(new Event('input',{bubbles:true}));};
  set(r[0].querySelector('.cw-nm'),'Shop A');set(r[0].querySelector('.cw-pr'),'35');
  set(r[1].querySelector('.cw-nm'),'Shop B');set(r[1].querySelector('.cw-pr'),'58');})()`);
await wait(200);

ok("output appears", !(await ev(`document.getElementById('cwOut').hidden`)));
const pgs = await ev(`[...document.querySelectorAll('#cwList .pg')].map(e=>e.textContent)`);
ok("$58 ounce ranks first at $2.07/g", pgs[0] === "$2.07/g", `order ${JSON.stringify(pgs)}`);
ok("$35 eighth computes to $10.00/g", pgs[1] === "$10.00/g", `got ${pgs[1]}`);
ok("winner flagged", await ev(`document.querySelector('#cwList li').classList.contains('win')`));
ok("winner is Shop B", (await ev(`document.querySelector('#cwList li .nm').textContent`)).indexOf("Shop B") === 0);
const vs = await ev(`[...document.querySelectorAll('#cwList .vs')].map(e=>e.textContent)`);
ok("eighth flagged against the state average", /4\.8× the Michigan average/.test(vs[1]), vs[1]);
ok("ounce reads as about average", /about the Michigan average/.test(vs[0]), vs[0]);
ok("hint states the multiple", /4\.8× better value/.test(await ev(`document.getElementById('cwHint').textContent`)));

await ev(`(()=>{const s=document.querySelectorAll('.cw-row')[0].querySelector('.cw-wt');
  s.value='0';s.dispatchEvent(new Event('change',{bubbles:true}));})()`);
await wait(200);
ok("Other appends a grams field", await ev(`!!document.querySelector('.cw-wtx')`));
ok("it lands inside the weight cell", (await ev(`document.querySelector('.cw-wtx').parentNode.className`)) === "cw-wt-cell");
ok("row still has 4 grid children", (await ev(`document.querySelectorAll('.cw-row')[0].children.length`)) === 4);
ok("select and grams field do not overlap", await ev(`(()=>{
  const c=document.querySelector('.cw-wtx'),s=document.querySelector('.cw-row .cw-wt');
  return c.getBoundingClientRect().top >= s.getBoundingClientRect().bottom-1;})()`));

await ev(`(()=>{const c=document.querySelector('.cw-wtx');c.value='14';c.dispatchEvent(new Event('input',{bubbles:true}));})()`);
await wait(200);
ok("custom grams recompute ($35 / 14 g = $2.50)",
   (await ev(`[...document.querySelectorAll('#cwList .pg')].map(e=>e.textContent)`)).indexOf("$2.50/g") >= 0);

await ev(`document.getElementById('cwAdd').click()`); await wait(150);
ok("Add another appends a row", (await ev(`document.querySelectorAll('.cw-row').length`)) === 3);
await ev(`document.querySelectorAll('.cw-row')[2].querySelector('.cw-del').click()`); await wait(150);
ok("remove deletes it", (await ev(`document.querySelectorAll('.cw-row').length`)) === 2);
await ev(`document.getElementById('cwReset').click()`); await wait(200);
ok("Clear all resets to the default pair",
   (await ev(`document.querySelectorAll('.cw-row').length`)) === 2 && (await ev(`document.getElementById('cwOut').hidden`)));

await ev(`(()=>{const r=document.querySelectorAll('.cw-row')[0];
  const set=(el,v)=>{el.value=v;el.dispatchEvent(new Event('input',{bubbles:true}));};
  set(r.querySelector('.cw-nm'),'<img src=x onerror=window.__xss=1>');set(r.querySelector('.cw-pr'),'20');})()`);
await wait(250);
ok("typed label cannot inject markup", await ev(`window.__xss===undefined && !document.querySelector('#cwList img')`));

await send("Emulation.setDeviceMetricsOverride", { width:390, height:844, deviceScaleFactor:2, mobile:true });
await wait(400);
ok("no horizontal overflow at 390px", (await ev(`document.documentElement.scrollWidth <= 391`)),
   `scrollWidth ${await ev(`document.documentElement.scrollWidth`)}`);
ok("tables scroll inside their own container, not the page",
   await ev(`[...document.querySelectorAll('.cw-scroll')].every(e=>getComputedStyle(e).overflowX==='auto')`));

ok("no uncaught page errors", errors.length === 0, errors.join(" | ").slice(0, 200));

console.log(`\n${fails.length ? "FAILED: " + fails.join(", ") : "All " + (24 - fails.length) + " assertions passed."}\n`);
chrome.kill(); srv.kill();
process.exit(fails.length ? 1 : 0);
