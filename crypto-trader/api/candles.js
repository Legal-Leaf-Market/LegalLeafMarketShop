/* GET /api/candles?id=BTC-USD&g=86400&bars=400 — Coinbase bars, oldest first.
   The Live tab reads daily bars to rebuild a position's trailing stop from the
   highest high since entry, so the trail does not depend on a tab having been
   open. Hourly bars (g=3600) seed the "popping" window. */
import { coinbaseCandles, memo } from "../lib/feeds.js";
import { fixtureUniverse } from "../lib/fixture.js";
import { params, send } from "./_util.js";

export default async function handler(req, res) {
  const P = params(req);
  const id = P.str("id", "").toUpperCase();
  const g = [60, 300, 900, 3600, 21600, 86400].includes(P.int("g", 86400, 60, 86400)) ? P.int("g", 86400, 60, 86400) : 86400;
  const bars = P.int("bars", 400, 10, 900);
  if (!/^[A-Z0-9]{2,12}-USD$/.test(id)) return send(res, 400, { error: "id must look like BTC-USD" });
  if (process.env.CT_FIXTURE === "1") {
    const f = fixtureUniverse().find(u => u.product === id);
    if (!f) return send(res, 404, { error: "not in the fixture universe", fixture: true });
    return send(res, 200, { id, g: 86400, candles: f.candles.slice(-bars), meta: { fixture: true } });
  }
  try {
    const candles = await memo(`cb:candles:${id}:${g}:${bars}`, g >= 86400 ? 5 * 60e3 : 60e3, () => coinbaseCandles(id, { granularity: g, bars }));
    send(res, 200, { id, g, candles, meta: { fixture: false, count: candles.length } }, "public, s-maxage=60, stale-while-revalidate=300");
  } catch (e) {
    send(res, 502, { error: String(e?.message || e), id, status: e?.status || null });
  }
}
