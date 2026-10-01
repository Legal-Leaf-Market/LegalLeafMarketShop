/* /ambassador and /api/ambassador.
   ---------------------------------------------------------------------------
   THE FAIL-CLOSED PATH IS THE POINT OF THIS SUITE, not the happy one.
   Every other endpoint here degrades to a per-instance Map, and for captures
   that is right: a lost capture is re-capturable, the operator still has the
   menu open. An application is not like that. Somebody types their name, their
   town and their email, reads "thanks, we'll be in touch", and if that landed
   in a Map on a lambda that has since been recycled it is gone and NOBODY
   KNOWS. They wait for a reply that was never possible.

   So with no backend attached this endpoint must return 503 and say to email
   instead. These assertions run with KV and Neon deliberately unset, which is
   the state a fresh deploy is actually in.

   The route is the other half: vercel.json and server.mjs must agree
   (CLAUDE.md 3), and this boots server.mjs, which is the copy that fails
   silently. */
import { spawn } from "node:child_process";


process.env.LL_NO_STORE_FETCH = "1";   // never call a real shop from a test; api/ reads it
                                       // per call, so setting it after the imports is fine.
const PORT = 3501;
let fails = 0;
const ok = (m, c, x = "") => { console.log((c ? "  PASS  " : "  FAIL  ") + m + (x ? `   (${x})` : "")); if (!c) fails++; };
const wait = ms => new Promise(r => setTimeout(r, ms));

/* Explicitly unset, so this exercises an unconfigured deploy rather than
   whatever happens to be in the developer's environment. */
const env = { ...process.env, PORT: String(PORT) };
for (const k of ["KV_REST_API_URL", "KV_REST_API_TOKEN", "UPSTASH_REDIS_REST_URL",
                 "UPSTASH_REDIS_REST_TOKEN", "DATABASE_URL", "POSTGRES_URL",
                 "POSTGRES_PRISMA_URL", "DATABASE_URL_UNPOOLED",
                 "POSTGRES_URL_NON_POOLING", "NEON_DATABASE_URL", "LL_CRM_WEBHOOK"]) delete env[k];

const srv = spawn(process.execPath, ["server.mjs"], { env, stdio: "ignore" });
const until = async (fn, tries = 80) => {
  for (let i = 0; i < tries; i++) { try { return await fn(); } catch { await wait(250); } }
  throw new Error("timed out");
};
const base = `http://127.0.0.1:${PORT}`;
await until(() => fetch(`${base}/api/ambassador`).then(r => { if (!r.ok) throw 0; return r; }));

const post = b => fetch(`${base}/api/ambassador`, {
  method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(b),
}).then(async r => ({ status: r.status, j: await r.json() }));

const good = {
  name: "Sam Rivers", email: "sam@example.com", town: "Sturgis", state: "MI",
  shops: "Two on Main St", why: "I live here", confirm: true,
};

/* ---- the page and its route --------------------------------------------- */
const page = await fetch(`${base}/ambassador`);
const html = await page.text();
ok("/ambassador is routed in server.mjs, not only in vercel.json", page.status === 200, `http ${page.status}`);
ok("and serves the apply page", /Bring your town onto Legal-Leaf/.test(html));
ok("it describes the work honestly, not just a title",
   /collector once or twice a week/.test(html) && /real job, not a badge/.test(html));
ok("it says there is no money and no shop relationship",
   /No money, ever/.test(html) && /no shop can pay to rank higher/.test(html));
ok("it says what is stored and that it can be deleted",
   /delete it/.test(html) && /do not\s+sell it/.test(html.replace(/\s+/g, " ")));
ok("it carries a honeypot the eye never sees", /class="hp"/.test(html) && /name="website"/.test(html));

/* ---- fail closed --------------------------------------------------------- */
const cfg = await (await fetch(`${base}/api/ambassador`)).json();
ok("GET reports that nothing is configured, before anybody types",
   cfg.accepting === false && /NOT CONFIGURED/.test(cfg.storage), JSON.stringify(cfg).slice(0, 90));

const r1 = await post(good);
ok("a valid application is REFUSED rather than accepted into a void", r1.status === 503, `http ${r1.status}`);
ok("and the refusal tells the applicant how to reach a human",
   /jake@nicotiamarket\.com/.test(r1.j.error || ""), (r1.j.error || "").slice(0, 80));
ok("it never claims success", r1.j.ok === false);

