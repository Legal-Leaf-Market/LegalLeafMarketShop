/* api/push.js — background alerts, the part that reaches a phone with the app closed.
 *
 *   GET  /api/push              what is configured (VAPID public key, storage, cron)
 *   POST /api/push {action}     subscribe | sync | unsubscribe | test
 *   GET  /api/push?cron=1       the five-minute check, called by Vercel's scheduler
 *
 * Zero dependencies: VAPID (RFC 8292) is an ES256 JWT signed with node:crypto;
 * the payload is encrypted per RFC 8291 / RFC 8188 (aes128gcm) with ECDH on
 * P-256 + HKDF + AES-128-GCM, all in node:crypto. test-push.mjs pins the
 * encryption against the RFC 8291 Appendix A test vector byte for byte.
 *
 * FAILS CLOSED. Without VAPID keys every POST is 501 and GET says so. Without
 * KV storage a subscription is not remembered (test pushes still work, so a
 * phone can prove the pipe before storage is attached). Without CRON_SECRET
 * the cron path refuses: a scheduler gate that falls open when a variable is
 * missing is an open write that looks configured.
 *
 * Needs, in Vercel → Settings → Environment Variables:
 *   VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT   (node tools/vapid-keys.mjs)
 *   KV_REST_API_URL, KV_REST_API_TOKEN                   (attach Upstash/Vercel KV)
 *   CRON_SECRET                                          (any long random string)
 */
import crypto from "node:crypto";
import { params, send, readBody } from "./_util.js";
import { evaluatePosition, trendBrokenAt, analyse } from "../public/js/strategy.mjs";
import { coinbaseTicker, coinbaseCandles, memo } from "../lib/feeds.js";

const b64u = (buf) => Buffer.from(buf).toString("base64url");
const fromB64u = (s) => Buffer.from(String(s), "base64url");

export function vapidKeys(env = process.env) {
  const pub = env.VAPID_PUBLIC_KEY, priv = env.VAPID_PRIVATE_KEY;
  if (!pub || !priv) return null;
  return { pub, priv, subject: env.VAPID_SUBJECT || "mailto:popping@example.com" };
}

/* RFC 8292: JWT {aud, exp, sub} signed ES256, raw r||s signature */
export function vapidJwt(audience, { pub, priv, subject }, now = Math.floor(Date.now() / 1000)) {
  const header = b64u(JSON.stringify({ typ: "JWT", alg: "ES256" }));
  const payload = b64u(JSON.stringify({ aud: audience, exp: now + 12 * 3600, sub: subject }));
  const input = `${header}.${payload}`;
  const p = fromB64u(pub);
  if (p.length !== 65 || p[0] !== 4) throw new Error("VAPID_PUBLIC_KEY must be the 65-byte uncompressed P-256 point, base64url");
  const key = crypto.createPrivateKey({ key: { kty: "EC", crv: "P-256", x: b64u(p.subarray(1, 33)), y: b64u(p.subarray(33, 65)), d: priv }, format: "jwk" });
  const sig = crypto.sign("sha256", Buffer.from(input), { key, dsaEncoding: "ieee-p1363" });
  return `${input}.${b64u(sig)}`;
}

/* RFC 8291 + RFC 8188. `local` (sender private key + salt) exists so the test
   can reproduce the RFC's own vector; production always draws fresh ones. */
export function encrypt(plaintext, { p256dh, auth }, local = null) {
  const ua = fromB64u(p256dh), authSecret = fromB64u(auth);
  if (ua.length !== 65 || authSecret.length !== 16) throw new Error("bad subscription keys");
  const ecdh = crypto.createECDH("prime256v1");
  if (local?.priv) ecdh.setPrivateKey(fromB64u(local.priv)); else ecdh.generateKeys();
  const as = ecdh.getPublicKey();
  const shared = ecdh.computeSecret(ua);
  const salt = local?.salt ? fromB64u(local.salt) : crypto.randomBytes(16);
  const info = Buffer.concat([Buffer.from("WebPush: info\0"), ua, as]);
  const ikm = Buffer.from(crypto.hkdfSync("sha256", shared, authSecret, info, 32));
  const cek = Buffer.from(crypto.hkdfSync("sha256", ikm, salt, Buffer.from("Content-Encoding: aes128gcm\0"), 16));
  const nonce = Buffer.from(crypto.hkdfSync("sha256", ikm, salt, Buffer.from("Content-Encoding: nonce\0"), 12));
  const record = Buffer.concat([Buffer.from(plaintext, "utf8"), Buffer.from([2])]);   // 0x02: last record
  const cipher = crypto.createCipheriv("aes-128-gcm", cek, nonce);
  const ct = Buffer.concat([cipher.update(record), cipher.final(), cipher.getAuthTag()]);
  const rs = Buffer.alloc(4); rs.writeUInt32BE(4096);
  return { body: Buffer.concat([salt, rs, Buffer.from([as.length]), as, ct]), shared, ikm, cek, nonce, as };
}

