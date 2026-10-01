/* public/js/app.js — the app. Plan / Live / Traders / Test.
   Everything numeric comes from /js/strategy.mjs, the same file the server
   runs; this file only asks, shows, and remembers (localStorage). */
import * as S from "/js/strategy.mjs";
import { openFeed } from "/js/live.js";

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const HORIZONS = [3, 5, 7, 10, 14, 21, 28, 42, 56, 84];
const RISK_HINT = {
  1: "Top-30 coins only, the calm ones, sized so the calmest gets the most. Must be up this week and trending. Disaster stop up to 15% below.",
  2: "Top-50, must be up this week and trending. Stop up to 20%.",
  3: "Top-100, must be up this week. Half inverse-vol, half equal sizing. Stop up to 25%.",
  4: "Top-150, equal sizing, does not insist on an up week. Stop up to 30%.",
  5: "Anything liquid, sized by score, stop up to 40%. This is the slot-machine setting; it is here so you can see what it does in the Test tab.",
};
const store = {
  get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
};
const state = {
  settings: { budget: 30, n: 6, horizonIdx: 5, risk: 3, fee: "coinbase_advanced_taker", digestHour: 9, ...store.get("ct:settings", {}) },
  positions: store.get("ct:positions", []),
  history: store.get("ct:history", []),
  alerts: store.get("ct:alerts", []),
  lastDigest: store.get("ct:lastDigest", null),
  screen: null, feed: null, feedProducts: "", quotes: {}, rings: {}, cooldown: {}, fixture: false, push: null, pushSub: null,
};

/* ---------- helpers ---------- */
const horizonDays = () => HORIZONS[state.settings.horizonIdx] ?? 21;
function horizonLabel(d) { if (d < 7) return `${d} days`; if (d % 7 === 0) return `${d / 7} week${d > 7 ? "s" : ""}`; return `${d} days`; }
const money = (x, digits = 2) => Number.isFinite(x) ? (x < 0 ? "−$" : "$") + Math.abs(x).toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits }) : "—";
const pctf = S.pct, price = S.fmt;
const cls = (x) => x > 0 ? "up" : x < 0 ? "down" : "";
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const cssId = (s) => String(s).replace(/[^a-z0-9]/gi, "_");
const short = (a) => a ? a.slice(0, 6) + "…" + a.slice(-4) : "";
const day = (t) => new Date(t).toLocaleDateString(undefined, { month: "short", day: "numeric" });
let toastTimer = null;
function toast(msg, ms = 3200) { const t = $("#toast"); t.textContent = msg; t.hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(() => { t.hidden = true; }, ms); }
function saveAll() { store.set("ct:settings", state.settings); store.set("ct:positions", state.positions); store.set("ct:history", state.history); store.set("ct:alerts", state.alerts); }

/* ---------- tabs ---------- */
function showTab(name) {
  if (!["plan", "live", "traders", "test"].includes(name)) name = "plan";
  for (const t of $$(".tab")) t.hidden = t.id !== `tab-${name}`;
  for (const a of $$(".tabs a[data-tab]")) a.classList.toggle("active", a.dataset.tab === name);
  if (name === "live") { $("#liveBadge").hidden = true; $("#liveBadge").textContent = ""; startLive(); }
  if (name === "traders" && !$("#traders").children.length) loadTraders();
  window.scrollTo(0, 0);
}
window.addEventListener("hashchange", () => showTab(location.hash.replace("#", "")));

/* ---------- plan ---------- */
function bindControls() {
  const s = state.settings;
  $("#budget").value = s.budget; $("#coins").value = s.n; $("#horizon").value = s.horizonIdx; $("#risk").value = s.risk; $("#fee").value = s.fee;
  const upd = () => {
    s.budget = +$("#budget").value; s.n = +$("#coins").value; s.horizonIdx = +$("#horizon").value; s.risk = +$("#risk").value; s.fee = $("#fee").value;
    $("#budgetOut").textContent = "$" + s.budget; $("#coinsOut").textContent = s.n; $("#horizonOut").textContent = horizonLabel(horizonDays());
    $("#riskOut").textContent = S.riskOf(s.risk).label; $("#riskHint").textContent = RISK_HINT[s.risk]; $("#pickBtn").textContent = `Pick my ${s.n}`;
    store.set("ct:settings", s);
  };
  for (const id of ["budget", "coins", "horizon", "risk", "fee"]) $("#" + id).addEventListener("input", upd);
  upd();
  $("#pickBtn").addEventListener("click", runScreen);
}

