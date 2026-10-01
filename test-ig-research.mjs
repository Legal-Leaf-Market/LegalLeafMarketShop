/* api/ig-research.js: the gate, and the JSON extraction.
 *
 * No key and no browser. What is worth pinning here is the REFUSALS -- this route
 * spends money, so the interesting cases are the ones where it declines to. */
import { _internals } from "./api/ig-research.js";

const fails = [];
const ok = (n, c, x = "") => { console.log(`${c ? "  PASS" : "  FAIL"}  ${n}${x ? "   (" + x + ")" : ""}`); if (!c) fails.push(n); };

/* A fake res that records what the handler said. */
function mkRes() {
  const r = { statusCode: 0, headers: {}, body: null };
  r.setHeader = (k, v) => { r.headers[k.toLowerCase()] = v; };
  r.end = b => { r.body = b; };
  return r;
}
const mkReq = (method, headers = {}, body = {}) => ({ method, headers, body });

const { default: handler } = await import("./api/ig-research.js");

console.log("\nit fails closed");
const savedToken = process.env.LL_ADMIN_TOKEN, savedKey = process.env.ANTHROPIC_API_KEY;
delete process.env.LL_ADMIN_TOKEN;

let res = mkRes();
await handler(mkReq("GET"), res);
ok("GET is refused outright", res.statusCode === 405, String(res.statusCode));

res = mkRes();
await handler(mkReq("POST"), res);
ok("with no LL_ADMIN_TOKEN the route is off, not open", res.statusCode === 501, String(res.statusCode));
ok("and it says why rather than 500ing", /LL_ADMIN_TOKEN/.test(res.body || ""), (res.body || "").slice(0, 60));

process.env.LL_ADMIN_TOKEN = "s3cret";
res = mkRes();
await handler(mkReq("POST", { "x-ll-admin-token": "wrong" }), res);
ok("a wrong token is 401, not a spend", res.statusCode === 401, String(res.statusCode));

res = mkRes();
await handler(mkReq("POST", {}), res);
ok("a missing token is 401 too", res.statusCode === 401, String(res.statusCode));

delete process.env.ANTHROPIC_API_KEY;
res = mkRes();
await handler(mkReq("POST", { "x-ll-admin-token": "s3cret" }), res);
ok("right token but no provider key is 501, and never a model call", res.statusCode === 501, String(res.statusCode));

/* Restore, so a suite run cannot leave the environment altered for whatever imports next. */
if (savedToken === undefined) delete process.env.LL_ADMIN_TOKEN; else process.env.LL_ADMIN_TOKEN = savedToken;
if (savedKey === undefined) delete process.env.ANTHROPIC_API_KEY; else process.env.ANTHROPIC_API_KEY = savedKey;

console.log("\nJSON survives the ways models actually wrap it");
const { extractJson } = _internals;
ok("bare array", JSON.stringify(extractJson('[{"a":1}]')) === '[{"a":1}]');
ok("a preamble sentence before it", extractJson('Here are the findings:\n[{"a":1}]')?.[0]?.a === 1);
ok("a fenced block", extractJson('```json\n{"a":2}\n```')?.a === 2);
ok("trailing prose after the close", extractJson('{"a":3}\n\nHope that helps.')?.a === 3);
/* The one that breaks a naive lastIndexOf('}') implementation. */
ok("a brace inside a string does not end the object",
  extractJson('{"a":"a } brace","b":4}')?.b === 4);
ok("nested objects close at the right depth",
  extractJson('prose {"a":{"b":{"c":5}}} more')?.a?.b?.c === 5);
/* String.raw, because the fixture is about backslashes and writing it as a normal
   literal is how the first draft of this line ended up asserting against JSON that
   was genuinely malformed -- the test failed and the parser was fine. */
ok("an escaped quote inside a string",
  extractJson(String.raw`{"a":"say \"hi\"","b":6}`)?.b === 6);
ok("no JSON at all returns null, rather than throwing", extractJson("I could not find anything.") === null);
ok("malformed JSON returns null too", extractJson('{"a":') === null);

console.log("\nthe happy path, against a stubbed provider");
/* NO KEY AND NO NETWORK. This drives the real handler with globalThis.fetch
   replaced, which is the only way to check the two things unit tests cannot see:
   that the web_search tool reaches the wire with its `type` INTACT (the custom-tool
   mapping in api/llm.js used to strip it, and the symptom was a 400 about a
   malformed tool rather than anything naming this file), and that a realistic
   streamed response comes back out as findings. Everything above this line is about
   the route refusing; this is the one case where it should not. */
process.env.LL_ADMIN_TOKEN = "s3cret";
process.env.ANTHROPIC_API_KEY = "sk-ant-not-a-real-key";