/* ---- validation, which must run whatever the backend is doing ------------ */
ok("a missing name is caught", (await post({ ...good, name: "" })).status === 400);
ok("a bad email is caught", (await post({ ...good, email: "nope" })).status === 400);
ok("a missing town is caught", (await post({ ...good, town: "" })).status === 400);
ok("a missing state is caught", (await post({ ...good, state: "" })).status === 400);
ok("an unticked confirmation is caught", (await post({ ...good, confirm: false })).status === 400);
ok("an email with a plus sign is NOT caught: rejecting a real address loses a real person",
   (await post({ ...good, email: "sam+leaf@example.co.uk" })).status === 503, "reached storage, not validation");

/* THE HONEYPOT ANSWERS 200. Telling a bot it was caught just teaches whoever
   wrote it to stop filling that field. */
const hp = await post({ ...good, website: "http://spam.example" });
ok("a honeypot submission is swallowed with 200, not told it was caught", hp.status === 200 && hp.j.ok === true,
   `http ${hp.status}`);
ok("and it is not stored, because it never reached storage",
   hp.j.stored === undefined, JSON.stringify(hp.j));

/* ---- PII is not one URL away from anybody ------------------------------- */
const openGet = await (await fetch(`${base}/api/ambassador`)).json();
ok("an unauthenticated GET never returns applications", openGet.applications === undefined,
   Object.keys(openGet).join(","));
const badTok = await fetch(`${base}/api/ambassador`, { headers: { "x-ll-admin-token": "wrong" } });
ok("and a wrong admin token is refused", badTok.status === 401, `http ${badTok.status}`);

srv.kill();

/* ---- AND NOW WITH A BACKEND ATTACHED -------------------------------------
   Everything above proves the endpoint refuses honestly. That is worth nothing
   on its own: a route that always 503s would pass all of it. So the same
   endpoint is booted again against a stub KV and asked to actually work. */
const { createServer } = await import("node:http");
const KVPORT = 3502;
const kvStore = new Map();
const kv = createServer((rq, rs) => {
  const u = new URL(rq.url, "http://x");
  const parts = u.pathname.split("/").filter(Boolean);          // ["set"|"get", key]
  const key = decodeURIComponent(parts[1] || "");
  if (parts[0] === "set") {
    let b = "";
    rq.on("data", c => { b += c; });
    rq.on("end", () => { kvStore.set(key, b); rs.end(JSON.stringify({ result: "OK" })); });
    return;
  }
  rs.end(JSON.stringify({ result: kvStore.has(key) ? kvStore.get(key) : null }));
});
await new Promise(r => kv.listen(KVPORT, r));

const env2 = { ...env, KV_REST_API_URL: `http://127.0.0.1:${KVPORT}`, KV_REST_API_TOKEN: "t",
               LL_ADMIN_TOKEN: "secret" };
const srv2 = spawn(process.execPath, ["server.mjs"], { env: env2, stdio: "ignore" });
await until(() => fetch(`${base}/api/ambassador`).then(r => { if (!r.ok) throw 0; return r; }));

const cfg2 = await (await fetch(`${base}/api/ambassador`)).json();
ok("with a store attached, GET says it is accepting", cfg2.accepting === true && cfg2.storage === "kv",
   JSON.stringify(cfg2).slice(0, 70));

const r2 = await post(good);
ok("a valid application is accepted and stored durably", r2.status === 200 && r2.j.ok === true && r2.j.stored === "kv",
   JSON.stringify(r2.j));
ok("the town is echoed so the page can thank them by name", r2.j.town === "Sturgis" && r2.j.state === "MI",
   `${r2.j.town}, ${r2.j.state}`);

/* Somebody on a slow connection taps twice. That must not become two people. */
await post({ ...good, why: "second thoughts, same person" });
const admin = await (await fetch(`${base}/api/ambassador`, { headers: { "x-ll-admin-token": "secret" } })).json();
ok("the admin can read the applications back with the token", admin.ok === true && Array.isArray(admin.applications),
   `count ${admin.count}`);
ok("a double submission updates rather than duplicating", admin.count === 1, `count ${admin.count}`);
ok("and the later text is the one kept", /second thoughts/.test(admin.applications[0].why || ""),
   (admin.applications[0].why || "").slice(0, 40));
ok("the stored row carries what the meeting needs and nothing more",
   admin.applications[0].email === "sam@example.com" && admin.applications[0].town === "Sturgis" &&
   admin.applications[0].at && !("website" in admin.applications[0]),
   Object.keys(admin.applications[0]).join(","));

/* A different town from the same person is a different application. */
await post({ ...good, town: "Three Rivers" });
const admin2 = await (await fetch(`${base}/api/ambassador`, { headers: { "x-ll-admin-token": "secret" } })).json();
ok("a second town from the same person is its own application", admin2.count === 2, `count ${admin2.count}`);

srv2.kill(); kv.close();

console.log("\n" + (fails ? `FAILED (${fails})` : "All assertions passed.") + "\n");
process.exit(fails ? 1 : 0);