async function runScreen() {
  const s = state.settings, btn = $("#pickBtn");
  btn.disabled = true; btn.textContent = "Reading the market…";
  try {
    const r = await fetch(`/api/screen?budget=${s.budget}&n=${s.n}&horizon=${horizonDays()}&risk=${s.risk}&fee=${encodeURIComponent(s.fee)}`);
    const j = await r.json();
    if (!r.ok || j.error) throw new Error(j.error || `http ${r.status}`);
    state.screen = j; state.fixture = !!j.meta.fixture; setFixture(j.meta);
    renderPlan(j);
  } catch (e) { toast("Could not read the market: " + e.message, 5000); }
  finally { btn.disabled = false; btn.textContent = `Pick my ${s.n}`; }
}
function setFixture(meta) {
  const b = $("#fixtureBanner"); b.hidden = !meta.fixture;
  if (meta.fixture) $("#fixtureWhy").textContent = `The live feeds were not reachable (${meta.reason || "unknown"}), so these are synthetic coins with made-up prices. Nothing on this screen is a market.`;
}
function spark(vals) {
  if (!vals || vals.length < 2) return "";
  const w = 300, h = 34, mn = Math.min(...vals), mx = Math.max(...vals);
  const pts = vals.map((v, i) => `${(i / (vals.length - 1) * w).toFixed(1)},${(h - 2 - (mx > mn ? (v - mn) / (mx - mn) : .5) * (h - 4)).toFixed(1)}`).join(" ");
  return `<svg class="spark" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none"><polyline fill="none" stroke="${vals[vals.length - 1] >= vals[0] ? "#22c55e" : "#ef4444"}" stroke-width="2" points="${pts}"/></svg>`;
}
function pickCard(r, i, full) {
  const logo = r.image ? `<img src="${esc(r.image)}" alt="" loading="lazy">` : esc(r.symbol.slice(0, 4));
  return `<div class="pick"><div class="logo">${logo}</div>
    <div><h3>${i + 1}. ${esc(r.name)} <span class="sym">${esc(r.symbol)}</span></h3>
      <div class="small"><span class="${cls(r.ret7)}">${pctf(r.ret7)} 7d</span> · <span class="${cls(r.ret30)}">${pctf(r.ret30)} 30d</span> · ${Math.round((r.vol30 || 0) * 100)}% vol</div></div>
    <div class="nums"><div class="d">${money(r.dollars)}</div><div class="small">${r.units.toPrecision(3)} @ $${price(r.price)}</div></div>
    ${spark(full?.spark)}
    <div class="exits"><span>stop <b class="down">−${(r.stopPct * 100).toFixed(0)}%</b> $${price(r.stop)}</span><span>target <b class="up">+${(r.targetPct * 100).toFixed(0)}%</b> $${price(r.target)}</span><span>sell by ${day(r.sellBy)}</span></div>
    <p class="why">${(r.why || []).map(esc).join(" · ")}</p></div>`;
}
function renderPlan(j) {
  const { plan, ranked, meta } = j;
  const cost = $("#costCard"); cost.hidden = false;
  if (!plan.rows.length) {
    cost.innerHTML = `<strong>Nothing passed the screen.</strong><p class="hint">${esc(plan.note || "")} Loosen the risk slider, shorten the horizon, or accept that this is a week to sit out.</p>`;
    $("#picks").innerHTML = ""; $("#planActions").hidden = true;
  } else {
    const f = plan.fees;
    cost.innerHTML = `<div class="row"><span>Fees, round trip<br><span class="small">${esc(f.label)}</span></span><span class="big">${money(f.roundTrip)}</span></div>
      <p class="hint">That is ${(f.pctOfStake * 100).toFixed(1)}% of your $${plan.budget}. The coins have to rise that much before you are even.</p>
      ${f.model !== "coinbase_simple"
        ? `<p class="hint warn">The plain Coinbase app Buy button would cost <strong>${money(f.simpleRoundTrip)}</strong>, ${(f.simplePct * 100).toFixed(0)}% of the stake, for the same trades: it charges $0.99 flat under $10 plus a spread. Use Advanced Trade (same app, same account) or Kraken Pro. Never the simple button for tickets this small.</p>`
        : `<p class="hint warn">You chose the simple Buy button. On $${plan.budget} split ${plan.rows.length} ways that is ${(f.simplePct * 100).toFixed(0)}% of the stake gone before the market moves. Switch to Advanced Trade inside the same app.</p>`}`;
    $("#picks").innerHTML = plan.rows.map((r, i) => pickCard(r, i, ranked.find(x => x.id === r.id))).join("");
    $("#planActions").hidden = false;
  }
  const also = ranked.filter(r => !plan.rows.some(p => p.id === r.id)).slice(0, 30);
  $("#alsoRan").hidden = !also.length;
  $("#alsoRanList").innerHTML = `<table><tr><th>Coin</th><th class="r">7d</th><th class="r">30d</th><th>Verdict</th></tr>${also.map(r =>
    `<tr><td>${esc(r.symbol)}</td><td class="r ${cls(r.ret7)}">${pctf(r.ret7)}</td><td class="r ${cls(r.ret30)}">${pctf(r.ret30)}</td><td>${r.score != null ? "passed, ranked " + (ranked.indexOf(r) + 1) : esc(r.excluded)}</td></tr>`).join("")}</table>`;
  $("#screenMeta").textContent = `${meta.universe} coins screened ${meta.fixture ? "from sample data" : "from " + (meta.source || "live feeds")} at ${new Date(meta.updated).toLocaleTimeString()} in ${meta.ms} ms. Rules v${meta.version}.`;
}

