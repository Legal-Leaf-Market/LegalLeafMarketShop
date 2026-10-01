/* public/js/live.js — the price feed, with no server in the path.
 *
 * Coinbase Exchange publishes a public WebSocket ticker; the browser subscribes
 * to it directly, so a tick reaches the rules here about as fast as it can
 * reach anyone without a rack in the exchange's data centre (the `lag` field
 * is the exchange's own timestamp against this device's clock, which is why
 * it can read a few ms negative). Where a network blocks WebSockets, or the
 * server is on sample data, it polls /api/quote instead and says so.
 */
export function openFeed(products, { onTick, onStatus, fixture = false, pollEvery = 8000 } = {}) {
  let ws = null, closed = false, pollTimer = null, retries = 0, source = "none", lastMsg = 0, ackTimer = null;
  const status = (s) => { if (s.source) source = s.source; onStatus && onStatus({ source, ...s }); };

  function poll() {
    fetch(`/api/quote?ids=${products.join(",")}`, { cache: "no-store" })
      .then(r => r.json())
      .then(j => {
        for (const q of j.quotes || []) if (q.price) onTick({ product: q.product, price: +q.price, time: q.time, lag: null, source: "poll" });
        status({ source: "poll", ok: true, at: Date.now(), fixture: !!j.meta?.fixture });
      })
      .catch(e => status({ source: "poll", ok: false, err: String(e) }));
  }
  function startPolling() {
    if (pollTimer) return;
    poll();
    pollTimer = setInterval(poll, pollEvery);
    status({ source: "poll", ok: true });
  }
  function stopPolling() { if (pollTimer) { clearInterval(pollTimer); pollTimer = null; } }

  function connect() {
    if (closed || !products.length) return;
    try { ws = new WebSocket("wss://ws-feed.exchange.coinbase.com"); }
    catch { return startPolling(); }
    ackTimer = setTimeout(() => { if (ws && ws.readyState !== 1) { try { ws.close(); } catch {} } }, 7000);
    ws.onopen = () => {
      ws.send(JSON.stringify({ type: "subscribe", channels: [{ name: "ticker", product_ids: products }, { name: "heartbeat", product_ids: products }] }));
    };
    ws.onmessage = (m) => {
      lastMsg = Date.now();
      let d; try { d = JSON.parse(m.data); } catch { return; }
      if (d.type === "subscriptions") { clearTimeout(ackTimer); retries = 0; stopPolling(); status({ source: "ws", ok: true, at: Date.now() }); }
      else if (d.type === "ticker" && d.price) {
        onTick({ product: d.product_id, price: +d.price, time: d.time, bid: +d.best_bid, ask: +d.best_ask, open24: +d.open_24h, high24: +d.high_24h, low24: +d.low_24h, vol24: +d.volume_24h,
          lag: d.time ? Date.now() - Date.parse(d.time) : null, source: "ws" });
      }
      else if (d.type === "error") status({ source: "ws", ok: false, err: d.message || "error" });
    };
    ws.onerror = () => { /* onclose follows */ };
    ws.onclose = () => {
      clearTimeout(ackTimer);
      if (closed) return;
      retries++;
      if (retries >= 2) startPolling();
      const wait = Math.min(30000, 1000 * 2 ** retries);
      status({ source: pollTimer ? "poll" : "ws", ok: false, reconnectIn: wait });
      setTimeout(connect, wait);
    };
  }

  if (fixture) startPolling(); else connect();
  const watchdog = setInterval(() => { if (ws && ws.readyState === 1 && Date.now() - lastMsg > 30000) { try { ws.close(); } catch {} } }, 10000);
  document.addEventListener("visibilitychange", () => { if (!document.hidden && !fixture && (!ws || ws.readyState > 1) && !closed) { retries = 0; connect(); } });

  return {
    close() { closed = true; clearInterval(watchdog); stopPolling(); if (ws) { try { ws.close(); } catch {} } },
    get source() { return source; },
  };
}
