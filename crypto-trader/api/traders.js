/* GET /api/traders            top wallets on Hyperliquid by 30-day PnL
   GET /api/traders?user=0x…   one wallet's open positions and recent fills
   Read-only. Every number here is on-chain and public; the point is that these
   are the only "top traders" whose trades can be watched rather than believed. */
import { hlLeaderboard, hlInfo, memo } from "../lib/feeds.js";
import { params, send } from "./_util.js";

/* sample wallets so the tab can be exercised offline; flagged, never live */
function fixtureTraders(user) {
  const now = Date.now();
  const rows = [
    { address: "0xd475000000000000000000000000000000001a91", name: "sample-whale-1", accountValue: 52.2e6, w: { day: { pnl: 310000, roi: 0.006, vlm: 4.1e8 }, week: { pnl: 2.4e6, roi: 0.047, vlm: 2.9e9 }, month: { pnl: 10.99e6, roi: 0.2768, vlm: 1.2e10 }, allTime: { pnl: 61e6, roi: 1.9, vlm: 9e10 } } },
    { address: "0xb83d000000000000000000000000000000006e36", name: null, accountValue: 105.2e6, w: { day: { pnl: -120000, roi: -0.001, vlm: 6e8 }, week: { pnl: 1.1e6, roi: 0.011, vlm: 4e9 }, month: { pnl: 5.6e6, roi: 0.056, vlm: 2.1e10 }, allTime: { pnl: 140e6, roi: 3.2, vlm: 2e11 } } },
    { address: "0x4c78000000000000000000000000000000002444", name: "sample-3", accountValue: 9.74e6, w: { day: { pnl: 45000, roi: 0.005, vlm: 9e7 }, week: { pnl: 800000, roi: 0.09, vlm: 6e8 }, month: { pnl: 4.89e6, roi: 1.01, vlm: 3e9 }, allTime: { pnl: 8.1e6, roi: 4.9, vlm: 1.1e10 } } },
  ];
  if (!user) return { rows, meta: { fixture: true, updated: new Date().toISOString(), note: "sample wallets; live data needs egress to hyperliquid.xyz" } };
  if (/^0x0+$/.test(user)) return { user, accountValue: 0, withdrawable: 0, positions: [], fills: [], vault: null, fixture: true, meta: { fixture: true, updated: new Date().toISOString() } };
  return { user, accountValue: 52.2e6, withdrawable: 12e6, fixture: true,
    positions: [ { coin: "BTC", side: "long", size: 120, entry: 108500, value: 13.4e6, uPnl: 410000, roe: 0.09, leverage: "5x cross", liq: 91200 }, { coin: "SOL", side: "long", size: 40000, entry: 214.2, value: 9.1e6, uPnl: 620000, roe: 0.21, leverage: "3x cross", liq: 150.1 }, { coin: "ETH", side: "short", size: 500, entry: 4410, value: 2.2e6, uPnl: -38000, roe: -0.05, leverage: "3x cross", liq: 5900 } ],
    fills: Array.from({ length: 12 }, (_, i) => ({ t: now - i * 37 * 60e3, coin: ["BTC", "SOL", "ETH"][i % 3], dir: ["Open Long", "Close Long", "Open Short", "Close Short"][i % 4], side: i % 2 ? "sell" : "buy", px: [108500, 214.2, 4410][i % 3] * (1 + ((i * 7) % 5 - 2) / 400), sz: [0.8, 300, 4][i % 3], pnl: ((i * 13) % 7 - 3) * 1200, fee: 11 })),
    meta: { fixture: true, updated: new Date().toISOString() } };
}

export default async function handler(req, res) {
  const t0 = Date.now();
  const P = params(req);
  const user = P.str("user", "").trim();
  const minAccount = P.num("min", 250000, 0, 1e13);
  const maxAccount = P.num("max", Infinity, 0, 1e13);
  const limit = P.int("limit", 25, 1, 100);
  if (process.env.CT_FIXTURE === "1") return send(res, 200, fixtureTraders(user));
  try {
    if (user) {
      if (!/^0x[0-9a-fA-F]{40}$/.test(user)) return send(res, 400, { error: "user must be a 0x address" });
      const [st, fl] = await Promise.all([
        memo(`hl:state:${user}`, 60e3, () => hlInfo({ type: "clearinghouseState", user })),
        memo(`hl:fills:${user}`, 60e3, () => hlInfo({ type: "userFills", user })),
      ]);
      const s = st.json || {};
      const positions = (s.assetPositions || []).map(ap => {
        const p = ap.position || ap;
        const szi = +p.szi;
        return { coin: p.coin, side: szi > 0 ? "long" : szi < 0 ? "short" : "flat", size: Math.abs(szi), entry: +p.entryPx, value: +p.positionValue,
          uPnl: +p.unrealizedPnl, roe: +p.returnOnEquity, leverage: p.leverage ? `${p.leverage.value}x ${p.leverage.type}` : null, liq: p.liquidationPx != null ? +p.liquidationPx : null };
      }).filter(p => p.side !== "flat");
      const fills = (Array.isArray(fl.json) ? fl.json : []).slice(0, 40).map(f => ({ t: f.time, coin: f.coin, dir: f.dir, side: f.side === "B" ? "buy" : "sell", px: +f.px, sz: +f.sz, pnl: +f.closedPnl, fee: +f.fee }));
      /* THE BIGGEST ROWS ON THE LEADERBOARD ARE VAULTS. Measured live: a $1.1B
         leaderboard row whose clearinghouseState on the main perp book is
         zero. A vault's trades belong to its leader, so say so and hand the
         leader's address over rather than printing "flat right now". */
      let vault = null;
      if (!positions.length && !(+(s.marginSummary?.accountValue ?? 0) > 0)) {
        try {
          const v = await memo(`hl:vault:${user}`, 10 * 60e3, () => hlInfo({ type: "vaultDetails", vaultAddress: user }));
          if (v.json && v.json.name) vault = { name: v.json.name, leader: v.json.leader || null, apr: v.json.apr ?? null, description: String(v.json.description || "").slice(0, 300) };
        } catch { /* not a vault, or the endpoint refused: the empty state stands */ }
      }
      return send(res, 200, {
        user, accountValue: +(s.marginSummary?.accountValue ?? 0), withdrawable: +(s.withdrawable ?? 0), positions, fills, vault,
        meta: { updated: new Date().toISOString(), ms: Date.now() - t0, state: st.ms, fillsMs: fl.ms },
      }, "public, s-maxage=30");
    }
    const lb = await memo("hl:leaderboard", 10 * 60e3, () => hlLeaderboard());
    const rows = lb.rows.filter(r => r.accountValue >= minAccount && r.accountValue <= maxAccount && r.w.month)
      .sort((a, b) => (b.w.month?.pnl ?? 0) - (a.w.month?.pnl ?? 0)).slice(0, limit);
    send(res, 200, { rows, meta: { updated: new Date().toISOString(), ms: Date.now() - t0, upstreamMs: lb.ms, total: lb.total, minAccount, maxAccount: Number.isFinite(maxAccount) ? maxAccount : null } }, "public, s-maxage=300, stale-while-revalidate=900");
  } catch (e) {
    send(res, 502, { error: String(e?.message || e), status: e?.status || null, meta: { ms: Date.now() - t0 } });
  }
}