function openTrackDialog() {
  const rows = state.screen?.plan?.rows || [];
  if (!rows.length) return;
  $("#trackRows").innerHTML = rows.map(r => `<div class="trow"><span>${esc(r.symbol)} · ${money(r.dollars)}</span><input name="${esc(r.id)}" type="number" step="any" inputmode="decimal" value="${r.price}"></div>`).join("");
  const dlg = $("#trackDialog");
  dlg.returnValue = "";
  dlg.showModal();
  dlg.onclose = () => {
    if (dlg.returnValue !== "ok") return;
    const fd = new FormData(dlg.querySelector("form"));
    const now = Date.now(), H = horizonDays();
    const fresh = rows.map(r => {
      const entry = +fd.get(r.id) || r.price;
      return { id: r.id, symbol: r.symbol, name: r.name, product: r.product, image: r.image, entry, units: r.dollars / entry, dollars: r.dollars,
        stopPct: r.stopPct, targetPct: r.targetPct, stop: entry * (1 - r.stopPct), target: entry * (1 + r.targetPct), high: entry, vol30: r.vol30,
        sellBy: now + H * 86400e3, openedAt: now, horizonLabel: horizonLabel(H), fixture: state.fixture };
    });
    state.positions = state.positions.filter(p => !fresh.some(n => n.product === p.product)).concat(fresh);
    saveAll(); syncPush();
    toast(`Watching ${fresh.length} coins. Sell-by ${day(now + H * 86400e3)}.`);
    location.hash = "#live";
  };
}

