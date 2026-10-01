/* lib/fixture.js — a synthetic universe that behaves like the real one.
 *
 * Used by test-strategy.mjs, and by lib/feeds.js when every upstream is
 * unreachable (CT_FIXTURE=1 forces it). The container this app is written in
 * refuses egress to every exchange and price API, so without this the screen,
 * the plan, the backtest and the whole UI could not be exercised at all before
 * the first deploy. Everything produced here is FLAGGED (meta.fixture=true and
 * a banner in the page): sample prices must never be mistaken for a market.
 *
 * Deterministic: mulberry32 seeded per coin, so a test that passed yesterday
 * runs against the same bars today. Each coin has a base drift and vol and a
 * final regime for its last ~45 days, so the screen has real winners and real
 * losers to tell apart, plus a stablecoin and a too-thin coin it must refuse.
 */

export function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
export function gaussian(rng) {
  let u = 0, v = 0;
  while (u === 0) u = rng();
  while (v === 0) v = rng();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

const DAY = 86400e3;

/* GBM daily bars. vol/drift annualised; `late` overrides drift for the last
   `lateDays`; dollarVol is the target mean $ traded per day. */
export function syntheticCandles({ seed = 1, days = 600, start = 100, vol = 0.8, drift = 0, late = null, lateDays = 45, dollarVol = 5e7, endT = null } = {}) {
  const rng = mulberry32(seed);
  const end = endT ?? (Math.floor(Date.now() / DAY) * DAY - DAY);   // yesterday 00:00 UTC, whole days only
  const out = [];
  let c = start;
  for (let i = 0; i < days; i++) {
    const t = end - (days - 1 - i) * DAY;
    const d = late != null && i >= days - lateDays ? late : drift;
    const z = gaussian(rng);
    const r = d / 365 + (vol / Math.sqrt(365)) * z;
    const prev = c;
    c = prev * Math.exp(r);
    const o = prev * (1 + (vol / Math.sqrt(365)) * 0.2 * gaussian(rng));
    const wick = Math.abs(gaussian(rng)) * (vol / Math.sqrt(365)) * 0.5;
    const h = Math.max(o, c) * (1 + wick);
    const l = Math.min(o, c) * (1 - wick);
    const v = (dollarVol * (0.6 + 0.8 * rng())) / c;   // base units so that v*c ≈ dollarVol
    out.push({ t, o, h, l, c, v });
  }
  /* rescale so the LAST close equals `start`: 600 days of drift would otherwise
     put bitcoin at $187k on a sample screen, which reads as a bug */
  const k = start / out[out.length - 1].c;
  return out.map(b => ({ t: b.t, o: b.o * k, h: b.h * k, l: b.l * k, c: b.c * k, v: b.v / k }));
}

export const FIXTURE_COINS = [
  { id: "bitcoin",            symbol: "BTC",    name: "Bitcoin",        rank: 1,   start: 112000, vol: 0.45, drift: 0.30, late: 0.9,  dollarVol: 3.0e10 },
  { id: "ethereum",           symbol: "ETH",    name: "Ethereum",       rank: 2,   start: 4300,   vol: 0.65, drift: 0.20, late: 0.2,  dollarVol: 1.5e10 },
  { id: "ripple",             symbol: "XRP",    name: "XRP",            rank: 3,   start: 3.1,    vol: 0.80, drift: 0.10, late: -1.2, dollarVol: 4.0e9 },
  { id: "solana",             symbol: "SOL",    name: "Solana",         rank: 5,   start: 230,    vol: 0.90, drift: 0.40, late: 2.4,  dollarVol: 5.0e9 },
  { id: "usd-coin",           symbol: "USDC",   name: "USDC",           rank: 6,   start: 1.0,    vol: 0.002, drift: 0,   late: 0,    dollarVol: 8.0e9 },
  { id: "dogecoin",           symbol: "DOGE",   name: "Dogecoin",       rank: 8,   start: 0.26,   vol: 1.10, drift: 0.10, late: -2.0, dollarVol: 2.0e9 },
  { id: "cardano",            symbol: "ADA",    name: "Cardano",        rank: 10,  start: 0.92,   vol: 0.90, drift: 0.00, late: -1.0, dollarVol: 1.0e9 },
  { id: "chainlink",          symbol: "LINK",   name: "Chainlink",      rank: 12,  start: 26,     vol: 0.85, drift: 0.30, late: 2.0,  dollarVol: 8.0e8 },
  { id: "avalanche-2",        symbol: "AVAX",   name: "Avalanche",      rank: 15,  start: 31,     vol: 0.95, drift: 0.10, late: 1.8,  dollarVol: 6.0e8 },
  { id: "sui",                symbol: "SUI",    name: "Sui",            rank: 16,  start: 4.1,    vol: 1.05, drift: 0.50, late: 2.8,  dollarVol: 1.5e9 },
  { id: "bitcoin-cash",       symbol: "BCH",    name: "Bitcoin Cash",   rank: 18,  start: 560,    vol: 0.75, drift: 0.10, late: 0.6,  dollarVol: 5.0e8 },
  { id: "litecoin",           symbol: "LTC",    name: "Litecoin",       rank: 20,  start: 118,    vol: 0.70, drift: 0.05, late: 0.4,  dollarVol: 6.0e8 },
  { id: "uniswap",            symbol: "UNI",    name: "Uniswap",        rank: 22,  start: 11.5,   vol: 0.95, drift: 0.00, late: 1.5,  dollarVol: 4.0e8 },
  { id: "hedera-hashgraph",   symbol: "HBAR",   name: "Hedera",         rank: 24,  start: 0.24,   vol: 1.00, drift: 0.20, late: 2.2,  dollarVol: 3.5e8 },
  { id: "polkadot",           symbol: "DOT",    name: "Polkadot",       rank: 25,  start: 4.6,    vol: 0.85, drift: -0.10, late: -0.8, dollarVol: 3.0e8 },
  { id: "near",               symbol: "NEAR",   name: "NEAR Protocol",  rank: 28,  start: 4.9,    vol: 1.00, drift: 0.10, late: 1.6,  dollarVol: 3.0e8 },
  { id: "aave",               symbol: "AAVE",   name: "Aave",           rank: 30,  start: 310,    vol: 0.95, drift: 0.40, late: 1.2,  dollarVol: 4.0e8 },
  { id: "aptos",              symbol: "APT",    name: "Aptos",          rank: 35,  start: 6.8,    vol: 1.00, drift: -0.20, late: 0.9,  dollarVol: 2.5e8 },
  { id: "cosmos",             symbol: "ATOM",   name: "Cosmos",         rank: 45,  start: 5.9,    vol: 0.90, drift: -0.20, late: -0.5, dollarVol: 1.5e8 },
  { id: "arbitrum",           symbol: "ARB",    name: "Arbitrum",       rank: 50,  start: 0.62,   vol: 1.10, drift: -0.30, late: 1.9,  dollarVol: 3.0e8 },
  { id: "render-token",       symbol: "RENDER", name: "Render",         rank: 55,  start: 5.2,    vol: 1.15, drift: 0.20, late: 2.6,  dollarVol: 1.5e8 },
  { id: "optimism",           symbol: "OP",     name: "Optimism",       rank: 60,  start: 1.15,   vol: 1.10, drift: -0.30, late: 0.3,  dollarVol: 1.5e8 },
  { id: "fetch-ai",           symbol: "FET",    name: "Fetch.ai",       rank: 65,  start: 1.08,   vol: 1.25, drift: 0.10, late: 3.2,  dollarVol: 1.2e8 },
  { id: "injective-protocol", symbol: "INJ",    name: "Injective",      rank: 70,  start: 15.5,   vol: 1.20, drift: 0.00, late: 2.1,  dollarVol: 1.0e8 },
  { id: "sei-network",        symbol: "SEI",    name: "Sei",            rank: 80,  start: 0.41,   vol: 1.30, drift: -0.10, late: 1.4,  dollarVol: 1.0e8 },
  { id: "thincoin",           symbol: "THIN",   name: "Thincoin",       rank: 210, start: 0.02,   vol: 1.60, drift: 0.50, late: 4.0,  dollarVol: 3.0e5 },
];

export function fixtureUniverse({ days = 600, endT = null } = {}) {
  return FIXTURE_COINS.map((c, i) => ({
    id: c.id, symbol: c.symbol, name: c.name, rank: c.rank, image: null,
    product: `${c.symbol}-USD`,
    candles: syntheticCandles({ seed: 1000 + i * 7, days, start: c.start, vol: c.vol, drift: c.drift, late: c.late, dollarVol: c.dollarVol, endT }),
  }));
}
