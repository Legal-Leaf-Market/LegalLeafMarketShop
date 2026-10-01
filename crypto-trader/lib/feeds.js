/* lib/feeds.js — every upstream this app reads, through ONE get() chokepoint.
 *
 * Sources, all public, no key required:
 *   CoinGecko  /coins/markets ..... the universe: top coins by market cap with
 *                                    1h/24h/7d/30d change (one request). A free
 *                                    demo key (COINGECKO_API_KEY) raises the
 *                                    rate limit; without one, 429s are possible
 *                                    and the fallback list below takes over.
 *   Coinbase Exchange REST ........ /products (which coins a US shopper can
 *                                    actually buy), /candles (daily bars: the
 *                                    ONLY input to every indicator), /ticker.
 *   Hyperliquid ................... the public leaderboard and any wallet's
 *                                    positions/fills. Every trade there is
 *                                    on-chain, so this is the one place the
 *                                    "top traders" can be watched rather than
 *                                    believed.
 *
 * CT_NO_FETCH=1 makes get() THROW (never a fake 200), so no test can reach a
 * real exchange by accident. CT_FIXTURE=1, or every upstream failing, serves
 * the synthetic universe from lib/fixture.js with meta.fixture=true — the
 * container this was written in refuses egress to all of the above, so that
 * path is not hypothetical; it is how the app was built.
 *
 * Caches are per warm instance (a Vercel function keeps module state between
 * invocations for a while). The CDN headers on each handler do the rest.
 */
import { fixtureUniverse } from "./fixture.js";

const UA = "popping-crypto-screen/1.0 (personal momentum screen; contact via github.com/Legal-Leaf-Market)";
const mem = new Map();

export class UpstreamError extends Error {
  constructor(msg, extra = {}) { super(msg); this.name = "UpstreamError"; Object.assign(this, extra); }
}

export async function memo(key, ttlMs, fn) {
  const hit = mem.get(key);
  if (hit && Date.now() - hit.t < ttlMs) return hit.v;
  if (hit && hit.p) return hit.p;                       // in flight: share it
  const p = Promise.resolve().then(fn);
  mem.set(key, { t: Date.now(), p });
  try { const v = await p; mem.set(key, { t: Date.now(), v }); return v; }
  catch (e) { mem.delete(key); throw e; }
}
export function cacheInfo() { return { keys: mem.size }; }
export function clearCache() { mem.clear(); }   // tests only: a scenario must not inherit the last one's answers

export async function get(url, { timeout = 8000, headers = {}, method = "GET", body } = {}) {
  if (process.env.CT_NO_FETCH === "1") throw new UpstreamError("CT_NO_FETCH=1 refuses every upstream call", { url });
  const ctl = new AbortController();
  const tm = setTimeout(() => ctl.abort(), timeout);
  const t0 = Date.now();
  try {
    const r = await fetch(url, { method, headers: { "user-agent": UA, accept: "application/json", ...headers }, body, signal: ctl.signal });
    const text = await r.text();
    if (!r.ok) throw new UpstreamError(`http ${r.status}`, { status: r.status, url, snippet: text.slice(0, 160), retryAfter: r.headers.get("retry-after") });
    let json;
    try { json = JSON.parse(text); } catch { throw new UpstreamError("not json", { status: r.status, url, snippet: text.slice(0, 120) }); }
    return { json, ms: Date.now() - t0, hdr: (n) => r.headers.get(n) };
  } catch (e) {
    if (e instanceof UpstreamError) throw e;
    const why = e.name === "AbortError" ? `timeout after ${timeout}ms` : (e.cause?.code || e.cause?.message || e.message);
    throw new UpstreamError(why, { url });
  } finally { clearTimeout(tm); }
}