/* ---------- live ---------- */
let liveTimersOn = false;
function startLive() {
  renderPositions();
  const products = [...new Set(state.positions.filter(p => !p.closed).map(p => p.product).filter(Boolean))].sort();
  const key = products.join(",") + (state.positions.some(p => p.fixture) ? "|fixture" : "");
  if (key !== state.feedProducts) {
    if (state.feed) { state.feed.close(); state.feed = null; }
    state.feedProducts = key;
    if (products.length) state.feed = openFeed(products, { onTick, onStatus, fixture: state.positions.some(p => p.fixture) });
    else onStatus({ source: "none" });
  }
  if (!liveTimersOn) { liveTimersOn = true; checkTrends(); setInterval(checkTrends, 60 * 60e3); setInterval(minuteTick, 60e3); }
}
function onStatus(s) {
  const label = s.source === "ws" ? (s.ok === false ? "reconnecting…" : "live · Coinbase WebSocket") : s.source === "poll" ? (s.fixture ? "sample prices, polling" : "polling every 8 s") : "nothing to watch";
  $("#statusDot").className = "dot " + (s.source === "ws" && s.ok !== false ? "ws" : s.source === "poll" ? "poll" : s.ok === false ? "bad" : "");
  $("#statusText").textContent = label; $("#feedSource").textContent = label; $("#feedSource").className = "pill " + (s.source || "");
  if (s.err) toast("Feed: " + s.err);
}
function onTick(t) {
  state.quotes[t.product] = t;
  const ring = state.rings[t.product] || (state.rings[t.product] = []);
  ring.push({ t: Date.now(), p: t.price }); if (ring.length > 4000) ring.splice(0, ring.length - 4000);
  if (t.lag != null) $("#lag").textContent = `${Math.max(0, Math.round(t.lag))} ms`;
  $("#lastTick").textContent = new Date().toLocaleTimeString();
  let dirty = false;
  for (const pos of state.positions) {
    if (pos.product !== t.product || pos.closed) continue;
    const events = S.evaluatePosition(pos, { price: t.price });
    if (events.length) dirty = true;
    for (const ev of events) if (ev.level === "sell") fireAlert(pos, ev);
    const pc = S.poppingCheck(ring, { minutes: 60, volAnnual: pos.vol30 || 1 });
    if (pc && pc.popping) {
      const key = `pop:${pos.product}:${pc.up ? "up" : "down"}`;
      if (!state.cooldown[key] || Date.now() - state.cooldown[key] > 30 * 60e3) {
        state.cooldown[key] = Date.now();
        fireAlert(pos, { type: "pop", level: "info", price: t.price, msg: `${pos.symbol} is popping: ${pctf(pc.move)} in the last hour, against a usual hour of ±${(pc.threshold * 100).toFixed(1)}%. ${pc.up ? `Have a look. The target is $${price(pos.target)}.` : `Down, not up. The stop is $${price(pos.stop)}.`}` });
      }
    }
    updatePosRow(pos, t.price);
  }
  if (dirty) saveAll();
  renderTotals();
}
function fireAlert(pos, ev) {
  state.alerts.unshift({ t: Date.now(), symbol: pos.symbol, type: ev.type, level: ev.level, msg: ev.msg, price: ev.price });
  state.alerts.length = Math.min(state.alerts.length, 100);
  saveAll(); renderAlerts(); toast(ev.msg, 7000);
  // Chrome refuses vibrate() until the page has been tapped, and logs it as an error rather than throwing
  if (navigator.vibrate && navigator.userActivation?.hasBeenActive) navigator.vibrate(ev.level === "sell" ? [200, 100, 200, 100, 400] : [120]);
  notify(ev.level === "sell" ? `Sell ${pos.symbol}` : `${pos.symbol} is popping`, ev.msg, `${ev.type}:${pos.product}`, ev.level);
  if (location.hash !== "#live") { const b = $("#liveBadge"); b.hidden = false; b.textContent = (+b.textContent || 0) + 1; }
}
async function notify(title, body, tag, level) {
  if (!("Notification" in window) || Notification.permission !== "granted") return;
  const opts = { body, tag, renotify: true, icon: "/icon-192.png", badge: "/icon-192.png", vibrate: level === "sell" ? [200, 100, 200, 100, 400] : [120], data: { url: "/#live" } };
  try { const reg = await navigator.serviceWorker?.getRegistration(); if (reg) await reg.showNotification(title, opts); else new Notification(title, opts); }
  catch (e) { console.warn("notify", e); }
}
async function checkTrends() {
  const open = state.positions.filter(p => !p.closed && p.product);
  if (!open.length) return;
  for (const pos of open) {
    try {
      const r = await fetch(`/api/candles?id=${encodeURIComponent(pos.product)}&bars=400`);
      const j = await r.json();
      if (!r.ok || !j.candles?.length) continue;
      const a = S.analyse(j.candles);
      const since = j.candles.filter(c => c.t >= pos.openedAt - 86400e3);
      const hh = Math.max(pos.high || pos.entry, ...since.map(c => c.h));
      if (hh > pos.high) pos.high = hh;
      const trail = pos.high * (1 - pos.stopPct); if (trail > pos.stop) pos.stop = trail;
      const broken = S.trendBrokenAt(a, a.n - 1);
      pos.trendState = broken ? "broken" : "intact"; pos.trendCheckedAt = Date.now();
      const last = state.quotes[pos.product]?.price || j.candles[j.candles.length - 1].c;
      for (const ev of S.evaluatePosition(pos, { price: last }, Date.now(), { trendBroken: broken })) if (ev.level === "sell") fireAlert(pos, ev);
    } catch (e) { console.warn("trend check", pos.product, e); }
  }
  saveAll(); renderPositions(); syncPush();
}
function minuteTick() {
  const now = Date.now();
  for (const pos of state.positions) {
    if (pos.closed) continue;
    const q = state.quotes[pos.product]; if (!q) continue;
    for (const ev of S.evaluatePosition(pos, { price: q.price }, now)) if (ev.level === "sell") fireAlert(pos, ev);
  }
  const d = new Date(), today = d.toDateString();
  if (d.getHours() === state.settings.digestHour && state.lastDigest !== today && state.positions.some(p => !p.closed)) {
    state.lastDigest = today; store.set("ct:lastDigest", today);
    const t = totals();
    const lines = state.positions.filter(p => !p.closed).map(p => { const q = state.quotes[p.product]; return q ? `${p.symbol} ${pctf(q.price / p.entry - 1)}` : `${p.symbol} —`; });
    notify("Daily check-in", `${money(t.now)} of ${money(t.in)} (${pctf(t.now / t.in - 1)}). ${lines.join(", ")}`, "digest", "info");
  }
  renderTotals();
}
function totals() { let inn = 0, now = 0; for (const p of state.positions) { if (p.closed) continue; inn += p.dollars; const q = state.quotes[p.product]; now += p.units * (q ? q.price : p.entry); } return { in: inn, now }; }
function renderTotals() {
  const t = totals();
  $("#portfolioNow").textContent = money(t.now); $("#portfolioNow").className = cls(t.now - t.in);
  $("#portfolioIn").textContent = money(t.in);
  const sb = state.positions.filter(p => !p.closed).map(p => p.sellBy);
  $("#portfolioSellBy").textContent = sb.length ? day(Math.min(...sb)) : "—";
}
function renderPositions() {
  const el = $("#positions"), open = state.positions.filter(p => !p.closed);
  if (!open.length) { el.innerHTML = `<div class="card"><strong>Nothing being watched.</strong><p class="hint">Build a plan on the Plan tab and press "I bought these".</p></div>`; renderTotals(); return; }
  el.innerHTML = open.map(p => `<div class="pos" id="pos-${cssId(p.product)}">
    <h3>${esc(p.symbol)} <span class="sym small">${esc(p.name || "")}</span></h3><div class="live" data-live>$${price(state.quotes[p.product]?.price || p.entry)}</div>
    <div class="small" data-pnl>—</div><div class="small" style="text-align:right">in at $${price(p.entry)} · ${money(p.dollars)}</div>
    <div class="bar"><i data-marker style="left:${Math.round(100 * (p.entry - p.stop) / (p.target - p.stop))}%"></i></div>
    <div class="meta"><span data-stop>stop $${price(p.stop)}</span><span>target $${price(p.target)}</span><span>sell by ${day(p.sellBy)}</span><span>trend ${esc(p.trendState || "unchecked")}</span>${p.targetHit ? "<span class='up'>target hit</span>" : ""}${p.fixture ? "<span>sample</span>" : ""}</div>
    <div class="btns"><button data-close="${esc(p.product)}">I sold it</button></div></div>`).join("");
  for (const p of open) updatePosRow(p, state.quotes[p.product]?.price);
  renderTotals();
}
function updatePosRow(pos, px) {
  const row = $(`#pos-${cssId(pos.product)}`); if (!row || !(px > 0)) return;
  const live = row.querySelector("[data-live]"), prev = parseFloat(live.dataset.prev || px);
  live.textContent = "$" + price(px); live.dataset.prev = px;
  live.classList.toggle("flash-up", px > prev); live.classList.toggle("flash-down", px < prev);
  const pnl = px / pos.entry - 1, pn = row.querySelector("[data-pnl]");
  pn.textContent = `${pctf(pnl)} · ${money(pos.units * px - pos.dollars)}`; pn.className = "small " + cls(pnl);
  row.querySelector("[data-marker]").style.left = (Math.max(0, Math.min(1, (px - pos.stop) / (pos.target - pos.stop))) * 100) + "%";
  row.querySelector("[data-stop]").textContent = `stop $${price(pos.stop)}`;
}
function renderAlerts() {
  $("#alerts").innerHTML = state.alerts.slice(0, 50).map(a => `<li class="${a.level === "sell" ? "sell" : a.type === "pop" ? "pop" : ""}"><time>${new Date(a.t).toLocaleString()}</time>${esc(a.msg)}</li>`).join("") || "<li class='hint'>No alerts yet.</li>";
}
async function enableNotifications() {
  if (!("Notification" in window)) return toast("This browser has no notifications. On iPhone, add the app to the Home Screen first (Share → Add to Home Screen), then open it from there.", 8000);
  const p = await Notification.requestPermission();
  if (p === "granted") { toast("Alerts on. Keep the app open or installed and it will tell you when the plan says sell."); notify("Popping is watching", "You will hear from me when a coin hits its stop, its target, breaks trend, or pops.", "hello", "info"); }
  else toast("Notifications blocked. Alerts still show in the list here.");
  updateNotifyBtn();
}
function updateNotifyBtn() {
  const b = $("#notifyBtn");
  if (!("Notification" in window)) { b.textContent = "Notifications unavailable here"; return; }
  b.textContent = Notification.permission === "granted" ? "Alerts are on for this phone" : "Enable alerts on this phone";
  b.disabled = Notification.permission === "granted";
}

