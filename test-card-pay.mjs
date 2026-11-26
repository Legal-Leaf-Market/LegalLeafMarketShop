/* test-card-pay.mjs -- card checkout (public/js/card-pay.js) in real Chromium.
 *
 * A stub of the Medusa store API answers on this server, and NMI's Collect.js is
 * replaced at the network layer by a fake that hands back a token, so nothing
 * here reaches a real store or a real gateway. Pins:
 *   - card checkout stays OFF without a store, and OFF when the store offers no
 *     NMI card provider (the state until PaymentCloud's keys are set);
 *   - the cart sent to the store carries the lines, the Indiana address, the
 *     date of birth (which the store's 21+ hook reads) and the kiosk partner;
 *   - Collect.js is loaded from the sandbox host with the session's key;
 *   - the token, card display fields and billing address go on the session, and
 *     the cart is completed into an order;
 *   - a declined card comes back as the store's own message, not an exception.
 */
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { launchChrome } from "./tools/chrome-path.mjs";

const PORT = 3623, CDP = 9693;
const fails = [];
const ok = (n, c, x = "") => { console.log(`${c ? "  PASS" : "  FAIL"}  ${n}${x !== "" ? "   (" + x + ")" : ""}`); if (!c) fails.push(n); };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(fn, n = 100) { for (let i = 0; i < n; i++) { try { const v = await fn(); if (v) return v; } catch {} await wait(150); } throw new Error("timeout"); }

/* ---- the stub store ---- */
const log = [];
let providers = ["pp_nmi-card_nmi", "pp_system_default"];
let decline = false;
let session = {};
const cart = { id: "cart_1", total: 0, tax_total: 0 };
function body(req) { return new Promise((r) => { let d = ""; req.on("data", (c) => (d += c)); req.on("end", () => { try { r(JSON.parse(d || "{}")); } catch { r({}); } }); }); }
const PAGE = `<!doctype html><html><head><meta charset="utf-8"></head><body>
<div id="nmi-ccnumber"></div><div id="nmi-ccexp"></div><div id="nmi-cvv"></div>
<script src="/js/card-pay.js"></script></body></html>`;

const srv = createServer(async (req, res) => {
  const u = new URL(req.url, "http://x");
  const json = (o, code = 200) => { res.writeHead(code, { "content-type": "application/json" }); res.end(JSON.stringify(o)); };
  if (u.pathname === "/js/card-pay.js") { res.writeHead(200, { "content-type": "text/javascript" }); return res.end(await readFile("public/js/card-pay.js")); }
  if (!u.pathname.startsWith("/store/")) { res.writeHead(200, { "content-type": "text/html" }); return res.end(PAGE); }
  const b = req.method === "POST" ? await body(req) : {};
  log.push({ m: req.method, p: u.pathname + u.search, b, key: req.headers["x-publishable-api-key"] });
  const p = u.pathname;
  if (p === "/store/payment-providers") return json({ payment_providers: providers.map((id) => ({ id })) });
  if (p === "/store/carts" && req.method === "POST") { Object.assign(cart, { total: 0 }); return json({ cart }); }
  if (p === "/store/carts/cart_1/line-items") return json({ cart });
  if (p === "/store/carts/cart_1") { Object.assign(cart, b); return json({ cart }); }
  if (p === "/store/shipping-options") return json({ shipping_options: [{ id: "so_local" }] });
  if (p === "/store/carts/cart_1/shipping-methods") { Object.assign(cart, { total: 53.5, tax_total: 3.5 }); return json({ cart }); }
  if (p === "/store/payment-collections") return json({ payment_collection: { id: "pc_1" } });
  if (p === "/store/payment-collections/pc_1/payment-sessions") {
    session = { ...session, ...(b.data || {}) };
    return json({ payment_collection: { id: "pc_1", payment_sessions: [{ provider_id: b.provider_id, data: { tokenizationKey: "tk_test", sandbox: true, ...session } }] } });
  }
  if (p === "/store/carts/cart_1/complete") {
    if (decline) return json({ type: "cart", cart, error: { message: "Your card was declined. Please try another card." } });
    return json({ type: "order", order: { id: "order_1", display_id: 7, total: 53.5 } });
  }
  json({ message: "not stubbed: " + p }, 404);
});
await new Promise((r) => srv.listen(PORT, "127.0.0.1", r));
const ORIGIN = `http://127.0.0.1:${PORT}`;

/* ---- the fake Collect.js ---- */
const FAKE_COLLECT = `window.CollectJS = {
  configure: function (c) { this.c = c; window.__collect = { key: (document.querySelector('script[src*="Collect.js"]') || {getAttribute:function(){return null}}).getAttribute('data-tokenization-key'), fields: Object.keys(c.fields || {}) }; setTimeout(function () { c.fieldsAvailableCallback && c.fieldsAvailableCallback(); }, 10); },
  startPaymentRequest: function () { var c = this.c; setTimeout(function () { c.callback({ token: 'tok_ok', card: { number: '411111******1111', type: 'visa' } }); }, 10); }
};`;

