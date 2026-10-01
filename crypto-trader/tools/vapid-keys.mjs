/* tools/vapid-keys.mjs — prints a fresh VAPID key pair. Paste the three lines
   into Vercel → Settings → Environment Variables. The private key is a secret:
   never commit it, never put it in client code. */
import crypto from "node:crypto";
const { privateKey } = crypto.generateKeyPairSync("ec", { namedCurve: "prime256v1" });
const jwk = privateKey.export({ format: "jwk" });
const pub = Buffer.concat([Buffer.from([4]), Buffer.from(jwk.x, "base64url"), Buffer.from(jwk.y, "base64url")]).toString("base64url");
console.log(`VAPID_PUBLIC_KEY=${pub}\nVAPID_PRIVATE_KEY=${jwk.d}\nVAPID_SUBJECT=mailto:you@example.com`);