const sse = (obj) => `event: ${obj.type}\ndata: ${JSON.stringify(obj)}\n\n`;
const FINDINGS = [{
  headline: "House returns without acting", what: "The chamber came back on Aug 31 and did not take up the CR.",
  why: "November 12 remains operative law.", date: "2026-08-31",
  sources: ["https://www.marijuanamoment.net/example"], confidence: "medium",
  angle: "the deadline is still real"
}];
const modelText = "Here are the findings:\n```json\n" + JSON.stringify(FINDINGS) + "\n```";

let sentBody = null;
const realFetch = globalThis.fetch;
globalThis.fetch = async (url, opts) => {
  sentBody = JSON.parse(opts.body);
  const stream = [
    sse({ type: "message_start", message: { usage: { input_tokens: 1200 } } }),
    sse({ type: "content_block_start", content_block: { type: "text", text: "" } }),
    sse({ type: "content_block_delta", delta: { type: "text_delta", text: modelText } }),
    sse({ type: "content_block_stop" }),
    sse({ type: "message_delta", delta: { stop_reason: "end_turn" }, usage: { output_tokens: 300 } }),
    sse({ type: "message_stop" })
  ].join("");
  return new Response(stream, { status: 200, headers: { "content-type": "text/event-stream" } });
};

res = mkRes();
await handler(mkReq("POST", { "x-ll-admin-token": "s3cret" }, { mode: "findings", topic: "payment processors" }), res);
globalThis.fetch = realFetch;

ok("a good request returns 200", res.statusCode === 200, String(res.statusCode));
const out = JSON.parse(res.body || "{}");
ok("the finding survives the fence and the preamble", out.findings?.[0]?.headline === FINDINGS[0].headline);
ok("its source comes through", out.findings?.[0]?.sources?.[0] === FINDINGS[0].sources[0]);
ok("cost is reported rather than hidden", typeof out.usd === "number", String(out.usd));

const tool = (sentBody?.tools || [])[0];
ok("web_search reached the wire with its type intact",
  tool?.type === "web_search_20250305", JSON.stringify(tool));
ok("and with the per-request search cap on it", tool?.max_uses === 6, String(tool?.max_uses));
ok("the topic was actually passed to the model",
  JSON.stringify(sentBody?.messages || []).includes("payment processors"));
ok("no custom tool was smuggled alongside it", (sentBody?.tools || []).length === 1);

delete process.env.LL_ADMIN_TOKEN; delete process.env.ANTHROPIC_API_KEY;

console.log("\na response cut off by the token budget names the real cause");
/* Reported live: /ig-studio "isn't always returning" and "the model did not
   return usable JSON". draft mode asks for a title, 7 slide bodies, a claims
   array, a caption and hashtags -- reliably more text than findings, sharing
   its token budget with the search tool_use/tool_result blocks that precede
   it -- so a response that runs out of room mid-object read exactly like an
   unexplained model failure. The fix names the budget as the cause instead of
   leaving "did not return usable JSON" to stand in for every failure shape. */
process.env.LL_ADMIN_TOKEN = "s3cret";
process.env.ANTHROPIC_API_KEY = "sk-ant-not-a-real-key";

const truncated = '{"title":"A real headline","slides":[{"eyebrow":"THE FACTS","body":"<h1>Some copy that never';
globalThis.fetch = async (url, opts) => {
  sentBody = JSON.parse(opts.body);
  const stream = [
    sse({ type: "message_start", message: { usage: { input_tokens: 3400 } } }),
    sse({ type: "content_block_start", content_block: { type: "text", text: "" } }),
    sse({ type: "content_block_delta", delta: { type: "text_delta", text: truncated } }),
    sse({ type: "content_block_stop" }),
    sse({ type: "message_delta", delta: { stop_reason: "max_tokens" }, usage: { output_tokens: 8000 } }),
    sse({ type: "message_stop" })
  ].join("");
  return new Response(stream, { status: 200, headers: { "content-type": "text/event-stream" } });
};

res = mkRes();
await handler(mkReq("POST", { "x-ll-admin-token": "s3cret" }, { mode: "draft", finding: { headline: "test" } }), res);
globalThis.fetch = realFetch;

ok("a truncated draft is still a 502, not a false 200", res.statusCode === 502, String(res.statusCode));
const truncErr = JSON.parse(res.body || "{}");
ok("the error names the token limit, not a generic parse failure",
  /8000-token limit for draft mode/.test(truncErr.error || ""), truncErr.error);
ok("...and does not call it a JSON-shape problem, which it was not",
  !/did not return usable JSON/.test(truncErr.error || ""), truncErr.error);
ok("the raw truncated text is still handed back, for a human to judge",
  (truncErr.raw || "").includes("never"), truncErr.raw);

delete process.env.LL_ADMIN_TOKEN; delete process.env.ANTHROPIC_API_KEY;

console.log(fails.length ? `\n${fails.length} FAILED: ${fails.join(", ")}` : "\nAll assertions passed.");
process.exit(fails.length ? 1 : 0);
