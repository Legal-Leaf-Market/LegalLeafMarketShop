/* test-netlify.mjs — production is Netlify, and this is what holds it to the repo.
 *
 * THE SITE IS SERVED BY THREE THINGS THAT CANNOT SEE EACH OTHER:
 *
 *   netlify.toml                  the publish directory, the redirects, the
 *                                 headers on files
 *   netlify/functions/api.mjs     the list of URLs Netlify hands to a function
 *                                 (`config.path` -- a literal, read at build)
 *   netlify/lib/routes.mjs        which api/ module each of those URLs runs
 *
 * and a fourth, server.mjs, that has to agree with all of them or the local
 * preview stops being a preview. Every routing bug this repo has written down
 * was two of those disagreeing in silence (CLAUDE.md §3, test-server-routes.mjs).
 * This suite is the conversation between them.
 *
 * IT DRIVES THE REAL FUNCTION, not a description of it. A web Request goes in,
 * the real handler in api/ runs, a web Response comes out -- the same three
 * steps Netlify performs.
 *
 * NO NETWORK, ENFORCED RATHER THAN HOPED FOR. `fetch` is replaced before
 * anything is imported: by default it throws, and the cron cases hand it the
 * answer they want and then read back what was asked. The share page and the
 * price recorder both fetch this site's own feed, and a suite that could reach
 * production would be one that passes or fails on production's mood.
 *
 *     node test-netlify.mjs
 */
process.env.LL_NO_STORE_FETCH = "1";
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";

const fails = [];
const ok = (n, c, x = "") => { console.log(`${c ? "  PASS" : "  FAIL"}  ${n}${x ? "   (" + x + ")" : ""}`); if (!c) fails.push(n); };
const group = m => console.log("\n" + m);

/* A clean slate. These are read at call time and the suite sets them itself. */
for (const k of ["CRON_SECRET", "LL_ADMIN_TOKEN", "ADMIN_PASSCODE", "ANTHROPIC_API_KEY", "ANTHROPIC_BASE_URL",
                 "KV_REST_API_URL", "KV_REST_API_TOKEN", "UPSTASH_REDIS_REST_URL", "UPSTASH_REDIS_REST_TOKEN",
                 "DATABASE_URL", "POSTGRES_URL", "LL_CRM_WEBHOOK", "RESEND_API_KEY", "URL", "NETLIFY_DEV"]) delete process.env[k];

const net = { calls: [], reply: null };
globalThis.fetch = async (url, init = {}) => {
  net.calls.push({ url: String(url), method: init.method || "GET", headers: new Headers(init.headers || {}) });
  if (net.reply) return net.reply(String(url), init);
  throw new Error("no network in this suite");
};
/* Everything a handler or a job says while `fn` runs, as lines. */
const hearing = async (fn) => {
  const lines = [], log = console.log, err = console.error;
  console.log = (...a) => lines.push(a.map(String).join(" ")); console.error = (...a) => lines.push(a.map(String).join(" "));
  let threw = "";
  try { await fn(); } catch (e) { threw = String((e && e.message) || e); } finally { console.log = log; console.error = err; }
  return { lines, threw };
};
const within = (ms, p) => Promise.race([p, new Promise(res => setTimeout(() => res("HUNG"), ms))]);

const { default: api, config } = await import("./netlify/functions/api.mjs");
const { resolve, load, ALIASES } = await import("./netlify/lib/routes.mjs");
const { nodeRequest, serve } = await import("./netlify/lib/node-compat.mjs");
const { decorate } = await import("./netlify/lib/edge-headers.mjs");
const { prepare } = await import("./netlify/lib/runtime.mjs");
const cron = await import("./netlify/lib/cron.mjs");

const SITE = "https://legal-leafmarket.com";
const call = (path, init = {}, context = {}) => api(new Request(SITE + path, init), context);
const json = async (r) => { try { return JSON.parse(await r.text()); } catch { return null; } };

