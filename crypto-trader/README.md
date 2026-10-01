# Popping — six coins, a stake, a stopwatch

A momentum screen for a small crypto stake. You set a stake, how many coins, how long you want to
flip it in, and how much risk; it picks coins that are up **and still moving**, sizes them, sets the
exits, watches the prices live, and tells you when the plan says sell. It never places an order.

Static site + zero-dependency Vercel functions, the same shape as the Legal-Leaf Market repo it
lives beside. No framework, no build step, no `node_modules`.

```
public/
  index.html            the app: Plan / Live / Traders / Test
  playbook.html         who actually makes money in crypto, what is public, what $30 can run
  js/strategy.mjs       THE ONE COPY OF THE MATH — shared by the browser and api/
  js/app.js  js/live.js the UI, and the Coinbase WebSocket feed (no server in the path)
  sw.js  manifest.*     installable, offline shell, push handlers
api/
  screen.js             the screen + the plan            GET /api/screen?budget=30&n=6&horizon=21&risk=3
  backtest.js           walk-forward, no lookahead        GET /api/backtest?months=6&…
  candles.js quote.js   Coinbase bars / last trade        (used by Live for trails and as a WS fallback)
  traders.js            Hyperliquid leaderboard + wallets GET /api/traders[?user=0x…]
  push.js               Web Push (VAPID + RFC 8291)       GET/POST /api/push, GET /api/push?cron=1
lib/feeds.js            every upstream through one get(); CT_NO_FETCH=1 refuses all of them
lib/fixture.js          a synthetic universe for tests and for when the feeds are unreachable
server.mjs              local preview only (Vercel never runs it)
test-*.mjs              node suites; `npm test`
```

## Run it

```
node server.mjs                 # http://127.0.0.1:8788 with live feeds
CT_FIXTURE=1 node server.mjs    # sample data, no network
npm test                        # strategy math, push crypto (RFC vector), API routes
node test-app.mjs               # the whole flow in headless Chromium
```

## Where the rules come from

Read `/playbook` (also `public/playbook.html`). Short version: the trend signals are Man AHL's
(Baz et al. 2015) and the Donchian ensemble from Zarattini, Pagani & Barbon (2025); the ranking is
the Liu–Tsyvinski–Wu momentum factor with a horizon-matched lookback; the exits are Brandt's
(stop from the range, target as a multiple of risk, time stop) with the trend break as the
primary exit. Fees are Coinbase's published schedule, and the plan tells you what the simple Buy
button would cost against Advanced Trade, because on $5 tickets that gap is 40% of the stake.

## What it does not do, on purpose

- **It does not trade.** You buy on your exchange; it watches and alerts. A $30 account has no
  business handing API keys to a prototype.
- **It does not copy-trade.** The Traders tab shows what the top Hyperliquid wallets hold and
  their fills, read-only. Their leverage and drawdown tolerance do not transfer to $30.
- **It does not promise.** The Test tab walks the rules forward through the past with your fees;
  if it loses, believe it over the Plan tab.

## Data sources (all public, no keys)

CoinGecko `/coins/markets` (universe; an optional free demo key in `COINGECKO_API_KEY` raises the
rate limit), Coinbase Exchange REST (`/products`, `/candles`, `/ticker`) and WebSocket (`ticker`
channel, straight from the browser), Hyperliquid `info` and the stats leaderboard. Every handler
reports its upstreams under `?debug`, and `meta.fixture=true` means sample data.

## Background alerts (optional)

Alerts fire from the live feed while the app is open or installed. For alerts with the app closed,
set in Vercel → Settings → Environment Variables:

| Var | From |
|---|---|
| `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` | `node tools/vapid-keys.mjs` |
| `KV_REST_API_URL`, `KV_REST_API_TOKEN` | attach Upstash / Vercel KV in the Storage tab |
| `CRON_SECRET` | any long random string; `vercel.json` schedules `/api/push?cron=1` every 5 min |

Everything fails closed: without keys `POST /api/push` is 501, without the secret the cron refuses,
and `GET /api/push` lists exactly what is missing. `test-push.mjs` pins the payload encryption
against the RFC 8291 Appendix A test vector.

## Deploying

This directory is its own Vercel project (`framework: null`, `outputDirectory: public`, functions
from `api/`). It was first deployed by direct upload from this directory; to link it to git, move it
to its own repository (or set the project's Root Directory to `crypto-trader/`) and connect it.
