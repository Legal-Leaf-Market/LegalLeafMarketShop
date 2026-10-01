/* GET /api/screen?budget=30&n=6&horizon=21&risk=3&fee=coinbase_advanced_taker[&debug]
   The screen and the plan, in one payload. meta.fixture=true means sample data. */
import { analyse, screen, buildPlan, VERSION } from "../public/js/strategy.mjs";
import { buildUniverse, memo } from "../lib/feeds.js";
import { params, send } from "./_util.js";

export async function analysedUniverse() {
  const uni = await memo("universe", 5 * 60e3, () => buildUniverse());
  const cands = await memo(`analysed:${uni.meta.fixture}:${uni.candidates.length}:${uni.candidates[0]?.candles?.at(-1)?.t}`, 5 * 60e3,
    () => uni.candidates.map(c => ({ ...c, analysis: analyse(c.candles) })));
  return { cands, meta: uni.meta };
}

export default async function handler(req, res) {
  const t0 = Date.now();
  const P = params(req);
  const horizonDays = P.int("horizon", 21, 1, 120);
  const risk = P.int("risk", 3, 1, 5);
  const n = P.int("n", 6, 1, 20);
  const budget = P.num("budget", 30, 1, 1e7);
  const feeModel = P.str("fee", "coinbase_advanced_taker");
  try {
    const { cands, meta } = await analysedUniverse();
    const ranked = screen(cands, { horizonDays, risk });
    const plan = buildPlan(ranked, { budget, n, horizonDays, risk, feeModel });
    const rows = ranked.map(r => {
      const c = cands.find(x => x.id === r.id);
      const closes = c ? c.analysis.closes : [];
      return {
        id: r.id, symbol: r.symbol, name: r.name, rank: r.rank, image: r.image || null, product: r.product || null,
        price: r.price, score: r.score ?? null, excluded: r.excluded || null, why: r.why || null,
        ret7: r.snap?.ret7 ?? null, ret30: r.snap?.ret30 ?? null, vol30: r.snap?.vol30 ?? null,
        trend: r.snap?.trend ?? null, donch: r.snap?.donch ?? null, atrPct: r.snap?.atrPct ?? null, dollarVol30: r.snap?.dollarVol30 ?? null,
        spark: closes.slice(-30),
      };
    });
    const out = {
      plan, ranked: rows,
      meta: {
        updated: new Date().toISOString(), version: VERSION, ms: Date.now() - t0,
        fixture: !!meta.fixture, reason: meta.reason || null, source: meta.source || null, universe: cands.length,
        params: { budget, n, horizonDays, risk, feeModel },
        ...(P.has("debug") ? { upstreams: meta.upstreams } : {}),
      },
    };
    send(res, 200, out, meta.fixture ? "no-store" : "public, s-maxage=120, stale-while-revalidate=600");
  } catch (e) {
    send(res, 500, { error: String(e?.message || e), meta: { ms: Date.now() - t0 } });
  }
}
