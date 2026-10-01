/* server.mjs — LOCAL PREVIEW ONLY. Vercel never runs this; it serves public/
   statically and runs each file in api/ as a function. This mirrors that: clean
   URLs (/playbook -> public/playbook.html) and /api/<name> -> api/<name>.js.
   Handlers are imported once and cached, as on Vercel; set CT_DEV_RELOAD=1 to
   re-import on every request while editing api/. */
import http from "node:http";
import { readFile, stat } from "node:fs/promises";
import { join, extname, normalize } from "node:path";
import { pathToFileURL } from "node:url";

const PORT = +(process.env.PORT || 8788);
const ROOT = new URL(".", import.meta.url).pathname;
const PUB = join(ROOT, "public");
const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".mjs": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".json": "application/json", ".webmanifest": "application/manifest+json", ".svg": "image/svg+xml", ".png": "image/png", ".txt": "text/plain; charset=utf-8", ".ico": "image/x-icon" };
const handlers = new Map();

async function handlerFor(name) {
  if (!/^[a-z0-9-]+$/.test(name)) return null;
  if (process.env.CT_DEV_RELOAD !== "1" && handlers.has(name)) return handlers.get(name);
  const file = join(ROOT, "api", `${name}.js`);
  try { await stat(file); } catch { return null; }
  const mod = await import(pathToFileURL(file).href + (process.env.CT_DEV_RELOAD === "1" ? `?v=${Date.now()}` : ""));
  handlers.set(name, mod.default);
  return mod.default;
}

async function serveStatic(res, pathname) {
  let p = normalize(decodeURIComponent(pathname)).replace(/^(\.\.[/\\])+/, "");
  if (p === "/" || p === "") p = "/index.html";
  const tries = [p, `${p}.html`, `${p}/index.html`];
  for (const t of tries) {
    const file = join(PUB, t);
    if (!file.startsWith(PUB)) continue;
    try {
      const s = await stat(file);
      if (!s.isFile()) continue;
      const body = await readFile(file);
      res.writeHead(200, { "content-type": TYPES[extname(file)] || "application/octet-stream", "cache-control": "no-cache" });
      return res.end(body);
    } catch { /* next */ }
  }
  res.writeHead(404, { "content-type": "text/plain" });
  res.end("not found");
}

http.createServer(async (req, res) => {
  const u = new URL(req.url, `http://localhost:${PORT}`);
  // the same conveniences Vercel's node runtime adds
  res.status = (c) => { res.statusCode = c; return res; };
  res.json = (b) => { res.setHeader("content-type", "application/json; charset=utf-8"); res.end(JSON.stringify(b)); };
  if (u.pathname.startsWith("/api/")) {
    const name = u.pathname.slice(5).replace(/\/.*$/, "");
    const h = await handlerFor(name);
    if (!h) { res.writeHead(404, { "content-type": "application/json" }); return res.end(JSON.stringify({ error: `no api/${name}.js` })); }
    try { await h(req, res); } catch (e) { console.error(e); if (!res.headersSent) res.writeHead(500, { "content-type": "application/json" }); res.end(JSON.stringify({ error: String(e?.message || e) })); }
    return;
  }
  return serveStatic(res, u.pathname);
}).listen(PORT, "127.0.0.1", () => console.log(`popping preview http://127.0.0.1:${PORT}  (CT_FIXTURE=${process.env.CT_FIXTURE || "0"})`));