/* ---------- background push (server side, when configured) ---------- */
async function initPush() {
  try {
    const r = await fetch("/api/push"); const j = await r.json(); state.push = j;
    if (j.vapid && "PushManager" in window) {
      $("#pushBtn").hidden = false;
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.getSubscription();
      if (sub) { state.pushSub = sub; $("#pushBtn").textContent = j.storage === "kv" ? "Background alerts are on" : "Push works; no storage"; }
      $("#notifyHint").textContent = j.storage === "kv" ? "Background alerts are configured: the server checks your coins every five minutes and pushes to this phone even with the app closed." : "Push keys are set but no storage is attached, so the server cannot remember your plan between checks. Alerts fire while the app is open.";
    }
  } catch {}
}
async function enablePush() {
  try {
    const reg = await navigator.serviceWorker.ready;
    if ((await Notification.requestPermission()) !== "granted") return toast("Notifications blocked.");
    const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64ToU8(state.push.vapid) });
    state.pushSub = sub;
    const r = await fetch("/api/push", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "subscribe", subscription: sub.toJSON(), plan: planForServer() }) });
    const j = await r.json(); if (!r.ok) throw new Error(j.error || r.status);
    $("#pushBtn").textContent = j.stored ? "Background alerts are on" : "Push works; no storage";
    const t = await fetch("/api/push", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "test", subscription: sub.toJSON() }) }).then(x => x.json()).catch(() => ({}));
    toast(j.stored ? `Background alerts on${t.ok ? "; a test push is on its way" : ""}.` : "A test push was sent, but the server has no storage attached, so it cannot check in the background yet. See the Playbook.", 8000);
    updateNotifyBtn();
  } catch (e) { toast("Push failed: " + e.message, 6000); }
}
function planForServer() {
  return { positions: state.positions.filter(p => !p.closed).map(p => ({ id: p.id, symbol: p.symbol, product: p.product, entry: p.entry, units: p.units, dollars: p.dollars, stop: p.stop, target: p.target, stopPct: p.stopPct, high: p.high, sellBy: p.sellBy, openedAt: p.openedAt, vol30: p.vol30, targetHit: !!p.targetHit, horizonNotified: !!p.horizonNotified, trendNotified: !!p.trendNotified, horizonLabel: p.horizonLabel })), horizonLabel: horizonLabel(horizonDays()) };
}
async function syncPush() {
  if (!state.pushSub) return;
  try { await fetch("/api/push", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "sync", subscription: state.pushSub.toJSON(), plan: planForServer() }) }); } catch {}
}
function b64ToU8(s) { const b = atob((s + "=".repeat((4 - s.length % 4) % 4)).replace(/-/g, "+").replace(/_/g, "/")); return Uint8Array.from(b, c => c.charCodeAt(0)); }

