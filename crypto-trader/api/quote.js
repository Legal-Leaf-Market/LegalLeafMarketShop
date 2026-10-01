/* GET /api/quote?ids=BTC-USD,ETH-USD — last trade per product from Coinbase's
   REST ticker. The browser prefers the exchange's own WebSocket (no server in
   the path, so no added lag); this is the fallback when a network blocks it. */
import { coinbaseTicker, memo } from "../lib/feeds.js";
import { fixtureUniverse } from "../lib/fixture.js";
import { params, send } from "./_util.js";

export default async function handler(req, res) {
  const P = params(req);
  const ids = [...new Set(P.str("ids", "").toUpperCase().split(",").map(s => s.trim()).filter(s => /^[A-Z0-9]{2,12}-USD$/.test(s)))].slice(0, 12);
  if (!ids.length) return send(res, 400, { error: "ids=BTC-USD,ETH-USD" });
  if (process.env.CT_FIXTURE === "1") {
    const uni = fixtureUniverse();
    const quotes = ids.map(id => { const u = uni.find(x => x.product === id); const c = u?.candles.at(-1); return c ? { product: id, price: c.c * (1 + (Math.random() - 0.5) * 0.004), time: new Date().toISOString(), fixture: true } : { product: id, error: "unknown" }; });
    return send(res, 200, { quotes, meta: { fixture: true } });
  }
  const quotes = await Promise.all(ids.map(id => memo(`cb:ticker:${id}`, 4000, () => coinbaseTicker(id)).catch(e => ({ product: id, error: String(e?.message || e) }))));
  send(res, 200, { quotes, meta: { fixture: false, updated: new Date().toISOString() } }, "public, s-maxage=4");
}
