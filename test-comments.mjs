/* THE FIRST THING ON THIS SITE A STRANGER CAN WRITE INTO.

   Every other endpoint here reads a merchant's feed or is gated on
   LL_ADMIN_TOKEN. This one takes text from the public and puts it under a
   product we are paid to link to, which makes the REFUSALS the feature and the
   happy path the easy part. Most of this file is things that must not happen.

   The one that would be worst is the quietest: a stranger's comment appearing
   without anyone reading it. Nothing published by a stranger is the entire
   safety design, so it is asserted first, asserted again through the real
   handler, and asserted a third time by checking the shelf summary -- which is
   what every card back reads -- never carries a pending body.

     node test-comments.mjs
*/
import handler, { validate, summarise, MAX_BODY, MAX_PER_PRODUCT } from "./api/comments.js";

const fails = [];
const ok = (n, c, x = "") => { console.log(`${c ? "  PASS" : "  FAIL"}  ${n}${x ? "   (" + x + ")" : ""}`); if (!c) fails.push(n); };

/* An in-memory stand-in for KV, wired through the same env the module reads, so
   the real handler runs its real storage path. */
const STORE = new Map();
process.env.KV_REST_API_URL = "http://127.0.0.1:9/kv";
process.env.KV_REST_API_TOKEN = "test";
const realFetch = globalThis.fetch;
globalThis.fetch = async (url, opts) => {
  const u = String(url);
  if (!u.startsWith("http://127.0.0.1:9/kv")) return realFetch(url, opts);
  const path = u.slice("http://127.0.0.1:9/kv".length);
  const set = path.match(/^\/set\/([^/?]+)/);
  const get = path.match(/^\/get\/([^/?]+)/);
  if (set) { STORE.set(decodeURIComponent(set[1]), (opts && opts.body) || ""); return new Response(JSON.stringify({ result: "OK" }), { status: 200 }); }
  if (get) { const v = STORE.get(decodeURIComponent(get[1])); return new Response(JSON.stringify({ result: v == null ? null : v }), { status: 200 }); }
  return new Response(JSON.stringify({ result: null }), { status: 200 });
};

const TOKEN = "s3cret";
process.env.LL_ADMIN_TOKEN = TOKEN;

async function call(method, query = {}, body = null, token = null) {
  const out = { status: 0, body: null, headers: {} };
  const res = {
    setHeader(k, v) { out.headers[k] = v },
    status(c) { out.status = c; return this },
    json(j) { out.body = j; return this },
    send(b) { out.body = b; return this },
    end(b) { if (b) out.body = b; return this },
  };
  await handler({ method, query, body, headers: token ? { "x-ll-admin-token": token } : {} }, res);
  return out;
}

console.log("\n-- what is refused at the door --");
const bad = [
  ["a link", { productId: "p1", name: "A", body: "buy it at https://spam.example" }, /Links/],
  ["...a bare domain", { productId: "p1", name: "A", body: "cheaper on spamstore.com honestly" }, /Links/],
  ["...www", { productId: "p1", name: "A", body: "see www.spam.example" }, /Links/],
  ["html", { productId: "p1", name: "A", body: "nice <script>alert(1)</script>" }, /brackets/],
  ["...even in the name", { productId: "p1", name: "<b>A", body: "a real comment" }, /brackets/],
  ["nothing to say", { productId: "p1", name: "A", body: "x" }, /too short/],
  ["an essay", { productId: "p1", name: "A", body: "x".repeat(MAX_BODY + 50) }, /under/],
  ["no product", { productId: "", name: "A", body: "a real comment" }, /product/],
];
for (const [label, payload, why] of bad) {
  const v = validate(payload);
  ok(label + " is refused", !v.ok && why.test(v.why), v.ok ? "ACCEPTED" : v.why);
}
ok("a real comment is accepted", validate({ productId: "p1", name: "Dee", body: "Runs hot, worth it." }).ok);
ok("...and an empty name becomes Anonymous",
   validate({ productId: "p1", body: "Runs hot." }).value.name === "Anonymous");

console.log("\n-- NOTHING A STRANGER WRITES IS PUBLISHED --");
const posted = await call("POST", { now: 1000 }, { productId: "p1", name: "Dee", body: "Runs hot, worth it." });
ok("the write is accepted", posted.status === 200, JSON.stringify(posted.body));
ok("...as PENDING", posted.body && posted.body.status === "pending", posted.body && posted.body.status);
ok("...and says so to the person who wrote it", /once it has been read/i.test((posted.body || {}).note || ""));

const pub = await call("GET", { id: "p1" });
ok("the public thread is empty until somebody reads it", pub.body.n === 0, JSON.stringify(pub.body));

const shelf = await call("GET", {});
ok("and the shelf summary carries nothing either", !shelf.body.p || !shelf.body.p.p1,
   JSON.stringify(shelf.body.p || {}));
