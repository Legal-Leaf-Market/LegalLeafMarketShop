/* test-app.mjs — the whole flow in real Chromium against the sample universe:
   the screen renders six picks, tracking them lands on Live with quotes,
   the walk-forward draws, the traders tab reads a wallet, and the console
   stays clean. `node test-app.mjs` (Node 22+, Chromium on the machine). */
import { spawn } from "node:child_process";
import { launchChrome, CDP } from "./tools/chrome.mjs";

const PORT = 8792, CDP_PORT = 9337;
const srv = spawn(process.execPath, ["server.mjs"], { env: { ...process.env, PORT, CT_FIXTURE: "1", CT_NO_FETCH: "1" }, stdio: ["ignore", "pipe", "pipe"] });
let slog = ""; srv.stdout.on("data", d => slog += d); srv.stderr.on("data", d => slog += d);
const base = `http://127.0.0.1:${PORT}`;
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log("  FAIL:", m); } };
let chrome = null, cdp = null;
try {
  for (let i = 0; i < 200; i++) { try { await fetch(base + "/api/quote?ids=BTC-USD"); break; } catch { await new Promise(r => setTimeout(r, 50)); } }
  chrome = await launchChrome({ port: CDP_PORT });
  cdp = new CDP(chrome.wsUrl); await cdp.ready;
  const errors = [];
  await cdp.send("Runtime.enable"); await cdp.send("Page.enable"); await cdp.send("Log.enable"); await cdp.send("Network.enable");
  await cdp.send("Network.setBlockedURLs", { urls: ["*fonts.googleapis.com*", "*coingecko.com*", "*coinbase.com*", "*hyperliquid.xyz*"] });
  cdp.on("Runtime.exceptionThrown", p => errors.push("exception: " + (p.exceptionDetails.exception?.description || p.exceptionDetails.text)));
  cdp.on("Log.entryAdded", p => { if (p.entry.level === "error") errors.push(`${p.entry.source}: ${p.entry.text}`); });
  cdp.on("Runtime.consoleAPICalled", p => { if (p.type === "error") errors.push("console.error: " + p.args.map(a => a.value || a.description).join(" ")); });
  await cdp.send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });

  console.log("# plan");
  await cdp.send("Page.navigate", { url: base + "/#plan" });
  await cdp.waitFor("document.querySelectorAll('.pick').length === 6");
  ok(true, "six picks rendered");
  ok(await cdp.eval("!document.querySelector('#fixtureBanner').hidden"), "sample-data banner shown");
  ok(await cdp.eval("/\\$\\d/.test(document.querySelector('#costCard').textContent) && document.querySelector('#costCard').textContent.includes('Buy button')"), "cost card names the fee and warns about the simple button");
  ok(await cdp.eval("document.querySelectorAll('.pick .spark').length === 6"), "sparklines drawn");
  ok(await cdp.eval("document.querySelector('#alsoRan').textContent.includes('pegged')"), "also-looked-at lists the stablecoin's refusal");
  ok(await cdp.eval("document.documentElement.scrollWidth <= 390"), "no horizontal overflow at 390px");
  // move the sliders: 3 coins, careful, 1 week
  await cdp.eval("const c=document.querySelector('#coins'); c.value=3; c.dispatchEvent(new Event('input')); const r=document.querySelector('#risk'); r.value=1; r.dispatchEvent(new Event('input')); const h=document.querySelector('#horizon'); h.value=2; h.dispatchEvent(new Event('input')); document.querySelector('#pickBtn').click(); true");
  await cdp.waitFor("document.querySelectorAll('.pick').length === 3 && document.querySelector('#pickBtn').textContent === 'Pick my 3'");
  ok(await cdp.eval("document.querySelector('#horizonOut').textContent === '1 week' && document.querySelector('#riskOut').textContent === 'Careful'"), "slider labels follow the sliders");
  ok(await cdp.eval("JSON.parse(localStorage.getItem('ct:settings')).n === 3"), "settings remembered");

  console.log("# track -> live");
  await cdp.eval("document.querySelector('#trackBtn').click(); true");
  await cdp.waitFor("document.querySelector('#trackDialog').open");
  ok(await cdp.eval("document.querySelectorAll('#trackRows input').length === 3"), "the dialog asks for three fill prices");
  await cdp.eval("document.querySelector('#trackDialog').close('ok'); true");
  await cdp.waitFor("location.hash === '#live' && document.querySelectorAll('.pos').length === 3");
  ok(true, "three positions on the Live tab");
  await cdp.waitFor("[...document.querySelectorAll('.pos [data-pnl]')].every(e => /%/.test(e.textContent))", { timeout: 20000 });
  ok(true, "quotes arrived (polling on sample data) and P&L is printed");
  ok(await cdp.eval("document.querySelector('#feedSource').textContent.includes('sample')"), "the feed pill says it is on sample prices");
  ok(await cdp.eval("JSON.parse(localStorage.getItem('ct:positions')).length === 3"), "positions persisted");
  await cdp.waitFor("[...document.querySelectorAll('.pos .meta')].every(m => /trend (intact|broken)/.test(m.textContent))", { timeout: 20000 });
  ok(true, "daily trend check ran for every position");
  // force a stop through the page's own state: a stop above the price must produce a sell alert on the next tick
  await cdp.eval("(() => { const p = window.__popping.positions[0]; p.stop = p.entry * 1.5; return true; })()");
  await cdp.waitFor("document.querySelector('#alerts li.sell') && document.querySelector('#alerts li.sell').textContent.includes('stop hit')", { timeout: 20000 });
  ok(true, "a stop above the price produces a sell alert on the next tick");
  ok(await cdp.eval("JSON.parse(localStorage.getItem('ct:alerts')).length >= 1 && document.querySelector('#toast').textContent.includes('stop hit')"), "the alert is persisted and toasted");

  console.log("# test tab");
  await cdp.eval("location.hash = '#test'; true");
  await cdp.waitFor("!document.querySelector('#tab-test').hidden");
  await cdp.eval("document.querySelector('#months').value = '3'; document.querySelector('#btBtn').click(); true");
  await cdp.waitFor("!document.querySelector('#btOut').hidden && document.querySelector('#btStats').textContent.includes('Result')", { timeout: 20000 });
  ok(true, "walk-forward ran and rendered stats");
  ok(await cdp.eval("document.querySelectorAll('#btCycles details').length >= 3"), "cycle-by-cycle table");
  ok(await cdp.eval("(() => { const c = document.querySelector('#eq'); const ctx = c.getContext('2d'); const d = ctx.getImageData(0, 0, c.width, c.height).data; let lit = 0; for (let i = 0; i < d.length; i += 4) if (d[i+1] > 150 && d[i] < 100) lit++; return lit > 50; })()"), "the equity curve is actually drawn (green pixels on the canvas)");

  console.log("# traders");
  await cdp.eval("location.hash = '#traders'; true");
  await cdp.waitFor("document.querySelectorAll('.trader').length >= 3");
  ok(true, "leaderboard rows");
  await cdp.eval("document.querySelector('.trader').click(); true");
  await cdp.waitFor("document.querySelector('#traderDetail').textContent.includes('Open positions') && document.querySelectorAll('#traderDetail table').length === 2");
  ok(true, "wallet detail with positions and fills");
  await cdp.eval("document.querySelector('#traderDetail').innerHTML = '<button data-addr=\"0x0000000000000000000000000000000000000000\">empty</button>'; document.querySelector('#traderDetail button').click(); true");
  await cdp.waitFor("document.querySelector('#traderDetail').textContent.includes('Nothing on the main perp book')");
  ok(true, "an empty wallet says why it can read empty instead of 'flat'");

  console.log("# playbook + hygiene");
  await cdp.send("Page.navigate", { url: base + "/playbook" });
  await cdp.waitFor("document.querySelector('h1') && document.querySelector('h1').textContent.includes('Who actually')");
  ok(await cdp.eval("document.querySelectorAll('.who').length === 6 && document.documentElement.scrollWidth <= 390"), "playbook renders its six profiles without overflow");
  const realErrors = errors.filter(e => !/favicon|icon-192|ERR_BLOCKED_BY_CLIENT|net::ERR_/.test(e));
  ok(realErrors.length === 0, "console clean: " + realErrors.join(" | "));
} catch (e) { fail++; console.log("  FAIL:", e.message, "\n", slog.slice(-500)); }
finally { if (cdp) cdp.close(); if (chrome) chrome.proc.kill(); srv.kill(); }
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