export async function sendPush(subscription, payload, keys, { ttl = 3600, urgency = "high" } = {}) {
  const { body } = encrypt(JSON.stringify(payload), subscription.keys);
  const jwt = vapidJwt(new URL(subscription.endpoint).origin, keys);
  const r = await fetch(subscription.endpoint, {
    method: "POST", body,
    headers: { "content-encoding": "aes128gcm", "content-type": "application/octet-stream", "content-length": String(body.length), ttl: String(ttl), urgency, authorization: `vapid t=${jwt}, k=${keys.pub}` },
  });
  return { status: r.status, gone: r.status === 404 || r.status === 410 };
}

/* ---------- storage: Upstash / Vercel KV over REST ---------- */
export function kv(env = process.env) {
  return env.KV_REST_API_URL && env.KV_REST_API_TOKEN ? { url: env.KV_REST_API_URL.replace(/\/$/, ""), token: env.KV_REST_API_TOKEN } : null;
}
async function cmd(store, ...args) {
  const r = await fetch(store.url, { method: "POST", headers: { authorization: `Bearer ${store.token}`, "content-type": "application/json" }, body: JSON.stringify(args) });
  const j = await r.json();
  if (j.error) throw new Error(`kv: ${j.error}`);
  return j.result;
}
const subId = (endpoint) => crypto.createHash("sha256").update(endpoint).digest("hex").slice(0, 16);

function sanitisePlan(plan) {
  const num = (x) => (Number.isFinite(+x) ? +x : null);
  const positions = (Array.isArray(plan?.positions) ? plan.positions : []).slice(0, 20).map(p => ({
    id: String(p.id || "").slice(0, 40), symbol: String(p.symbol || "").slice(0, 12), product: /^[A-Z0-9]{2,12}-USD$/.test(p.product) ? p.product : null,
    entry: num(p.entry), units: num(p.units), dollars: num(p.dollars), stop: num(p.stop), target: num(p.target), stopPct: num(p.stopPct), high: num(p.high),
    sellBy: num(p.sellBy), openedAt: num(p.openedAt), vol30: num(p.vol30), targetHit: !!p.targetHit, horizonNotified: !!p.horizonNotified, trendNotified: !!p.trendNotified,
    horizonLabel: String(p.horizonLabel || "horizon").slice(0, 20),
  })).filter(p => p.product && p.entry > 0 && p.stop > 0 && p.target > 0 && p.stopPct > 0);
  return { positions, horizonLabel: String(plan?.horizonLabel || "").slice(0, 20) };
}

/* ---------- the five-minute check ---------- */
async function cron(req, res, keys, store) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return send(res, 501, { error: "CRON_SECRET unset; refusing to run" });
  if ((req.headers?.authorization || "") !== `Bearer ${secret}`) return send(res, 401, { error: "not the scheduler" });
  if (!keys || !store) return send(res, 501, { error: "needs VAPID keys and KV", vapid: !!keys, storage: !!store });
  const ids = JSON.parse((await cmd(store, "GET", "ct:subs")) || "[]");
  let checked = 0, sent = 0, dropped = 0, errors = 0;
  for (const id of ids) {
    const rec = JSON.parse((await cmd(store, "GET", `ct:sub:${id}`)) || "null");
    if (!rec?.subscription) continue;
    const positions = rec.plan?.positions || [];
    if (!positions.length) continue;
    const products = [...new Set(positions.map(p => p.product))];
    const quotes = await Promise.all(products.map(pr => memo(`cb:ticker:${pr}`, 4000, () => coinbaseTicker(pr)).catch(() => null)));
    const byP = Object.fromEntries(quotes.filter(Boolean).map(q => [q.product, q]));
    const msgs = [];
    for (const pos of positions) {
      const q = byP[pos.product]; if (!q) continue;
      checked++;
      let broken = false;
      try {
        const candles = await memo(`cb:candles:${pos.product}:86400:400`, 60 * 60e3, () => coinbaseCandles(pos.product, { bars: 400 }));
        const a = analyse(candles);
        const hh = Math.max(pos.high || pos.entry, ...candles.filter(c => c.t >= (pos.openedAt || 0) - 86400e3).map(c => c.h));
        if (hh > pos.high) pos.high = hh;
        broken = trendBrokenAt(a, a.n - 1);
      } catch { /* the price rules still run */ }
      for (const ev of evaluatePosition(pos, { price: q.price }, Date.now(), { trendBroken: broken })) {
        if (ev.level === "sell") msgs.push({ title: `Sell ${pos.symbol}`, body: ev.msg, tag: `${ev.type}:${pos.product}`, level: "sell", url: "/#live" });
      }
    }
    rec.plan.positions = positions; rec.checked = Date.now();
    await cmd(store, "SET", `ct:sub:${id}`, JSON.stringify(rec));
    for (const m of msgs) {
      const r = await sendPush(rec.subscription, m, keys).catch(() => ({ status: 0 }));
      if (r.gone) { dropped++; await cmd(store, "DEL", `ct:sub:${id}`); break; }
      if (r.status >= 200 && r.status < 300) sent++; else errors++;
    }
  }
  send(res, 200, { ok: true, subscriptions: ids.length, checked, sent, dropped, errors });
}

