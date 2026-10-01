/* test-push.mjs — the Web Push crypto against the RFC 8291 Appendix A vector,
   the VAPID JWT against node's own verifier, and the handler's refusals.
   No network. `node test-push.mjs` */
import crypto from "node:crypto";
process.env.CT_NO_FETCH = "1";
const { encrypt, vapidJwt, vapidKeys, kv } = await import("./api/push.js");
const push = (await import("./api/push.js")).default;

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log("  FAIL:", m); } };
const b64u = (b) => Buffer.from(b).toString("base64url");

console.log("# RFC 8291 Appendix A");
{
  const V = {
    plaintext: "When I grow up, I want to be a watermelon",
    auth: "BTBZMqHH6r4Tts7J_aSIgg",
    uaPub: "BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4",
    asPriv: "yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw",
    asPub: "BP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A8",
    salt: "DGv6ra1nlYgDCS1FRnbzlw",
    shared: "kyrL1jIIOHEzg3sM2ZWRHDRB62YACZhhSlknJ672kSs",
    ikm: "S4lYMb_L0FxCeq0WhDx813KgSYqU26kOyzWUdsXYyrg",
    cek: "oIhVW04MRdy2XN9CiKLxTg",
    nonce: "4h_95klXJ5E_qnoN",
    out: "DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A_yl95bQpu6cVPTpK4Mqgkf1CXztLVBSt2Ks3oZwbuwXPXLWyouBWLVWGNWQexSgSxsj_Qulcy4a-fN",
  };
  const r = encrypt(V.plaintext, { p256dh: V.uaPub, auth: V.auth }, { priv: V.asPriv, salt: V.salt });
  ok(b64u(r.as) === V.asPub, `sender public key derived from the vector's private key: ${b64u(r.as)}`);
  ok(b64u(r.shared) === V.shared, `ECDH shared secret: ${b64u(r.shared)}`);
  ok(b64u(r.ikm) === V.ikm, `IKM: ${b64u(r.ikm)}`);
  ok(b64u(r.cek) === V.cek, `CEK: ${b64u(r.cek)}`);
  ok(b64u(r.nonce) === V.nonce, `NONCE: ${b64u(r.nonce)}`);
  ok(b64u(r.body) === V.out, `ciphertext with aes128gcm header, byte for byte:\n    got ${b64u(r.body)}\n    want ${V.out}`);
  // and an independent decrypt of a fresh (random) encryption round-trips
  const recv = crypto.createECDH("prime256v1"); recv.generateKeys();
  const auth = crypto.randomBytes(16);
  const fresh = encrypt("hello phone", { p256dh: b64u(recv.getPublicKey()), auth: b64u(auth) });
  const body = fresh.body, salt = body.subarray(0, 16), rs = body.readUInt32BE(16), idlen = body[20], asPub = body.subarray(21, 21 + idlen), ct = body.subarray(21 + idlen);
  const shared = recv.computeSecret(asPub);
  const ikm = Buffer.from(crypto.hkdfSync("sha256", shared, auth, Buffer.concat([Buffer.from("WebPush: info\0"), recv.getPublicKey(), asPub]), 32));
  const cek = Buffer.from(crypto.hkdfSync("sha256", ikm, salt, Buffer.from("Content-Encoding: aes128gcm\0"), 16));
  const nonce = Buffer.from(crypto.hkdfSync("sha256", ikm, salt, Buffer.from("Content-Encoding: nonce\0"), 12));
  const d = crypto.createDecipheriv("aes-128-gcm", cek, nonce); d.setAuthTag(ct.subarray(ct.length - 16));
  const pt = Buffer.concat([d.update(ct.subarray(0, ct.length - 16)), d.final()]);
  ok(rs === 4096 && idlen === 65 && pt[pt.length - 1] === 2 && pt.subarray(0, -1).toString() === "hello phone", "a fresh encryption decrypts with an independent receiver");
}