/* COINBASE'S PUBLIC LIMIT IS 10 REQUESTS A SECOND PER IP, AND VERCEL'S FUNCTIONS
   SHARE IPs. The first live run fired candle requests four at a time, two pages
   each, and 40 of 50 came back 429: ten coins had history, the plan had three
   picks, and nothing errored. So: request starts are spaced `minGap` apart
   across the whole module, and a 429 is retried with backoff, honouring
   retry-after when the server sends one. */
let lastStart = 0;
async function paced(minGap) {
  const now = Date.now();
  const wait = Math.max(0, lastStart + minGap - now);
  lastStart = now + wait;
  if (wait) await new Promise(r => setTimeout(r, wait));
}
export async function getRetry(url, opts = {}, { tries = 3, minGap = 150 } = {}) {
  let delay = 1000;
  for (let i = 0; ; i++) {
    await paced(minGap);
    try { return await get(url, opts); }
    catch (e) {
      if (e.status !== 429 || i >= tries - 1) throw e;
      const ra = Number(e.retryAfter) * 1000;
      await new Promise(r => setTimeout(r, Number.isFinite(ra) && ra > 0 ? Math.min(ra, 5000) : delay));
      delay *= 2;
    }
  }
}

/* ---------- CoinGecko ---------- */
export async function coingeckoMarkets({ perPage = 250 } = {}) {
  const key = process.env.COINGECKO_API_KEY || "";
  const url = `https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&order=market_cap_desc&per_page=${perPage}&page=1&price_change_percentage=1h%2C24h%2C7d%2C30d`;
  const { json, ms } = await get(url, { timeout: 12000, headers: key ? { "x-cg-demo-api-key": key } : {} });
  if (!Array.isArray(json)) throw new UpstreamError("unexpected shape", { url });
  const rows = json.map(c => ({
    id: c.id, symbol: String(c.symbol || "").toUpperCase(), name: c.name, image: c.image || null,
    rank: c.market_cap_rank, price: c.current_price, mcap: c.market_cap, vol24: c.total_volume,
    chg1h: c.price_change_percentage_1h_in_currency, chg24h: c.price_change_percentage_24h_in_currency,
    chg7d: c.price_change_percentage_7d_in_currency, chg30d: c.price_change_percentage_30d_in_currency,
  }));
  return { rows, ms, keyed: !!key };
}

/* pegged, wrapped, staked, or otherwise not a bet on a coin */
export const EXCLUDE = new Set(["USDT","USDC","DAI","USDS","FDUSD","TUSD","PYUSD","USDE","USD1","RLUSD","EURC","GUSD","BUSD","USDD","FRAX","USDP","USDY","USDG","SUSDE","SUSDS","SUSD","BSC-USD","USD0",
  "WBTC","CBBTC","TBTC","LBTC","WETH","STETH","WSTETH","WEETH","RETH","CBETH","EZETH","RSETH","METH","FRXETH","SFRXETH","WBETH","BNSOL","JITOSOL","MSOL","JUPSOL","PAXG","XAUT","WBNB","WTRX","BTCB"]);

/* ---------- Coinbase Exchange ---------- */
export async function coinbaseProducts() {
  const url = "https://api.exchange.coinbase.com/products";
  const { json, ms } = await get(url, { timeout: 10000 });
  if (!Array.isArray(json)) throw new UpstreamError("unexpected shape", { url });
  const map = new Map();
  for (const p of json) {
    if (p.quote_currency !== "USD" || p.status !== "online" || p.trading_disabled || p.cancel_only) continue;
    map.set(String(p.base_currency).toUpperCase(), p.id);
  }
  return { map, count: map.size, ms };
}

/* Daily (or hourly) bars, oldest first, at most `bars`. Coinbase serves 300 a
   request newest-first, so this walks backwards until the history runs out. */