/* ---------- traders ---------- */
async function loadTraders() {
  const el = $("#traders"); el.innerHTML = "<div class='card hint'>Reading the leaderboard…</div>";
  $("#traderDetail").hidden = true;
  const [min, max] = ($("#tradersBand").value || "250000-").split("-");
  try {
    const r = await fetch(`/api/traders?min=${min || 0}${max ? `&max=${max}` : ""}`); const j = await r.json();
    if (!r.ok || j.error) throw new Error(j.error || `http ${r.status}`);
    el.innerHTML = j.rows.map((t, i) => `<div class="trader" data-addr="${esc(t.address)}"><div><strong>${i + 1}. ${esc(t.name || short(t.address))}</strong><div class="addr">${esc(short(t.address))}</div><div class="sub">account ${money(t.accountValue, 0)} · week ${pctf(t.w.week?.roi)} · all-time ${money(t.w.allTime?.pnl, 0)}</div></div><div><div class="pnl ${cls(t.w.month?.pnl)}">${money(t.w.month?.pnl, 0)}</div><div class="sub">30d · ${pctf(t.w.month?.roi)}</div></div></div>`).join("") || "<div class='card hint'>Empty leaderboard.</div>";
    $("#tradersMeta").textContent = (j.meta.fixture ? "Sample wallets: the leaderboard was not reachable. " : "") + `Updated ${new Date(j.meta.updated).toLocaleTimeString()}.`;
  } catch (e) { el.innerHTML = `<div class="card"><strong>Leaderboard unreachable.</strong><p class="hint">${esc(e.message)}. Hyperliquid's stats host sometimes refuses cloud addresses; try again in a minute.</p></div>`; }
}
async function loadTrader(addr) {
  const d = $("#traderDetail"); d.hidden = false; d.innerHTML = "<span class='hint'>Reading wallet…</span>"; d.scrollIntoView({ behavior: "smooth", block: "start" });
  try {
    const r = await fetch(`/api/traders?user=${encodeURIComponent(addr)}`); const j = await r.json();
    if (!r.ok || j.error) throw new Error(j.error || `http ${r.status}`);
    const vault = j.vault ? `<p class="hint warn">This address is a Hyperliquid <strong>vault</strong>, "${esc(j.vault.name)}"${j.vault.apr != null ? ` (${pctf(j.vault.apr)} APR)` : ""}. Its trades are made by its leader${j.vault.leader ? `, <button class="link" data-addr="${esc(j.vault.leader)}">${esc(short(j.vault.leader))}</button>` : ""}; the main perp book shows nothing under the vault's own address.</p>` : "";
    d.innerHTML = `<div class="row"><strong>${esc(short(addr))}</strong><span>account ${money(j.accountValue, 0)}</span></div>${vault}
      <h4>Open positions</h4>${!j.positions.length && !(j.accountValue > 0) && !j.vault ? `<p class="hint">Nothing on the main perp book under this address. The biggest leaderboard rows are often vaults, sub-account aggregates, or accounts on a builder-deployed market that this view does not read; the profit is real, the trades just are not visible here.</p>` : ""}${j.positions.length ? `<table><tr><th>Coin</th><th>Side</th><th class="r">Size $</th><th class="r">Entry</th><th class="r">uPnL</th><th class="r">Lev</th></tr>${j.positions.map(p => `<tr><td>${esc(p.coin)}</td><td class="${p.side === "long" ? "up" : "down"}">${p.side}</td><td class="r">${money(p.value, 0)}</td><td class="r">${price(p.entry)}</td><td class="r ${cls(p.uPnl)}">${money(p.uPnl, 0)}</td><td class="r">${esc(p.leverage || "")}</td></tr>`).join("")}</table>` : "<p class='hint'>Flat right now.</p>"}
      <h4>Last fills</h4><table><tr><th>When</th><th>Coin</th><th>What</th><th class="r">Size</th><th class="r">Price</th><th class="r">PnL</th></tr>${j.fills.slice(0, 20).map(f => `<tr><td>${new Date(f.t).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}</td><td>${esc(f.coin)}</td><td>${esc(f.dir)}</td><td class="r">${f.sz}</td><td class="r">${price(f.px)}</td><td class="r ${cls(f.pnl)}">${f.pnl ? money(f.pnl, 0) : ""}</td></tr>`).join("")}</table>
      <p class="hint">Copy-trading this wallet with seconds of lag is possible through the same public API and is deliberately not built here: a $50M account can hold a 5x bitcoin long through a 15% dip; a $30 one cannot.</p>`;
  } catch (e) { d.innerHTML = `<strong>Could not read that wallet.</strong><p class="hint">${esc(e.message)}</p>`; }
}