console.log("# VAPID");
{
  const { privateKey, publicKey } = crypto.generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  const jwk = privateKey.export({ format: "jwk" });
  const pub = b64u(Buffer.concat([Buffer.from([4]), Buffer.from(jwk.x, "base64url"), Buffer.from(jwk.y, "base64url")]));
  const jwt = vapidJwt("https://fcm.googleapis.com", { pub, priv: jwk.d, subject: "mailto:t@example.com" }, 1_800_000_000);
  const [h, p, s] = jwt.split(".");
  ok(JSON.parse(Buffer.from(h, "base64url")).alg === "ES256", "header alg ES256");
  const claims = JSON.parse(Buffer.from(p, "base64url"));
  ok(claims.aud === "https://fcm.googleapis.com" && claims.sub === "mailto:t@example.com" && claims.exp === 1_800_000_000 + 43200, `claims: ${JSON.stringify(claims)}`);
  ok(Buffer.from(s, "base64url").length === 64, "raw r||s signature, 64 bytes");
  ok(crypto.verify("sha256", Buffer.from(`${h}.${p}`), { key: publicKey, dsaEncoding: "ieee-p1363" }, Buffer.from(s, "base64url")), "signature verifies against the public key");
  ok(vapidKeys({}) === null && vapidKeys({ VAPID_PUBLIC_KEY: pub, VAPID_PRIVATE_KEY: jwk.d }).subject.startsWith("mailto:"), "keys read from env, subject defaulted");
  ok(kv({}) === null && kv({ KV_REST_API_URL: "https://x.upstash.io/", KV_REST_API_TOKEN: "t" }).url === "https://x.upstash.io", "kv config read from env, trailing slash trimmed");
}

console.log("# handler refusals (no env)");
{
  const fake = (method, url, body, headers = {}) => {
    const req = { method, url, headers, body };
    let status = 0, out = "";
    const res = { statusCode: 200, setHeader() {}, end(s) { out = s; status = res.statusCode; } };
    return push(req, res).then(() => ({ status, json: JSON.parse(out) }));
  };
  for (const k of ["VAPID_PUBLIC_KEY", "VAPID_PRIVATE_KEY", "KV_REST_API_URL", "KV_REST_API_TOKEN", "CRON_SECRET"]) delete process.env[k];
  const g = await fake("GET", "/api/push");
  ok(g.status === 200 && g.json.vapid === null && g.json.storage === "none" && g.json.need.includes("VAPID_PUBLIC_KEY"), `GET says what is missing: ${JSON.stringify(g.json)}`);
  const p = await fake("POST", "/api/push", { action: "subscribe", subscription: { endpoint: "https://e/x", keys: { p256dh: "a", auth: "b" } } });
  ok(p.status === 501, "POST without VAPID keys is 501, not a silent no-op");
  const c = await fake("GET", "/api/push?cron=1");
  ok(c.status === 501, "cron without CRON_SECRET refuses");
  process.env.CRON_SECRET = "s3cret";
  const c2 = await fake("GET", "/api/push?cron=1", undefined, { authorization: "Bearer wrong" });
  ok(c2.status === 401, "cron with the wrong bearer is 401");
  const c3 = await fake("GET", "/api/push?cron=1", undefined, { authorization: "Bearer s3cret" });
  ok(c3.status === 501 && c3.json.vapid === false, "cron with the right bearer but no keys/storage still refuses, and says which");
  const { privateKey } = crypto.generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  const jwk = privateKey.export({ format: "jwk" });
  process.env.VAPID_PUBLIC_KEY = b64u(Buffer.concat([Buffer.from([4]), Buffer.from(jwk.x, "base64url"), Buffer.from(jwk.y, "base64url")]));
  process.env.VAPID_PRIVATE_KEY = jwk.d;
  const b = await fake("POST", "/api/push", { action: "subscribe", subscription: { endpoint: "http://insecure/x", keys: { p256dh: "a", auth: "b" } } });
  ok(b.status === 400, "an http endpoint is refused");
  const m = await fake("POST", "/api/push", { action: "subscribe" });
  ok(m.status === 400, "a missing subscription is 400");
  const s = await fake("POST", "/api/push", { action: "subscribe", subscription: { endpoint: "https://push.example/x", keys: { p256dh: "a", auth: "b" } }, plan: {} });
  ok(s.status === 200 && s.json.stored === false, "keys but no storage: accepted, and honest that nothing was stored");
  const u = await fake("PUT", "/api/push");
  ok(u.status === 405, "PUT is 405");
}
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