export async function coinbaseCandles(product, { granularity = 86400, bars = 600 } = {}) {
  const out = new Map();
  let end = new Date(), remaining = bars, pages = 0;
  while (remaining > 0 && pages < 6) {
    const n = Math.min(300, remaining);
    const start = new Date(end.getTime() - n * granularity * 1000);
    const url = `https://api.exchange.coinbase.com/products/${encodeURIComponent(product)}/candles?granularity=${granularity}&start=${start.toISOString()}&end=${end.toISOString()}`;
    const { json } = await getRetry(url, { timeout: 10000 });
    pages++;
    if (!Array.isArray(json) || !json.length) break;
    let oldest = Infinity;
    for (const r of json) {               // [time, low, high, open, close, volume]
      const t = r[0] * 1000;
      out.set(t, { t, l: +r[1], h: +r[2], o: +r[3], c: +r[4], v: +r[5] });
      if (r[0] < oldest) oldest = r[0];
    }
    remaining -= json.length;
    end = new Date(oldest * 1000 - 1000);
    if (json.length < n * 0.5) break;   // history exhausted
  }
  return [...out.values()].sort((a, b) => a.t - b.t);
}

export async function coinbaseTicker(product) {
  const url = `https://api.exchange.coinbase.com/products/${encodeURIComponent(product)}/ticker`;
  const { json, ms } = await getRetry(url, { timeout: 6000 }, { minGap: 60 });
  return { product, price: +json.price, bid: +json.bid, ask: +json.ask, vol24: +json.volume, time: json.time, ms };
}

/* ---------- Hyperliquid ---------- */
export async function hlLeaderboard() {
  const url = "https://stats-data.hyperliquid.xyz/Mainnet/leaderboard";
  const { json, ms } = await get(url, { timeout: 20000 });
  const rows = Array.isArray(json) ? json : (json.leaderboardRows || json.rows || []);
  const norm = rows.map(r => {
    const w = {};
    const wp = r.windowPerformances;
    const entries = Array.isArray(wp) ? wp.map(x => (Array.isArray(x) ? x : [x?.window || x?.name, x])) : Object.entries(wp || {});
    for (const [name, v] of entries) {
      const k = /all/i.test(name) ? "allTime" : /month|30/i.test(name) ? "month" : /week|7/i.test(name) ? "week" : /day|24/i.test(name) ? "day" : String(name);
      w[k] = { pnl: +(v?.pnl ?? 0), roi: +(v?.roi ?? 0), vlm: +(v?.vlm ?? 0) };
    }
    return { address: r.ethAddress || r.address, name: r.displayName || null, accountValue: +(r.accountValue ?? 0), prize: r.prize ?? null, w };
  }).filter(r => r.address);
  return { rows: norm, ms, total: norm.length };
}

export async function hlInfo(body) {
  const { json, ms } = await get("https://api.hyperliquid.xyz/info", {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body), timeout: 10000,
  });
  return { json, ms };
}

/* ---------- the universe ---------- */

/* Coins a US shopper can buy on Coinbase, used only when CoinGecko is down. */
export const FALLBACK_SYMBOLS = ["BTC","ETH","XRP","SOL","DOGE","ADA","TRX","LINK","AVAX","XLM","SUI","HBAR","BCH","LTC","DOT","SHIB","UNI","AAVE","NEAR","APT","ICP","ETC","POL","ONDO","RENDER","ARB","OP","FET","INJ","ATOM","ALGO","FIL","VET","STX","TIA","SEI","JUP","PEPE","BONK","WIF","IMX","GRT","MKR","LDO","CRV","ENS","JASMY","QNT","SAND","MANA","AXS","APE","CHZ","XTZ","EGLD","COMP","SNX","1INCH","ZRX","BAT","ROSE","FLOW","KSM","ANKR","SKL","MASK","LPT","RPL","BLUR","PYTH","WLD","TAO","KAITO","VIRTUAL","AERO","MORPHO","ZORA","PENGU","TRUMP","FLOKI","POPCAT","MOODENG","ENA","ETHFI","EIGEN","STRK","ZK","ZRO","W","ONDO"];

export function fixture(reason) {
  return { candidates: fixtureUniverse(), meta: { fixture: true, reason, upstreams: {} } };
}