/* ---------- test ---------- */
async function runBacktest() {
  const s = state.settings, btn = $("#btBtn"); btn.disabled = true; btn.textContent = "Walking forward…";
  try {
    const r = await fetch(`/api/backtest?budget=${s.budget}&n=${s.n}&horizon=${horizonDays()}&risk=${s.risk}&fee=${encodeURIComponent(s.fee)}&months=${$("#months").value}`);
    const j = await r.json(); if (!r.ok || j.error) throw new Error(j.error || `http ${r.status}`);
    setFixture(j.meta); $("#btOut").hidden = false; drawEquity(j); renderStats(j); renderCycles(j);
  } catch (e) { toast("Backtest failed: " + e.message, 5000); }
  finally { btn.disabled = false; btn.textContent = "Run the walk-forward"; }
}
function drawEquity(j) {
  const cv = $("#eq"), dpr = window.devicePixelRatio || 1, W = cv.clientWidth || 600, H = 220;
  cv.width = W * dpr; cv.height = H * dpr;
  const ctx = cv.getContext("2d"); ctx.scale(dpr, dpr); ctx.clearRect(0, 0, W, H);
  const series = [{ pts: j.equity, color: "#22c55e", label: "this plan" }, { pts: j.benchmark, color: "#8b98a9", label: `just hold ${j.stats.benchmarkSymbol}` }].filter(s => s.pts?.length > 1);
  if (!series.length) return;
  const all = series.flatMap(s => s.pts.map(p => p.v)), mn = Math.min(...all) * 0.97, mx = Math.max(...all) * 1.03;
  const t0 = Math.min(...series.map(s => s.pts[0].t)), t1 = Math.max(...series.map(s => s.pts[s.pts.length - 1].t));
  const X = t => 46 + (t - t0) / (t1 - t0 || 1) * (W - 56), Y = v => 14 + (1 - (v - mn) / (mx - mn || 1)) * (H - 42);
  ctx.font = "11px system-ui"; ctx.lineWidth = 1;
  for (const v of [mn, (mn + mx) / 2, mx]) { ctx.strokeStyle = "#243042"; ctx.beginPath(); ctx.moveTo(46, Y(v)); ctx.lineTo(W - 10, Y(v)); ctx.stroke(); ctx.fillStyle = "#8b98a9"; ctx.textAlign = "right"; ctx.fillText("$" + v.toFixed(0), 42, Y(v) + 4); }
  const yb = Y(j.meta.params.budget); ctx.strokeStyle = "#f5b82e88"; ctx.setLineDash([4, 4]); ctx.beginPath(); ctx.moveTo(46, yb); ctx.lineTo(W - 10, yb); ctx.stroke(); ctx.setLineDash([]);
  for (const s of series) { ctx.strokeStyle = s.color; ctx.lineWidth = 2; ctx.beginPath(); s.pts.forEach((p, i) => i ? ctx.lineTo(X(p.t), Y(p.v)) : ctx.moveTo(X(p.t), Y(p.v))); ctx.stroke(); }
  ctx.fillStyle = "#8b98a9"; ctx.textAlign = "left"; ctx.fillText(day(t0), 46, H - 6); ctx.textAlign = "right"; ctx.fillText(day(t1), W - 10, H - 6);
  let lx = 50; for (const s of series) { ctx.fillStyle = s.color; ctx.fillRect(lx, 5, 10, 3); ctx.fillStyle = "#e6edf3"; ctx.textAlign = "left"; ctx.fillText(s.label, lx + 14, 10); lx += ctx.measureText(s.label).width + 34; }
}
function verdict(s) {
  if (s.totalReturn < 0 && s.benchmarkReturn > 0) return "It lost money over a stretch where simply holding bitcoin made some. At this stake and these fees, the cheapest good idea may be one coin and patience.";
  if (s.totalReturn > s.benchmarkReturn && s.totalReturn > 0) return "It beat holding bitcoin over this stretch. A past stretch is not the next one; momentum works until the month it does not, and that month arrives without notice.";
  if (s.totalReturn > 0) return "It made money, but not more than holding bitcoin would have. The extra work bought risk, not return.";
  return "It lost money. Believe this tab over the Plan tab.";
}
function renderStats(j) {
  const s = j.stats;
  const rows = [
    ["Result", `${money(j.meta.params.budget)} → ${money(s.endCash)} (${pctf(s.totalReturn)})`, "wide", cls(s.totalReturn)],
    [`Just holding ${s.benchmarkSymbol}`, pctf(s.benchmarkReturn), "", cls(s.benchmarkReturn)],
    ["Worst drop", `−${(s.maxDrawdown * 100).toFixed(1)}%`],
    ["Cycles", `${s.cycles}, ${Math.round(s.winRate * 100)}% won`],
    ["Average cycle", pctf(s.avgCycle)],
    ["Fees paid", `${money(s.feesPaid)} (${(s.feesPctOfStake * 100).toFixed(0)}% of stake)`],
    ["Exits", `${s.exits.trend} trend · ${s.exits.stop} stop · ${s.exits.target} target · ${s.exits.horizon} time`, "wide"],
    ["Period", `${day(s.start)} – ${day(s.end)}, ${s.days} days`, "wide"],
  ];
  $("#btStats").innerHTML = rows.map(([k, v, w, c]) => `<div class="${w || ""}"><span>${k}</span><span class="${c || ""}">${v}</span></div>`).join("") + `<p class="hint wide">${verdict(s)}</p>`;
}
function renderCycles(j) {
  $("#btCycles").innerHTML = `<strong>Cycle by cycle</strong>` + j.cycles.map(c => `<details><summary>${day(c.start)} → ${day(c.end)}: <b class="${cls(c.ret)}">${pctf(c.ret)}</b> (${money(c.startCash)} → ${money(c.endCash)})</summary><table><tr><th>Coin</th><th class="r">In</th><th class="r">Out</th><th>Why</th><th class="r">P&amp;L</th></tr>${c.picks.map(p => `<tr><td>${esc(p.symbol)}</td><td class="r">${price(p.entry)}</td><td class="r">${p.exit != null ? price(p.exit) : "—"}</td><td>${esc(p.reason || "")}</td><td class="r ${cls(p.pnl)}">${pctf(p.pnl)}</td></tr>`).join("")}</table></details>`).join("");
}

