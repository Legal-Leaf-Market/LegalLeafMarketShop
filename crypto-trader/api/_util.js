/* api/_util.js — request parsing and the JSON reply, shared by every handler.
   Not a route: Vercel builds a function for every file in api/, so this one
   answers 404 if it is ever called directly. */
export function params(req) {
  const u = new URL(req.url || "/", "http://local");
  const q = u.searchParams;
  const int = (k, d, lo, hi) => { const v = parseInt(q.get(k), 10); return Number.isFinite(v) ? Math.max(lo, Math.min(hi, v)) : d; };
  const num = (k, d, lo, hi) => { const v = parseFloat(q.get(k)); return Number.isFinite(v) ? Math.max(lo, Math.min(hi, v)) : d; };
  return { q, int, num, has: (k) => q.has(k), str: (k, d = "") => q.get(k) ?? d };
}
export function send(res, status, body, cache = "no-store") {
  res.statusCode = status;
  res.setHeader("content-type", "application/json; charset=utf-8");
  res.setHeader("cache-control", cache);
  res.setHeader("x-content-type-options", "nosniff");
  res.end(JSON.stringify(body));
}
export async function readBody(req) {
  if (req.body !== undefined) return typeof req.body === "string" ? safeJson(req.body) : req.body;
  const chunks = [];
  for await (const c of req) chunks.push(c);
  return safeJson(Buffer.concat(chunks).toString("utf8"));
}
function safeJson(s) { try { return s ? JSON.parse(s) : {}; } catch { return {}; } }
export default function handler(req, res) { send(res, 404, { error: "not a route" }); }
