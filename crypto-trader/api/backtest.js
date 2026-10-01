/* GET /api/backtest?budget=30&n=6&horizon=21&risk=3&fee=…&months=6
   Walk-forward over the same universe the screen uses: no lookahead, fees
   both sides, 0.2% slippage on stops. Cached ten minutes per parameter set. */
import { walkForward, VERSION } from "../public/js/strategy.mjs";
import { memo } from "../lib/feeds.js";
import { analysedUniverse } from "./screen.js";
import { params, send } from "./_util.js";

export default async function handler(req, res) {
  const t0 = Date.now();
  const P = params(req);
  const opts = {
    horizonDays: P.int("horizon", 21, 1, 120), risk: P.int("risk", 3, 1, 5), n: P.int("n", 6, 1, 20),
    budget: P.num("budget", 30, 1, 1e7), feeModel: P.str("fee", "coinbase_advanced_taker"), months: P.int("months", 6, 1, 18),
    calendarId: "bitcoin",
  };
  try {
    const { cands, meta } = await analysedUniverse();
    const key = `bt:${meta.fixture}:${cands.length}:${JSON.stringify(opts)}`;
    const bt = await memo(key, 10 * 60e3, () => walkForward(cands, opts));
    send(res, 200, { ...bt, meta: { updated: new Date().toISOString(), version: VERSION, ms: Date.now() - t0, fixture: !!meta.fixture, reason: meta.reason || null, universe: cands.length, params: opts } },
      meta.fixture ? "no-store" : "public, s-maxage=300, stale-while-revalidate=1800");
  } catch (e) {
    send(res, 500, { error: String(e?.message || e), meta: { ms: Date.now() - t0 } });
  }
}