async function mapLimit(items, limit, fn) {
  const out = new Array(items.length); let i = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) { const k = i++; try { out[k] = { ok: true, v: await fn(items[k], k) }; } catch (e) { out[k] = { ok: false, e }; } }
  }));
  return out;
}

/* The candidate set with candles attached. `limit` bounds how many coins get
   their history fetched on a cold start; the coarse pre-rank (up this week,
   sorted by the month) decides which, with BTC and ETH always included so the
   backtest has its benchmark. */
export async function buildUniverse({ limit = 50, bars = 300 } = {}) {
  if (process.env.CT_FIXTURE === "1") return fixture("CT_FIXTURE=1");
  const meta = { fixture: false, upstreams: {} };
  const [g, p] = await Promise.allSettled([
    memo("gecko", 5 * 60e3, () => coingeckoMarkets({ perPage: 250 })),
    memo("cb:products", 60 * 60e3, () => coinbaseProducts()),
  ]);
  const gecko = g.status === "fulfilled" ? g.value : null;
  const products = p.status === "fulfilled" ? p.value : null;
  meta.upstreams.coingecko = gecko ? { ok: true, ms: gecko.ms, rows: gecko.rows.length, keyed: gecko.keyed } : { ok: false, err: String(g.reason?.message || g.reason), status: g.reason?.status };
  meta.upstreams.coinbaseProducts = products ? { ok: true, ms: products.ms, usdPairs: products.count } : { ok: false, err: String(p.reason?.message || p.reason), status: p.reason?.status };
  if (!products) {
    const f = fixture(`coinbase products unreachable: ${meta.upstreams.coinbaseProducts.err}`);
    f.meta.upstreams = meta.upstreams;
    return f;
  }
  let list;
  if (gecko) {
    const seen = new Set();
    list = [];
    for (const r of gecko.rows) {
      if (!r.symbol || EXCLUDE.has(r.symbol) || seen.has(r.symbol) || !products.map.has(r.symbol)) continue;
      seen.add(r.symbol);
      list.push({ ...r, product: products.map.get(r.symbol) });
    }
    const up = list.filter(r => (r.chg7d ?? 0) > 0).sort((a, b) => (b.chg30d ?? 0) - (a.chg30d ?? 0));
    const rest = list.filter(r => !up.includes(r));
    const must = list.filter(r => r.symbol === "BTC" || r.symbol === "ETH");
    const chosen = [...must];
    for (const r of [...up, ...rest]) { if (chosen.length >= limit) break; if (!chosen.includes(r)) chosen.push(r); }
    list = chosen;
  } else {
    list = FALLBACK_SYMBOLS.filter((s, i, a) => a.indexOf(s) === i && products.map.has(s)).slice(0, limit)
      .map((s, i) => ({ id: s.toLowerCase(), symbol: s, name: s, rank: i + 1, image: null, product: products.map.get(s) }));
  }
  const t0 = Date.now();
  const results = await mapLimit(list, 2, (c) => memo(`cb:candles:${c.product}:${bars}`, 10 * 60e3, () => coinbaseCandles(c.product, { bars })));
  const candidates = [], failed = [];
  results.forEach((r, i) => {
    if (r.ok && r.v.length >= 30) candidates.push({ ...list[i], candles: r.v });
    else failed.push({ symbol: list[i].symbol, err: r.ok ? `only ${r.v.length} bars` : String(r.e?.message || r.e) });
  });
  meta.upstreams.candles = { ok: candidates.length > 0, fetched: candidates.length, failed: failed.length, rateLimited: failed.filter(f => /429/.test(f.err)).length, ms: Date.now() - t0, examples: failed.slice(0, 5) };
  meta.source = gecko ? "coingecko+coinbase" : "coinbase fallback list";
  if (!candidates.length) {
    const f = fixture(`no candles came back: ${failed[0]?.err || "unknown"}`);
    f.meta.upstreams = meta.upstreams;
    return f;
  }
  return { candidates, meta };
}