/* ---------- boot ---------- */
function init() {
  bindControls(); renderAlerts(); renderPositions(); updateNotifyBtn();
  $("#trackBtn").onclick = openTrackDialog;
  $("#notifyBtn").onclick = enableNotifications;
  $("#pushBtn").onclick = enablePush;
  $("#trendBtn").onclick = () => { toast("Checking the daily trends…"); checkTrends(); };
  $("#clearAlerts").onclick = () => { state.alerts = []; saveAll(); renderAlerts(); };
  $("#resetBtn").onclick = () => { if (confirm("Forget every position and alert?")) { state.positions = []; state.alerts = []; saveAll(); renderPositions(); renderAlerts(); startLive(); syncPush(); } };
  $("#positions").addEventListener("click", (e) => {
    const b = e.target.closest("[data-close]"); if (!b) return;
    const pos = state.positions.find(p => p.product === b.dataset.close && !p.closed); if (!pos) return;
    const q = state.quotes[pos.product];
    const px = parseFloat(prompt(`What did you sell ${pos.symbol} at?`, q ? q.price : pos.entry));
    if (!(px > 0)) return;
    pos.closed = true; pos.exit = px; pos.closedAt = Date.now(); pos.pnl = px / pos.entry - 1;
    state.history.unshift(pos); state.positions = state.positions.filter(p => p !== pos);
    saveAll(); renderPositions(); startLive(); syncPush(); toast(`${pos.symbol} closed at ${pctf(pos.pnl)}.`);
  });
  document.addEventListener("click", (e) => { const t = e.target.closest("[data-addr]"); if (t) loadTrader(t.dataset.addr); });
  $("#tradersBand").addEventListener("change", loadTraders);
  $("#btBtn").onclick = runBacktest;
  if ("serviceWorker" in navigator) navigator.serviceWorker.register("/sw.js").then(initPush).catch(() => {});
  showTab(location.hash.replace("#", ""));
  if (state.positions.some(p => !p.closed)) startLive();     // keep watching from the moment the app opens
  runScreen();                                               // the first thing a visitor sees is picks
}
window.__popping = state;
init();