/* Comments out, so nothing below can go green against prose. */
const toml = readFileSync("netlify.toml", "utf8").replace(/^\s*#.*$/gm, "");
const srv = readFileSync("server.mjs", "utf8");

console.log("\nProduction on Netlify\n");

/* ------------------------------------------------------------------ */
group("WHAT IS PUBLISHED, AND WHAT IS NOT");
/* The first deploy of this repo to Netlify had no publish directory. Netlify
   published the repository root: / was a 404, and CLAUDE.md, api/ and every
   planning document were downloadable by name. One line prevents both. */
ok("netlify.toml publishes public/ and nothing above it", /^\s*publish\s*=\s*"public"\s*$/m.test(toml));
ok("...with no build command, because there is nothing to build", !/^\s*command\s*=/m.test(toml));
ok("the functions directory is outside the publish directory",
   /^\s*directory\s*=\s*"netlify\/functions"\s*$/m.test(toml) && !existsSync("public/netlify"));
ok("api/ rides in the bundle, since no import statement names it", /included_files\s*=\s*\[[^\]]*"api\/\*\*"/.test(toml));
ok("...and says for itself that its .js files are ES modules",
   JSON.parse(readFileSync("api/package.json", "utf8")).type === "module");
ok("vercel.json is gone, so there is one description of production", !existsSync("vercel.json"));

/* ------------------------------------------------------------------ */
group("THE REDIRECTS ARE THE ONES THE LOCAL PREVIEW MAKES");
const tables = toml.split(/\n\[\[redirects\]\]/).slice(1).map(t => t.split(/\n\[/)[0]);
const field = (t, k) => { const m = t.match(new RegExp("^\\s*" + k + "\\s*=\\s*\"?([^\"\\n]+)\"?\\s*$", "m")); return m ? m[1].trim() : ""; };
const redirects = tables.map(t => ({ from: field(t, "from"), to: field(t, "to"), status: Number(field(t, "status")) }));
ok("netlify.toml's redirects were located", redirects.length >= 3, redirects.length + " rules");

const block = (name) => { const a = srv.indexOf("const " + name + " = {"); return a < 0 ? "" : srv.slice(a, srv.indexOf("\n}", a)); };
const pairs = (src) => Object.fromEntries([...src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "")
  .matchAll(/"(\/[^"]*)"\s*:\s*"([^"]+)"/g)].map(m => [m[1], m[2]]));
const LOCAL_REDIRECTS = pairs(block("REDIRECTS"));
const LOCAL_REWRITES = pairs(block("REWRITES"));
const LOCAL_API = pairs(block("API"));
ok("server.mjs's own three maps were located",
   Object.keys(LOCAL_REDIRECTS).length >= 2 && Object.keys(LOCAL_REWRITES).length >= 10 && Object.keys(LOCAL_API).length >= 10);

for (const r of redirects.filter(r => r.status !== 200)) {
  ok(`${r.from} -> ${r.to} is a redirect in both`, LOCAL_REDIRECTS[r.from] === r.to, LOCAL_REDIRECTS[r.from] || "absent locally");
}
/* /index.html -> / is the one the preview makes and netlify.toml does not list.
   / is served FROM index.html, and a forced rule on that path is the classic
   way to redirect / to itself; it has not been tried on Netlify, and every
   page carries a canonical link, which is what the redirect was for (CLAUDE.md §3). */
const unlisted = Object.keys(LOCAL_REDIRECTS).filter(f => f !== "/index.html" && !redirects.some(r => r.from === f && r.status !== 200));
ok("every redirect the preview makes is one production makes", unlisted.length === 0, unlisted.join(", ") || "all present");

const loud = redirects.find(r => r.from === "/p/theloudpack");
ok("/p/theloudpack is rewritten to its file, not redirected", !!loud && loud.status === 200 && existsSync("public" + loud.to), loud && loud.to);
ok("...and the function is told to stand aside for it", (config.excludedPath || []).includes("/p/theloudpack"));
ok("...as the preview already does", LOCAL_REWRITES["/p/theloudpack"] === "/theloudpack");

/* ------------------------------------------------------------------ */
group("THE FILESYSTEM IS THE ROUTE TABLE");
const walk = d => readdirSync(d).flatMap(f => { const p = d + "/" + f; return statSync(p).isDirectory() ? walk(p) : [p]; });
const files = walk("api").filter(f => f.endsWith(".js"));
const isHandler = f => /export\s+default\s+(async\s+)?function\s+handler\s*\(/.test(readFileSync(f, "utf8"));
const handlers = files.filter(isHandler);
const helpers = files.filter(f => /\/_[^/]+$/.test(f));
const libs = files.filter(f => !isHandler(f) && !helpers.includes(f));
ok("api/ was read", handlers.length >= 15 && libs.length >= 10, `${handlers.length} handlers, ${libs.length} libraries, ${helpers.length} helpers`);

/* THE ONE THAT MATTERS. A handler added to api/ must be live on the next
   deploy with no second file to remember -- that is what the filesystem gave
   this repo before, and what a hand-written table would have taken away. */
const lost = [];
for (const f of handlers) {
  const name = f.slice(4, -3);
  const r = resolve("/api/" + name);
  if (!r || r.module !== name || typeof (await load(r.module)) !== "function") lost.push(name);
}
ok("every handler in api/ is reachable at /api/<its own name>", lost.length === 0, lost.join(", ") || handlers.length + " reachable");

const crashers = [];
for (const f of libs) { const r = resolve("/api/" + f.slice(4, -3)); if (r && (await load(r.module)) !== null) crashers.push(f); }
ok("a library is not an endpoint", crashers.length === 0, crashers.join(", ") || libs.length + " answer 404");
ok("a _helper is never even looked at", helpers.every(f => resolve("/api/" + f.slice(4, -3)) === null), helpers.length + " helpers");
ok("a path cannot name a file outside api/",
   [ "/api/../server", "/api/%2e%2e/server", "/api/admin/../../server", "/api/a/b/c", "/api/.env", "/api/", "/api" ].every(p => resolve(p) === null));
/* admin/../products names a file that EXISTS and has a handler, so only the
   shape check can be what refuses it. */
ok("...and load() refuses the same shapes if asked directly",
   (await load("admin/../products")) === null && (await load("../api/products")) === null && (await load("admin/_gate")) === null);
ok("a name longer than any file here is not looked up at all", resolve("/api/" + "a".repeat(65)) === null && resolve("/api/" + "a".repeat(64)) !== null);
let r = await call("/api/kv");
ok("the function answers 404 for a library, and does not cache it", r.status === 404 && /no-store/.test(r.headers.get("cache-control") || ""), String(r.status));

/* ------------------------------------------------------------------ */
group("WHAT THE FILESYSTEM CANNOT SAY IS SAID ONCE, AND THE PREVIEW AGREES");
for (const [path, module] of Object.entries(ALIASES)) {
  ok(`${path} runs api/${module}.js in both`, LOCAL_API[path] === `./api/${module}.js`, LOCAL_API[path] || "absent locally");
}
const localOnly = Object.entries(LOCAL_API)
  .filter(([path, file]) => path !== "/p/" && file !== `./api${path.slice(4)}.js`)   // not simply /api/<name> -> api/<name>.js
  .filter(([path]) => !(path in ALIASES));
ok("the preview has no alias production lacks", localOnly.length === 0, localOnly.map(e => e[0]).join(", ") || "none");
ok("/p/<id> is the share page, with the id taken from the path",
   resolve("/p/abc").module === "share" && resolve("/p/abc").query.id === "abc" && LOCAL_API["/p/"] === "./api/share.js");
ok("...decoded, as the old rewrite's capture was", resolve("/p/a%20b").query.id === "a b");
ok("a trailing slash reaches the same handler", resolve("/admin/").module === "admin/home" && resolve("/api/products/").module === "products");
ok("...and a malformed escape is passed through rather than thrown", resolve("/p/%E0%A4%A").query.id === "%E0%A4%A");

/* `config.path` is a literal Netlify reads without running the file. An alias
   that is routed but not listed there is never handed to the function at all. */
const listed = (p) => (config.path || []).some(c => c === p || (c.endsWith("/*") && p.startsWith(c.slice(0, -1))));
const unheard = Object.keys(ALIASES).filter(p => !listed(p));
ok("every alias is a path Netlify actually hands to the function", unheard.length === 0, unheard.join(", ") || "all listed");
ok("...and so are /api/* and /p/*", listed("/api/products") && listed("/p/abc"));
const apiSrc = readFileSync("netlify/functions/api.mjs", "utf8");
ok("config is a literal object, which is the only kind Netlify can read",
   /export const config = \{\s*path: \[\s*('[^']+',?\s*)+\],\s*excludedPath: \[[^\]]*\],?\s*\};/.test(apiSrc));

/* ------------------------------------------------------------------ */
group("A REQUEST GOES IN, THE REAL HANDLER RUNS, A RESPONSE COMES OUT");
r = await call("/api/products?roster");
let body = await json(r);
ok("GET /api/products?roster answers from the real handler", r.status === 200 && Array.isArray(body && body.roster), String(r.status));
ok("...with nosniff, which netlify.toml cannot put on a function's answer", r.headers.get("x-content-type-options") === "nosniff");

r = await call("/api/market?roster");
ok("an alias reaches its handler", r.status === 200 && !!(await json(r)), String(r.status));
r = await call("/admin");
ok("/admin is answered by a function, with the handler's own redirect",
   r.status === 302 && /^\/admin\//.test(r.headers.get("location") || ""), `${r.status} ${r.headers.get("location")}`);
r = await call("/api/nope");
ok("an endpoint that does not exist is a 404, not a crash", r.status === 404);

r = await call("/api/subscribe", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: "a@example.com" }) });
body = await json(r);
ok("a JSON body arrives parsed", r.status === 200 && body && body.email === "a@example.com", String(r.status));
r = await call("/api/subscribe", { method: "POST", headers: { "content-type": "text/plain;charset=UTF-8" }, body: JSON.stringify({ email: "b@example.com" }) });
body = await json(r);
ok("...and so does a beacon's text/plain one", r.status === 200 && body && body.email === "b@example.com", String(r.status));
r = await call("/api/subscribe", { method: "POST", headers: { "content-type": "application/json" }, body: "{not json" });
ok("a body that is not what it claims gets the handler's own refusal, not a 500", r.status === 400, String(r.status));
{
  /* api/subscribe.js falls back to reading the stream, so the three above
     would pass with `req.body` never set at all. api/comments.js reads only
     `req.body`. So the parse is pinned on its own, and then that both ways of
     reading the same request still work. */
  const post = (type, body) => nodeRequest(new Request(SITE + "/x?a=1", { method: "POST", headers: type ? { "content-type": type } : {}, body }));
  let q = await post("application/json; charset=utf-8", '{"a":{"b":2}}');
  ok("req.body is the parsed object for JSON", q.body && q.body.a && q.body.a.b === 2);
  ok("...a string for text/plain", (await post("text/plain", "hello")).body === "hello");
  ok("...fields for a form post", (await post("application/x-www-form-urlencoded", "x=1&y=two")).body.y === "two");
  ok("...bytes for octet-stream", Buffer.isBuffer((await post("application/octet-stream", "abc")).body));
  ok("...and undefined when it is not what it claims, or claims nothing",
     (await post("application/json", "{nope")).body === undefined && (await post("", new Uint8Array([1, 2, 3]))).body === undefined);
  let raw = ""; for await (const c of q) raw += c;
  ok("the stream still carries the same bytes for a handler that reads it instead", raw === '{"a":{"b":2}}');
  ok("req.url keeps its query string, which the sign-in redirect is built from", q.url === "/x?a=1" && q.method === "POST");
  const poisoned = await nodeRequest(new Request(SITE + "/x?__proto__=a&__proto__=b&ok=1"));
  ok("?__proto__= cannot swap the query object's prototype", Object.getPrototypeOf(poisoned.query) === Object.prototype && poisoned.query.ok === "1");
}

r = await call("/api/track", { method: "POST", headers: { "content-type": "application/json", "user-agent": "Mozilla/5.0" },
  body: JSON.stringify({ vid: "v", sid: "s", events: [{ name: "page_view", t: 1 }] }) });
ok("a 204 has no body at all (a stream on a 204 is a thrown TypeError)", r.status === 204 && r.body === null, String(r.status));
r = await call("/api/products?roster", { method: "HEAD" });
ok("...and neither does the answer to a HEAD", r.status === 200 && r.body === null);

/* THE WIRING, through the function itself. Everything Netlify knows about the
   caller arrives in `context`, and each piece below reaches a real handler or
   it does not: these are the three lines of api.mjs that nothing else here
   would notice going missing. */
{
  const beacon = (context) => call("/api/track", { method: "POST", headers: { "content-type": "application/json", "user-agent": "Mozilla/5.0" },
    body: JSON.stringify({ vid: "v", sid: "s", events: [{ name: "page_view", t: 1 }] }) }, context);
  let waited = null;
  const heard = await hearing(() => beacon({ ip: "203.0.113.9", geo: { city: "Coldwater", country: { code: "US" }, subdivision: { code: "MI" } },
                                             waitUntil: p => { waited = p; } }));
  const line = heard.lines.find(l => l.startsWith("analytics "));
  const seen = line ? JSON.parse(line.slice(10)) : {};
  ok("context.geo reaches the handler that records it", seen.country === "US" && seen.region === "MI" && seen.city === "Coldwater", line ? `${seen.country}/${seen.region}/${seen.city}` : "no line");
  ok("context.waitUntil is given the handler's unfinished work", waited instanceof Promise);
  await waited;

  r = await call("/p/abc-123");
  body = await r.text();
  ok("/p/<id> reaches the share page with its id", /text\/html/.test(r.headers.get("content-type") || "") && body.includes('/p/abc-123"'), String(r.status));

  /* context.ip is what the sign-in limiter counts. Same platform address, a
     different forged X-Forwarded-For every time: the limiter must still close.
     Then a different platform address, same forgery: it must be open again. */
  process.env.ADMIN_PASSCODE = "correct-horse";
  const guess = (ip, i) => call("/api/admin/session", { method: "POST",
    headers: { "content-type": "application/json", "x-forwarded-for": `10.9.8.${i}`, "x-real-ip": `10.9.8.${i}` },
    body: JSON.stringify({ passcode: "wrong-" + i }) }, { ip });
  let shut = 0;
  for (let i = 1; i <= 30 && !shut; i++) if ((await guess("198.51.100.7", i)).status === 429) shut = i;
  ok("the sign-in limiter counts the platform's address, whatever the request claims", shut > 1, shut ? "closed at attempt " + shut : "never closed");
  ok("...and a different caller is not locked out by it", (await guess("198.51.100.8", 99)).status === 401);
  delete process.env.ADMIN_PASSCODE;
}

/* ------------------------------------------------------------------ */
group("THE CACHE POLICY IS THE HANDLER'S, SPLIT BETWEEN THE EDGE AND THE BROWSER");
r = await call("/api/price-history");
const edge = r.headers.get("netlify-cdn-cache-control") || "";
const browser = r.headers.get("cache-control") || "";
ok("the edge is told the whole policy", /s-maxage=1800/.test(edge) && /stale-while-revalidate=7200/.test(edge), edge);
ok("...and to share one copy between its nodes", /(^|,\s*)durable(,|$)/.test(edge), edge);
ok("the browser is not told the shared-cache half", !/s-maxage|stale-while-revalidate/.test(browser) && /public/.test(browser), browser);
ok("a cacheable answer carries a tag the edge can compare", /^W\/"[0-9a-f]+-.+"$/.test(r.headers.get("etag") || ""), r.headers.get("etag") || "none");
r = await call("/api/products?roster");
ok("no-store passes through untouched, and nothing is said to the edge",
   /no-store/.test(r.headers.get("cache-control") || "") && !r.headers.has("netlify-cdn-cache-control"), r.headers.get("cache-control"));
{
  const h = new Headers({ "cache-control": "public, s-maxage=604800, stale-while-revalidate=2592000, immutable" });
  decorate(h);
  ok("other directives survive the split on both sides",
     h.get("cache-control") === "public, immutable" && /immutable, durable$/.test(h.get("netlify-cdn-cache-control")), h.get("cache-control"));
  const m = new Headers({ "cache-control": "public, max-age=60" });
  decorate(m);
  ok("a policy with no s-maxage is nobody's business but the handler's",
     m.get("cache-control") === "public, max-age=60" && !m.has("netlify-cdn-cache-control"));
}
/* api/share.js sets its policy before it knows the outcome. With the feed
   unreachable -- which it is, here -- a real product's page answers "gone". */
r = await call("/p/some-product");
const gone = r.headers.get("netlify-cdn-cache-control") || "";
ok("an answer that is not a 200 keeps its lifetime but is not shared between edge nodes",
   r.status === 404 && /s-maxage=\d+/.test(gone) && !/durable/.test(gone), `${r.status} ${gone}`);

/* ------------------------------------------------------------------ */
group("THE CRON GATE STILL HOLDS, THROUGH THE FUNCTION");
/* Same three outcomes test-price-history.mjs pins on the handler, asked for
   through the door production uses. With no storage attached, the recorder
   refuses with 501 `no storage backend` BEFORE it reads the catalogue -- so
   that particular 501 is the proof a request got past the gate. */
r = await call("/api/price-history?record=1");
ok("unset, the scheduled path refuses", r.status === 501 && /no-store/.test(r.headers.get("cache-control") || ""), String(r.status));
process.env.CRON_SECRET = "s3cr3t";
r = await call("/api/price-history?record=1", { headers: { authorization: "Bearer wrong" } });
ok("a wrong secret is forbidden", r.status === 403, String(r.status));
r = await call("/api/price-history?record=1", { headers: { authorization: "Bearer s3cr3t" } });
body = await json(r);
ok("the right one reaches the recorder", r.status === 501 && body && body.error === "no storage backend", `${r.status} ${body && body.error}`);

/* ------------------------------------------------------------------ */
group("THE CALLER'S ADDRESS COMES FROM THE PLATFORM, NEVER FROM THE CALLER");
{
  const spoof = new Request(SITE + "/api/track", { headers: {
    "x-forwarded-for": "6.6.6.6, 10.0.0.1", "x-real-ip": "6.6.6.6",
    "x-geo-country": "ZZ", "x-geo-region": "ZZ", "x-geo-city": "Nowhere" } });
  let q = await nodeRequest(spoof, { client: { ip: "203.0.113.9", geo: { city: "São Paulo", country: { code: "BR" }, subdivision: { code: "SP" } } } });
  ok("x-forwarded-for and x-real-ip are the platform's", q.headers["x-forwarded-for"] === "203.0.113.9" && q.headers["x-real-ip"] === "203.0.113.9", q.headers["x-forwarded-for"]);
  ok("...and so is where the visitor is", q.headers["x-geo-country"] === "BR" && q.headers["x-geo-region"] === "SP");
  ok("...with the city encoded, since a header is ASCII", decodeURIComponent(q.headers["x-geo-city"]) === "São Paulo" && /^[\x20-\x7e]+$/.test(q.headers["x-geo-city"]), q.headers["x-geo-city"]);
  q = await nodeRequest(spoof, {});
  ok("a platform that reports nothing leaves nothing -- the spoofed values do not survive",
     !("x-forwarded-for" in q.headers) && !("x-real-ip" in q.headers) && !("x-geo-country" in q.headers) && !("x-geo-city" in q.headers));
  ok("the handlers that read them read these names",
     /header\(req, 'x-geo-country'\)/.test(readFileSync("api/track.js", "utf8")) && !/x-vercel-ip/.test(readFileSync("api/track.js", "utf8")));
  ok("the host a handler builds its own URLs from is the one that was asked", q.headers["x-forwarded-host"] === "legal-leafmarket.com" && q.headers["x-forwarded-proto"] === "https");
  const many = await nodeRequest(new Request(SITE + "/x?a=1&a=2&b=3"), {});
  ok("a repeated query key is an array, a single one a string", Array.isArray(many.query.a) && many.query.a.length === 2 && many.query.b === "3");
}

/* ------------------------------------------------------------------ */
group("THE ANSWER LEAVES WHEN THE HEAD IS READY, NOT WHEN THE HANDLER RETURNS");
{
  /* The concierge streams tokens and api/track.js answers before it forwards.
     Both depend on the Response existing while the handler is still running. */
  const order = [];
  let release;
  const gate = new Promise(res => { release = res; });
  const streaming = async (req, res) => {
    res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-store" });
    res.write("data: one\n\n");
    order.push("first chunk written");
    await gate;
    res.write("data: two\n\n");
    res.end();
    order.push("handler finished");
  };
  let held = null;
  const resp = await serve(streaming, new Request(SITE + "/api/concierge", { method: "POST" }), { waitUntil: p => { held = p; } });
  order.push("response returned");
  const reader = resp.body.getReader();
  const first = new TextDecoder().decode((await reader.read()).value);
  ok("the first chunk is readable while the handler is still working",
     first === "data: one\n\n" && order.join(" > ") === "first chunk written > response returned", order.join(" > "));
  ok("the platform is asked to keep the function alive for the rest", held instanceof Promise);
  release();
  const second = new TextDecoder().decode((await reader.read()).value);
  const end = await reader.read();
  await held;
  ok("...and the rest arrives, in order, and then the stream closes", second === "data: two\n\n" && end.done === true && order.at(-1) === "handler finished");

  const silent = await serve(async (req, res) => { res.statusCode = 302; res.setHeader("Location", "/x"); }, new Request(SITE + "/a"));
  ok("a handler that returns without ending is ended for it, as server.mjs does", silent.status === 302 && silent.headers.get("location") === "/x");

  const quiet = console.error; console.error = () => {};
  const boom = await serve(async (req, res) => {
    res.setHeader("Cache-Control", "public, s-maxage=600");
    res.setHeader("Set-Cookie", "session=half-made");
    throw new Error("boom");
  }, new Request(SITE + "/a"), { decorate });
  console.error = quiet;
  ok("a handler that throws is a 500", boom.status === 500);
  ok("...that is never cached, whatever the handler had already said about caching",
     /no-store/.test(boom.headers.get("cache-control") || "") && !boom.headers.has("netlify-cdn-cache-control"), boom.headers.get("cache-control"));
  ok("...and carries none of the headers the handler set before it failed", boom.headers.getSetCookie().length === 0);

  const cookies = await serve(async (req, res) => { res.setHeader("Set-Cookie", ["a=1; Path=/", "b=2; Path=/"]); res.status(200).json({ ok: true }); },
                              new Request(SITE + "/a"));
  ok("two cookies stay two headers", cookies.headers.getSetCookie().length === 2, cookies.headers.getSetCookie().join(" | "));

  /* A REQUEST ENDS IN AN ANSWER, NEVER IN THE 60-SECOND KILL. A header value
     that cannot be sent used to be discovered only when the head was built --
     after the response had been marked as sent -- so nothing answered and
     nothing failed: the caller simply waited. api/admin/sign-in.js echoes
     ?redirect= into Location, so one em dash in a url was enough. */
  const mute = console.error; console.error = () => {};
  const dash = await within(2000, serve(async (req, res) => { res.statusCode = 302; res.setHeader("Location", "/admin/\u2014"); res.end(); }, new Request(SITE + "/a")));
  ok("a header value that cannot be sent is a 500, at once", dash !== "HUNG" && dash.status === 500, dash === "HUNG" ? "hung" : String(dash.status));
  const crlf = await within(2000, serve(async (req, res) => { res.setHeader("X-Note", "a\r\nSet-Cookie: x=1"); res.status(200).json({}); }, new Request(SITE + "/a")));
  ok("...and so is a newline in one, which is also how a header is smuggled", crlf !== "HUNG" && crlf.status === 500 && !crlf.headers.has("set-cookie"));
  const odd = await within(2000, serve(async (req, res) => { res.status(101).end(); }, new Request(SITE + "/a")));
  ok("a status that cannot be sent is a 500 too", odd !== "HUNG" && odd.status === 500, odd === "HUNG" ? "hung" : String(odd.status));
  console.error = mute;

  /* The visitor closed the tab mid-stream. The handler is told, and what it
     writes afterwards goes nowhere quietly instead of throwing into its loop. */
  let closed = false, wroteAfter = false;
  const leaving = await serve(async (req, res) => {
    res.on("close", () => { closed = true; });
    res.writeHead(200, { "Content-Type": "text/event-stream" });
    res.write("data: one\n\n");
    await new Promise(r2 => setTimeout(r2, 30));
    res.write("data: two\n\n"); wroteAfter = true;
    res.end();
  }, new Request(SITE + "/a"), { waitUntil: p => { held = p; } });
  await leaving.body.cancel();
  await held;
  ok("a client that leaves mid-stream is a 'close' the handler hears, and later writes are harmless", closed && wroteAfter);
}

/* ------------------------------------------------------------------ */
group("TWO THINGS THE HOST DOES TO THE ENVIRONMENT");
{
  let env = {};
  prepare(env);
  ok("NODE_ENV is production, so the admin cookie is marked Secure", env.NODE_ENV === "production");
  env = { NETLIFY_DEV: "true" };
  prepare(env);
  ok("...but not under `netlify dev`, where the cookie has to work over http", env.NODE_ENV === undefined);

  /* Netlify's AI Gateway supplies an ANTHROPIC_API_KEY of its own when the
     project has not set one. api/llm.js would send it to api.anthropic.com,
     where it is refused: the concierge would read as configured and fail every
     turn. Treated as no key, it fails closed the way it was written to. */
  env = { ANTHROPIC_API_KEY: "gateway-key", ANTHROPIC_BASE_URL: "https://example.netlify.app/.netlify/ai/anthropic" };
  prepare(env);
  ok("a key that only works against Netlify's gateway is not treated as ours", !("ANTHROPIC_API_KEY" in env));
  env = { ANTHROPIC_API_KEY: "gw-123", NETLIFY_AI_GATEWAY_KEY: "gw-123", ANTHROPIC_BASE_URL: "https://ai.example.test/anthropic" };
  prepare(env);
  ok("...recognised by being Netlify's own gateway key, wherever its base url points", !("ANTHROPIC_API_KEY" in env));
  env = { ANTHROPIC_API_KEY: "k", NETLIFY_AI_GATEWAY_KEY: "other", NETLIFY_AI_GATEWAY_URL: "https://gw.example.test/v1", ANTHROPIC_BASE_URL: "https://gw.example.test/v1/anthropic" };
  prepare(env);
  ok("...or by arriving with the gateway's own address", !("ANTHROPIC_API_KEY" in env));
  env = { ANTHROPIC_API_KEY: "sk-ant-own" };
  prepare(env);
  ok("a key the project set itself is left exactly alone", env.ANTHROPIC_API_KEY === "sk-ant-own");
  for (const base of ["https://api.anthropic.com", "https://api.anthropic.com:443/v1", " https://anthropic.helicone.ai ", "not a url"]) {
    env = { ANTHROPIC_API_KEY: "sk-ant-own", ANTHROPIC_BASE_URL: base, NETLIFY_AI_GATEWAY_KEY: "gw-123", NETLIFY_AI_GATEWAY_URL: "https://gw.example.test/v1" };
    prepare(env);
    ok(`...including beside the project's own base url (${base.trim()})`, env.ANTHROPIC_API_KEY === "sk-ant-own");
  }
  ok("every function calls it", ["api", "cron-worker"].every(f => /\bprepare\(\);/.test(readFileSync(`netlify/functions/${f}.mjs`, "utf8"))));
}

/* ------------------------------------------------------------------ */
group("THE TWO NIGHTLY JOBS");
const sched = {};
for (const f of ["cron-products", "cron-price-history"]) sched[f] = (await import(`./netlify/functions/${f}.mjs`)).config;
const hhmm = (c) => { const [m, h] = String(c).split(/\s+/); return Number(h) * 100 + Number(m); };
ok("the refresh is scheduled", sched["cron-products"].schedule === "0 6 * * *", sched["cron-products"].schedule);
ok("the recorder is scheduled", sched["cron-price-history"].schedule === "20 8 * * *", sched["cron-price-history"].schedule);
ok("...after the refresh it prices", hhmm(sched["cron-products"].schedule) < hhmm(sched["cron-price-history"].schedule));
for (const [f, job] of [["cron-products", "products-refresh"], ["cron-price-history", "price-history"]]) {
  ok(`${f} starts a job the worker knows`, new RegExp(`dispatch\\('${job}'`).test(readFileSync(`netlify/functions/${f}.mjs`, "utf8")) && typeof cron.JOBS[job] === "function");
}
const worker = await import("./netlify/functions/cron-worker.mjs");
ok("the worker is a background function: fifteen minutes, where a scheduled one gets thirty seconds", worker.config.background === true && !("schedule" in worker.config));

/* THE WORKER IS A PUBLIC URL. It must refuse exactly as the handler behind it does. */
const knock = (auth) => new Request(SITE + cron.WORKER_PATH + "?job=price-history", { method: "POST", headers: auth ? { authorization: auth } : {} });
delete process.env.CRON_SECRET;
ok("with CRON_SECRET unset the worker refuses everyone", cron.authorised(knock("Bearer ")).ok === false && cron.authorised(knock("Bearer undefined")).ok === false);
ok("...and says that is why, rather than calling a missing variable a wrong password", /CRON_SECRET is not set/.test(cron.authorised(knock("Bearer x")).why || ""));
process.env.CRON_SECRET = "s3cr3t";
ok("a wrong secret is refused", cron.authorised(knock("Bearer nope")).ok === false && cron.authorised(knock("")).ok === false);
ok("...and one of a different length does not throw", cron.authorised(knock("Bearer s3cr3t-and-more")).ok === false);
ok("the right one is let in", cron.authorised(knock("Bearer s3cr3t")).ok === true);

/* THE SCHEDULED HALF. It does one thing -- knock on the worker -- and every way
   that can go quietly wrong has to be loud instead, because a background
   function answers 202 whether or not it then does anything. */
const ctx = { site: { url: SITE } };
delete process.env.CRON_SECRET;
let heard = await hearing(() => cron.dispatch("price-history", ctx));
ok("the scheduler will not start a job it cannot authorise, and says so", /CRON_SECRET is not set/.test(heard.threw), heard.threw.slice(0, 60));
process.env.CRON_SECRET = "s3cr3t\n";
heard = await hearing(() => cron.dispatch("price-history", ctx));
ok("...nor one whose secret the worker could never match (a pasted newline)", /whitespace/.test(heard.threw), heard.threw.slice(0, 70));
process.env.CRON_SECRET = "s3cr3t";
heard = await hearing(() => cron.dispatch("price-history", {}));
ok("...nor one with nowhere to send it", /own URL is unknown/.test(heard.threw), heard.threw.slice(0, 60));

net.calls.length = 0; net.reply = () => new Response(null, { status: 202 });
heard = await hearing(() => cron.dispatch("price-history", ctx));
let sent = net.calls[0] || { headers: new Headers() };
ok("it knocks on the worker, on this site, for the job it was scheduled for",
   !heard.threw && net.calls.length === 1 && sent.url === SITE + cron.WORKER_PATH + "?job=price-history" && sent.method === "POST", sent.url);
ok("...presenting the secret, as the old scheduler did", sent.headers.get("authorization") === "Bearer s3cr3t");
net.reply = () => new Response("nope", { status: 500 });
heard = await hearing(() => cron.dispatch("price-history", ctx));
ok("anything but 202 means the worker did not start, and the run fails", /not 202/.test(heard.threw), heard.threw.slice(0, 70));

/* THE WORKER HALF. */
net.calls.length = 0; net.reply = null;
heard = await hearing(() => cron.work(knock("Bearer nope"), ctx));
ok("a refused caller is logged, not retried", !heard.threw && heard.lines.some(l => /refused: wrong or missing secret/.test(l)));
ok("...and starts NOTHING: no job line, no request", !heard.lines.some(l => /\[cron\] price-history:/.test(l)) && net.calls.length === 0, heard.lines.join(" | ").slice(0, 80));
heard = await hearing(() => cron.work(new Request(SITE + cron.WORKER_PATH + "?job=rm-rf", { method: "POST", headers: { authorization: "Bearer s3cr3t" } }), ctx));
ok("an unknown job is refused by name", heard.lines.some(l => /no such job "rm-rf"/.test(l)) && net.calls.length === 0);

/* The recorder, run the way the worker runs it: in this process, through the
   handler's own gate. No storage is attached, so it stops at the 501 that
   proves it got that far. A 501 is not worth a retry -- a minute will not
   attach a database -- but it is a night that was not recorded, and the log
   must not be readable as a success. */
heard = await hearing(() => cron.work(knock("Bearer s3cr3t"), ctx));
ok("the worker runs the recorder through the handler's own gate",
   !heard.threw && heard.lines.some(l => /\[cron\] price-history: NOT RECORDED -- 501 .*no storage backend/.test(l)), heard.threw || heard.lines[0]);
ok("...and an unrecorded night does not read as a finished job",
   heard.lines.some(l => /WITHOUT doing its work/.test(l)) && !heard.lines.some(l => /price-history: done in/.test(l)));

/* Storage "attached", feed unreachable: the recorder answers 503, and that
   one IS thrown, because Netlify retries a background function that errors. */
process.env.KV_REST_API_URL = "https://kv.example.test"; process.env.KV_REST_API_TOKEN = "t";
net.calls.length = 0;
heard = await hearing(() => cron.work(knock("Bearer s3cr3t"), ctx));
ok("a recorder that fails is thrown, so the platform retries it", /price recorder answered 503/.test(heard.threw), heard.threw || "did not throw");
ok("...having asked this site, and only this site, for the feed", net.calls.length >= 1 && net.calls.every(c => c.url.startsWith(SITE + "/")), net.calls.map(c => c.url).join(", "));
delete process.env.KV_REST_API_URL; delete process.env.KV_REST_API_TOKEN;

/* The refresh: the forced re-read, then the ordinary request the edge keeps. */
net.calls.length = 0; net.reply = () => new Response('{"products":[]}', { status: 200, headers: { "x-ll-cache": "hit" } });
heard = await hearing(() => cron.work(new Request(SITE + cron.WORKER_PATH + "?job=products-refresh", { method: "POST", headers: { authorization: "Bearer s3cr3t" } }), ctx));
ok("the refresh forces a re-read, then asks for the feed the way a visitor does",
   !heard.threw && net.calls.length === 2 && net.calls[0].url === SITE + "/api/products?refresh=1" && net.calls[1].url === SITE + "/api/products",
   net.calls.map(c => c.url.replace(SITE, "")).join(" then "));
ok("...and says it is done only then", heard.lines.some(l => /products-refresh: done in/.test(l)));
net.calls.length = 0; net.reply = () => new Response("upstream", { status: 502 });
heard = await hearing(() => cron.work(new Request(SITE + cron.WORKER_PATH + "?job=products-refresh", { method: "POST", headers: { authorization: "Bearer s3cr3t" } }), ctx));
ok("a refresh that fails is thrown too", /products refresh answered 502/.test(heard.threw) && net.calls.length === 1, heard.threw);
net.reply = null;
delete process.env.CRON_SECRET;

/* ------------------------------------------------------------------ */
group("NOTHING STILL ASKS THE OLD HOST FOR ANYTHING");
const pages = readdirSync("public").filter(f => f.endsWith(".html"));
const asking = pages.filter(f => readFileSync("public/" + f, "latin1").includes('src="/_vercel/'));
ok("no page loads a script from /_vercel/, a path that only existed there", asking.length === 0, asking.join(", ") || pages.length + " pages");
ok("...and neither does the share page", !/src="\/_vercel\//.test(readFileSync("api/share.js", "utf8")));
ok("no handler reads the old platform's environment", !files.some(f => /process\.env\.VERCEL/.test(readFileSync(f, "utf8"))));

console.log(`\n${fails.length ? "FAILED: " + fails.join(" | ") : "All Netlify checks passed."}\n`);
process.exit(fails.length ? 1 : 0);
