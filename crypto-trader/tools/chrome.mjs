/* tools/chrome.mjs — where Chromium is, and a raw CDP client. No Playwright
   import, which is what keeps `dependencies` empty. Needs Node 22 for the
   global WebSocket. */
import { existsSync, readdirSync, statSync } from "node:fs";
import { spawn } from "node:child_process";
import { join } from "node:path";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";

export function chromePath() {
  const root = process.env.PLAYWRIGHT_BROWSERS_PATH || "/opt/pw-browsers";
  let builds = [];
  try {
    builds = readdirSync(root).filter(n => /^chromium(-|$)/.test(n)).sort((a, b) => (parseInt(b.replace(/\D/g, ""), 10) || 0) - (parseInt(a.replace(/\D/g, ""), 10) || 0)).map(n => join(root, n, "chrome-linux", "chrome"));
  } catch {}
  const cands = [process.env.CHROME_PATH, process.env.CHROMIUM_PATH, ...builds, join(root, "chromium"), "/usr/bin/chromium", "/usr/bin/chromium-browser", "/usr/bin/google-chrome", "/usr/bin/google-chrome-stable"].filter(Boolean);
  for (const p of cands) { try { if (existsSync(p) && statSync(p).isFile()) return p; } catch {} }
  throw new Error("no Chromium found; set CHROME_PATH");
}

export async function launchChrome({ port = 9333 } = {}) {
  const dir = mkdtempSync(join(tmpdir(), "popping-chrome-"));
  const proc = spawn(chromePath(), ["--headless=new", "--no-sandbox", "--disable-gpu", "--disable-dev-shm-usage", "--no-first-run", "--no-default-browser-check", `--remote-debugging-port=${port}`, `--user-data-dir=${dir}`, "--window-size=420,900", "about:blank"], { stdio: ["ignore", "pipe", "pipe"] });
  let err = ""; proc.stderr.on("data", d => err += d);
  for (let i = 0; i < 200; i++) {
    try {
      const r = await fetch(`http://127.0.0.1:${port}/json/list`);
      const list = await r.json();
      const page = list.find(t => t.type === "page");
      if (page) return { proc, wsUrl: page.webSocketDebuggerUrl };
    } catch {}
    if (proc.exitCode != null) throw new Error("Chromium exited: " + err.slice(-400));
    await new Promise(r => setTimeout(r, 100));
  }
  proc.kill(); throw new Error("Chromium did not expose a page target\n" + err.slice(-400));
}

export class CDP {
  constructor(wsUrl) { this.ws = new globalThis.WebSocket(wsUrl); this.id = 0; this.pending = new Map(); this.listeners = new Map(); this.ready = new Promise((res, rej) => { this.ws.onopen = res; this.ws.onerror = (e) => rej(new Error("cdp ws error")); }); this.ws.onmessage = (m) => { const d = JSON.parse(m.data); if (d.id && this.pending.has(d.id)) { const { res, rej } = this.pending.get(d.id); this.pending.delete(d.id); d.error ? rej(new Error(d.error.message)) : res(d.result); } else if (d.method) { for (const fn of this.listeners.get(d.method) || []) fn(d.params); } }; }
  send(method, params = {}) { const id = ++this.id; this.ws.send(JSON.stringify({ id, method, params })); return new Promise((res, rej) => this.pending.set(id, { res, rej })); }
  on(method, fn) { if (!this.listeners.has(method)) this.listeners.set(method, []); this.listeners.get(method).push(fn); }
  async eval(expr) { const r = await this.send("Runtime.evaluate", { expression: expr, awaitPromise: true, returnByValue: true }); if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || "eval failed"); return r.result.value; }
  async waitFor(expr, { timeout = 15000, every = 150 } = {}) { const t0 = Date.now(); for (;;) { const v = await this.eval(expr).catch(() => undefined); if (v) return v; if (Date.now() - t0 > timeout) throw new Error(`timeout waiting for: ${expr}`); await new Promise(r => setTimeout(r, every)); } }
  close() { try { this.ws.close(); } catch {} }
}