/* The strongest form of it: the pending BODY must not be anywhere in what the
   shelf serves, however the summary is shaped. */
ok("...not even the text, anywhere in the payload",
   !JSON.stringify(shelf.body).includes("Runs hot"), JSON.stringify(shelf.body).slice(0, 120));

console.log("\n-- moderation is the only way through --");
const noTok = await call("POST", { action: "approve", id: "p1", cid: "x" });
ok("approving without the token is refused", noTok.status === 403, String(noTok.status));

const queue = await call("GET", { pending: 1 }, null, TOKEN);
ok("the queue shows it to a moderator", queue.body.pending === 1, JSON.stringify(queue.body.pending));
const cid = queue.body.rows[0].id;

const okApprove = await call("POST", { action: "approve", id: "p1", cid }, null, TOKEN);
ok("approving works", okApprove.status === 200 && okApprove.body.ok);
const pub2 = await call("GET", { id: "p1" });
ok("...and now the public can read it", pub2.body.n === 1, JSON.stringify(pub2.body));
const shelf2 = await call("GET", {});
ok("...and the shelf summary carries the first one", shelf2.body.p.p1 && shelf2.body.p.p1.n === 1,
   JSON.stringify(shelf2.body.p.p1));
ok("...with its text, for the card back", /Runs hot/.test(shelf2.body.p.p1.first.body));

const hide = await call("POST", { action: "hide", id: "p1", cid }, null, TOKEN);
ok("hiding puts it back out of sight", hide.status === 200);
ok("...immediately", (await call("GET", { id: "p1" })).body.n === 0);
ok("...and off the shelf too", !(await call("GET", {})).body.p.p1);

console.log("\n-- a staff comment is staff because of the token, not the payload --");
const faker = await call("POST", { now: 5000 }, { productId: "p2", name: "Not Staff", body: "trust me", staff: true });
ok("a stranger cannot ask to be staff", faker.body.status === "pending", JSON.stringify(faker.body));
const q2 = await call("GET", { pending: 1 }, null, TOKEN);
const fake = q2.body.rows.find((r) => r.productId === "p2");
ok("...and the flag is not set from what they sent", !fake.staff, JSON.stringify(fake.staff));

const real = await call("POST", { now: 6000 }, { productId: "p2", name: "Dean", body: "This one is the pick." }, TOKEN);
ok("an admin publishes immediately", real.body.status === "ok", JSON.stringify(real.body));
const thread2 = await call("GET", { id: "p2" });
ok("...and is badged staff", thread2.body.comments[0] && thread2.body.comments[0].staff === true,
   JSON.stringify(thread2.body.comments));

console.log("\n-- rate and size limits --");
const first = await call("POST", { now: 10000 }, { productId: "p3", name: "Sam", body: "One comment." });
ok("the first one lands", first.status === 200, String(first.status));
const again = await call("POST", { now: 10500 }, { productId: "p3", name: "Sam", body: "And another." });
ok("a second from the same name inside a minute is refused", again.status === 429, String(again.status));
const later = await call("POST", { now: 10000 + 61000 }, { productId: "p3", name: "Sam", body: "Much later." });
ok("...but a minute later is fine", later.status === 200, String(later.status));

console.log("\n-- summarise() shows only what was approved, and the FIRST of it --");
const sum = summarise({ p: { z: [
  { id: "a", name: "A", body: "pending one", at: 1, status: "pending" },
  { id: "b", name: "B", body: "approved one", at: 2, status: "ok" },
  { id: "c", name: "C", body: "approved two", at: 3, status: "ok" },
] } });
ok("the count is of approved only", sum.p.z.n === 2, JSON.stringify(sum.p.z));
ok("...and the first shown is the first APPROVED, not the first written",
   sum.p.z.first.body === "approved one", sum.p.z.first.body);
ok("a product with only pending comments is absent entirely",
   !summarise({ p: { y: [{ id: "a", name: "A", body: "x", at: 1, status: "pending" }] } }).p.y);

console.log("\n-- with no storage attached it refuses honestly rather than swallowing --");
delete process.env.KV_REST_API_URL; delete process.env.KV_REST_API_TOKEN;
const off = await call("POST", {}, { productId: "p9", name: "A", body: "into the void" });
ok("a write is refused, not accepted into nowhere", off.status === 501, String(off.status));
ok("...and says what is missing", /Upstash|Neon/i.test(JSON.stringify(off.body)), JSON.stringify(off.body));
const offRead = await call("GET", {});
ok("a read still answers, empty", offRead.status === 200 && Object.keys(offRead.body.p || {}).length === 0);

console.log(`\n${fails.length ? "FAILED: " + fails.join(", ") : "All comment checks passed."}`);
process.exit(fails.length ? 1 : 0);