const { proc: ch } = await launchChrome(CDP, [], { userDataDir: "/tmp/_llcardpay" });
const t = await until(async () => (await (await fetch(`http://127.0.0.1:${CDP}/json/list`)).json()).find((x) => x.type === "page"));
const s = new globalThis.WebSocket(t.webSocketDebuggerUrl);
await new Promise((r) => s.addEventListener("open", r));
let id = 0; const pend = new Map(); const errs = []; const collectLoads = [];
const send = (method, params = {}) => new Promise((r) => { const i = ++id; pend.set(i, r); s.send(JSON.stringify({ id: i, method, params })); });
s.addEventListener("message", (e) => {
  const m = JSON.parse(e.data);
  if (m.method === "Runtime.exceptionThrown") errs.push(m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text);
  if (m.method === "Fetch.requestPaused") {
    collectLoads.push(m.params.request.url);
    send("Fetch.fulfillRequest", { requestId: m.params.requestId, responseCode: 200,
      responseHeaders: [{ name: "content-type", value: "text/javascript" }], body: Buffer.from(FAKE_COLLECT).toString("base64") });
  }
  if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); }
});
const ev = async (x) => {
  const r = await send("Runtime.evaluate", { expression: x, returnByValue: true, awaitPromise: true });
  if (r.result?.exceptionDetails) return { __error: r.result.exceptionDetails.exception?.description || "error" };
  return r.result?.result?.value;
};
await send("Runtime.enable");
await send("Fetch.enable", { patterns: [{ urlPattern: "*nmi.com/token/Collect.js*" }] });
await send("Page.navigate", { url: ORIGIN + "/" });
await until(() => ev(`!!window.LLCardPay`));
const STORE = `{url:${JSON.stringify(ORIGIN)},key:'pk_test',region:'reg_1'}`;

console.log("-- when card checkout is off --");
ok("no store: off", (await ev(`LLCardPay.ready(null).then(function(m){return m===null})`)) === true);
providers = ["pp_system_default"];
ok("store without an NMI card provider: off", (await ev(`LLCardPay.ready(${STORE}).then(function(m){return m===null})`)) === true);
providers = ["pp_nmi-card_nmi", "pp_system_default"];
ok("store with the NMI card provider: on", (await ev(`LLCardPay.ready(${STORE}).then(function(m){window.__make=m;return typeof m==='function'})`)) === true);

console.log("\n-- a paid order --");
log.length = 0;
const started = await ev(`(window.__co=__make()).start([{variant:'var_1',qty:2},{variant:'var_2',qty:1}],
  {name:'Jacob Kennedy',email:'buyer@example.com',phone:'8125550100',dob:'1990-05-01'},
  {line1:'1 Washington St',line2:'',city:'Columbus',zip:'47201',notes:'side door'},
  {channel:'kiosk',partner:'smoke-shop-1'})`);
ok("start resolves with the store's total", started && started.total === 53.5, JSON.stringify(started));
ok("every request carries the publishable key", log.every((r) => r.key === "pk_test"));
const lines = log.filter((r) => r.p === "/store/carts/cart_1/line-items").map((r) => r.b.variant_id + "x" + r.b.quantity);
ok("both lines reach the cart", lines.join() === "var_1x2,var_2x1", lines.join());
const upd = log.find((r) => r.p === "/store/carts/cart_1")?.b || {};
ok("Indiana delivery address", upd.shipping_address?.province === "IN" && upd.shipping_address?.postal_code === "47201" && upd.shipping_address?.country_code === "us");
ok("date of birth on cart metadata, for the store's 21+ hook", upd.metadata?.dob === "1990-05-01");
ok("kiosk partner recorded", upd.metadata?.channel === "kiosk" && upd.metadata?.partner === "smoke-shop-1");
ok("delivery option chosen", log.some((r) => r.p === "/store/carts/cart_1/shipping-methods" && r.b.option_id === "so_local"));
ok("Collect.js loaded from the sandbox host", collectLoads.length === 1 && /^https:\/\/sandbox\.nmi\.com\/token\/Collect\.js/.test(collectLoads[0]), collectLoads.join());
ok("with the session's tokenization key and the three card fields", (await ev(`JSON.stringify(window.__collect)`)) === JSON.stringify({ key: "tk_test", fields: ["ccnumber", "ccexp", "cvv"] }));

const order = await ev(`__co.pay()`);
ok("pay resolves with the order", order && order.display_id === 7, JSON.stringify(order));
ok("the token went on the session", session.payment_token === "tok_ok" && session.payment_method === "card");
ok("card display fields went with it", session.card_type === "visa" && session.card_last4 === "1111");
ok("billing address for AVS went with it", session.billing && session.billing.postal_code === "47201" && session.billing.email === "buyer@example.com");

console.log("\n-- a declined card --");
decline = true; session = {};
await ev(`(window.__co=__make()).start([{variant:'var_1',qty:1}],{name:'A B',email:'a@b.co',phone:'1',dob:'1990-01-01'},{line1:'x',city:'Columbus',zip:'47201'})`);
const declined = await ev(`__co.pay().then(function(){return 'paid'},function(e){return e.message})`);
ok("the store's decline message comes back to show", declined === "Your card was declined. Please try another card.", declined);
ok("Collect.js was loaded fresh for the second form", collectLoads.length === 2);

ok("no script errors", errs.length === 0, errs.join(" | "));
s.close(); ch.kill(); srv.close();
console.log(fails.length ? `\n${fails.length} FAILED` : "\nall passed");
process.exit(fails.length ? 1 : 0);
