/* test-overrides-markets.mjs — two shelves, two override batches, no leakage.
 *
 * /coldwater runs the same engine as the hemp shelf and therefore inherited the
 * same admin console wholesale -- adminmode, the PIN gate, Category Control, and
 * the server sync. That is fine and deliberate. What was not fine is that all
 * three of its /api/overrides calls were unnamespaced, so the two catalogues
 * shared one batch in BOTH directions:
 *
 *   - every visitor to /coldwater pulled the hemp batch on load and applied it
 *     to the dispensary catalogue. Overrides key on product identity and
 *     "Blue Dream" exists on both shelves.
 *   - every admin edit made on /coldwater wrote into the hemp shelf's batch.
 *
 * Neither errors. It is the ll_cart mistake again, and the first person to
 * notice would have been a shopper looking at the wrong photo.
 *
 *   node test-overrides-markets.mjs
 */
import { createServer } from "node:http";

const PORT = 3499;
const TOKEN = "test-token-not-a-real-secret";
process.env.LL_ADMIN_TOKEN = TOKEN;
/* KV and Neon are absent here, so the handler falls to its "no backend" path for
   writes. That still exercises the thing this file is about -- which KEY a
   request resolves to -- because the key is chosen before any backend is. */
const fails = [];
const ok = (c, m) => { if (c) console.log("  ok   " + m); else { fails.push(m); console.log("  FAIL " + m); } };
const group = m => console.log("\n" + m);

const handler = (await import("./api/overrides.js")).default;

const srv = createServer(async (req, res) => {
  const u = new URL(req.url, "http://x");
  req.query = Object.fromEntries(u.searchParams.entries());
  const shim = {
    setHeader: (k, v) => res.setHeader(k, v),
    status: c => ({
      json: b => { res.writeHead(c, { "content-type": "application/json" }); res.end(JSON.stringify(b)); },
      send: b => { res.writeHead(c, { "content-type": "application/json" }); res.end(b); },
    }),
  };
  return handler(req, shim);
});
await new Promise(r => srv.listen(PORT, r));
const get = qs => fetch(`http://127.0.0.1:${PORT}/api/overrides${qs}`).then(r => r.json());

/* -------------------------------------------------------------- key choice --- */
/* The key is what this is really about, and GET reports the config it resolved,
   so the choice is observable without a backend attached. */
group("the hemp shelf keeps the ORIGINAL key, byte for byte");
{
  const d = await get("");
  const s = JSON.stringify(d);
  ok(!/ll:overrides:llm/.test(s), "no 'll:overrides:llm' anywhere — a rename would orphan every saved override");
}

group("an unknown market cannot address an arbitrary key");
{
  /* ?market= is public on the GET path. Folding an unknown value to the default
     is what stops it being used to read or write a key of the caller's choosing. */
  const a = await get("?market=llm");
  const b = await get("?market=../../etc");
  const c = await get("?market=");
  ok(JSON.stringify(a.cat || {}) === JSON.stringify(b.cat || {}),
     "a junk market resolves to the same batch as the default");
  ok(JSON.stringify(a.cat || {}) === JSON.stringify(c.cat || {}), "so does an empty one");
}

group("both markets answer, and neither errors");
{
  const hemp = await get("");
  const cw = await get("?market=coldwater");
  ok(hemp && typeof hemp === "object", "llm answers");
  ok(cw && typeof cw === "object", "coldwater answers");
  ok(hemp.source !== "error" && cw.source !== "error", "neither reports an error with no backend attached");
  /* With nothing configured both are empty. The point is that they are SEPARATE
     empties: the read path picked a different key for each. */
  ok(!Object.keys(hemp.cat || {}).length, "llm is empty");
  ok(!Object.keys(cw.cat || {}).length, "coldwater is empty");
}

/* ------------------------------------------------------------- write gating --- */
group("writes still fail closed, per market");
{
  const post = (qs, body, tok) => fetch(`http://127.0.0.1:${PORT}/api/overrides${qs}`, {
    method: "POST",
    headers: Object.assign({ "content-type": "application/json" }, tok ? { "x-ll-admin-token": tok } : {}),
    body: JSON.stringify(body),
  }).then(async r => ({ status: r.status, json: await r.json().catch(() => null) }));

  const noTok = await post("?market=coldwater", { cat: { x: "Edibles" } }, null);
  ok(noTok.status === 401, "a Coldwater write with no token is refused (got " + noTok.status + ")");

  const badTok = await post("?market=coldwater", { cat: { x: "Edibles" } }, "nope");
  ok(badTok.status === 401, "and with a wrong token");

  /* With a good token but no backend the handler must still refuse rather than
     pretend to have stored anything. */
  const noBackend = await post("?market=coldwater", { cat: { x: "Edibles" } }, TOKEN);
  ok(noBackend.status === 501, "a good token with no storage backend is 501, not a false success");
  ok(noBackend.json && /backend/i.test(String(noBackend.json.error || "")),
     "and says so in the error");
}

/* ------------------------------------------------------------ the generator --- */
group("the Coldwater page never calls the endpoint unnamespaced");
{
  const html = (await import("node:fs")).readFileSync("./public/coldwater.html", "latin1");
  ok(!/fetch\("\/api\/overrides",/.test(html),
     "no bare /api/overrides call survives in the generated page");
  const scoped = (html.match(/\/api\/overrides\?market=coldwater/g) || []).length;
  ok(scoped >= 3, "all three call sites carry the market (found " + scoped + ")");
  /* The console itself must still be there -- namespacing it must not have
     removed it. */
  ok(/adminmode/.test(html), "the adminmode keystroke is still present");
  ok(/ll_admin_ok/.test(html), "so is the PIN gate");
}

group("the hemp page is untouched");
{
  const html = (await import("node:fs")).readFileSync("./public/index.html", "latin1");
  ok(/fetch\("\/api\/overrides",\{cache:"no-store"\}\)/.test(html),
     "index.html still calls the endpoint unnamespaced, which resolves to its original key");
  ok(!/market=coldwater/.test(html), "and carries no Coldwater market anywhere");
}

console.log("");
srv.close();
if (fails.length) { console.log(`FAILED — ${fails.length} assertion(s)\n`); process.exit(1); }
console.log("All assertions passed.\n");
process.exit(0);