export default async function handler(req, res) {
  const P = params(req), keys = vapidKeys(), store = kv();
  if (req.method === "GET") {
    if (P.has("cron")) return cron(req, res, keys, store);
    return send(res, 200, { ok: true, vapid: keys ? keys.pub : null, storage: store ? "kv" : "none", cron: !!process.env.CRON_SECRET,
      need: [...(keys ? [] : ["VAPID_PUBLIC_KEY", "VAPID_PRIVATE_KEY", "VAPID_SUBJECT"]), ...(store ? [] : ["KV_REST_API_URL", "KV_REST_API_TOKEN"]), ...(process.env.CRON_SECRET ? [] : ["CRON_SECRET"])] });
  }
  if (req.method !== "POST") return send(res, 405, { error: "GET or POST" });
  if (!keys) return send(res, 501, { error: "push not configured", need: ["VAPID_PUBLIC_KEY", "VAPID_PRIVATE_KEY", "VAPID_SUBJECT"] });
  const body = (await readBody(req)) || {};
  const sub = body.subscription;
  if (!sub?.endpoint || !sub?.keys?.p256dh || !sub?.keys?.auth) return send(res, 400, { error: "subscription missing" });
  if (!/^https:\/\/[^/]+\//.test(sub.endpoint)) return send(res, 400, { error: "endpoint must be https" });
  const id = subId(sub.endpoint);
  try {
    switch (body.action) {
      case "test": {
        const r = await sendPush(sub, { title: "Popping is connected", body: "Background alerts reach this phone. You will hear from me when a coin hits its stop, breaks trend, or reaches its target.", tag: "hello", level: "info", url: "/#live" }, keys);
        return send(res, r.status < 300 ? 200 : 502, { ok: r.status < 300, status: r.status });
      }
      case "subscribe": case "sync": {
        if (!store) return send(res, 200, { ok: true, stored: false, note: "no storage attached: test pushes work, background checks do not" });
        const rec = { subscription: { endpoint: sub.endpoint, keys: { p256dh: sub.keys.p256dh, auth: sub.keys.auth } }, plan: sanitisePlan(body.plan), updated: Date.now() };
        await cmd(store, "SET", `ct:sub:${id}`, JSON.stringify(rec));
        const ids = JSON.parse((await cmd(store, "GET", "ct:subs")) || "[]");
        if (!ids.includes(id)) { ids.push(id); await cmd(store, "SET", "ct:subs", JSON.stringify(ids.slice(-500))); }
        return send(res, 200, { ok: true, stored: true, id, positions: rec.plan.positions.length });
      }
      case "unsubscribe": {
        if (store) { await cmd(store, "DEL", `ct:sub:${id}`); const ids = JSON.parse((await cmd(store, "GET", "ct:subs")) || "[]"); await cmd(store, "SET", "ct:subs", JSON.stringify(ids.filter(x => x !== id))); }
        return send(res, 200, { ok: true });
      }
      default: return send(res, 400, { error: "action must be subscribe, sync, unsubscribe or test" });
    }
  } catch (e) { return send(res, 500, { error: String(e?.message || e) }); }
}
