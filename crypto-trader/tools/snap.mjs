/* tools/snap.mjs — screenshots of the app on sample data at phone width.
   node tools/snap.mjs <outdir>  (boots its own server on 8793) */
import { spawn } from "node:child_process";
import { writeFileSync, mkdirSync } from "node:fs";
import { launchChrome, CDP } from "./chrome.mjs";
const out = process.argv[2] || "."; mkdirSync(out, { recursive: true });
const PORT = 8793;
const srv = spawn(process.execPath, [new URL("../server.mjs", import.meta.url).pathname], { env: { ...process.env, PORT, CT_FIXTURE: "1", CT_NO_FETCH: "1" }, stdio: "ignore" });
const base = `http://127.0.0.1:${PORT}`;
for (let i = 0; i < 200; i++) { try { await fetch(base + "/api/quote?ids=BTC-USD"); break; } catch { await new Promise(r => setTimeout(r, 50)); } }
const chrome = await launchChrome({ port: 9339 });
const cdp = new CDP(chrome.wsUrl); await cdp.ready;
await cdp.send("Runtime.enable"); await cdp.send("Page.enable"); await cdp.send("Network.enable");
await cdp.send("Network.setBlockedURLs", { urls: ["*coingecko.com*", "*coinbase.com*", "*hyperliquid.xyz*"] });
await cdp.send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
async function snap(name, full = false) { const r = await cdp.send("Page.captureScreenshot", { format: "png", captureBeyondViewport: full }); writeFileSync(`${out}/${name}.png`, Buffer.from(r.data, "base64")); console.log("wrote", name); }
await cdp.send("Page.navigate", { url: base + "/#plan" });
await cdp.waitFor("document.querySelectorAll('.pick').length === 6");
await new Promise(r => setTimeout(r, 300));
await snap("plan");
await cdp.eval("window.scrollTo(0, 620); true"); await new Promise(r => setTimeout(r, 200)); await snap("plan-picks");
await cdp.eval("document.querySelector('#trackBtn').click(); true");
await cdp.waitFor("document.querySelector('#trackDialog').open");
await snap("track-dialog");
await cdp.eval("document.querySelector('#trackDialog').close('ok'); true");
await cdp.waitFor("location.hash === '#live' && [...document.querySelectorAll('.pos [data-pnl]')].every(e => /%/.test(e.textContent))", { timeout: 20000 });
await cdp.waitFor("[...document.querySelectorAll('.pos .meta')].every(m => /trend (intact|broken)/.test(m.textContent))", { timeout: 20000 });
await cdp.eval("window.scrollTo(0, 0); true"); await snap("live");
await cdp.eval("location.hash = '#test'; true"); await cdp.waitFor("!document.querySelector('#tab-test').hidden");
await cdp.eval("document.querySelector('#btBtn').click(); true");
await cdp.waitFor("!document.querySelector('#btOut').hidden && document.querySelector('#btStats').textContent.includes('Result')", { timeout: 20000 });
await cdp.eval("window.scrollTo(0, 260); true"); await new Promise(r => setTimeout(r, 200)); await snap("test");
await cdp.eval("location.hash = '#traders'; true"); await cdp.waitFor("document.querySelectorAll('.trader').length >= 3");
await cdp.eval("document.querySelector('.trader').click(); true");
await cdp.waitFor("document.querySelector('#traderDetail').textContent.includes('Open positions')");
await cdp.eval("window.scrollTo(0, 0); true"); await snap("traders");
await cdp.send("Page.navigate", { url: base + "/playbook" }); await cdp.waitFor("document.querySelector('h1')"); await snap("playbook");
cdp.close(); chrome.proc.kill(); srv.kill();
