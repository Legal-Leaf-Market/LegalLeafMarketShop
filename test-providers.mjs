// test-providers.mjs -- pins the provider seam in api/llm.js. `node test-providers.mjs`.
//
// WHY THIS FILE IS SEPARATE FROM test-concierge.mjs
//
// That suite stubs the upstream API to pin OUR framing, which is right for the handler and useless
// here: the thing at risk in a seam is the translation itself, and a translation bug does not throw.
// History is replayed in full on every turn, so a mis-rendered tool result does not fail one request
// -- it silently corrupts every subsequent turn of that conversation. The two providers disagree in
// exactly the ways that produce no error:
//
//   * tool results: ONE message holding all of them (Anthropic) vs ONE MESSAGE EACH (OpenAI/Groq).
//     Get it backwards and Anthropic quietly stops making parallel calls while Groq mis-associates.
//   * tool arguments: an object (Anthropic) vs a JSON STRING (OpenAI/Groq). Keep the provider's own
//     representation and one of them ends up double-encoded, which parses fine and means nothing.
//   * an assistant turn that is only tool calls: OpenAI wants an explicit null content.
//   * streamed tool calls: keyed by `index`, with the name on the first fragment and the arguments
//     dribbled across the rest. Accumulate by id instead of index and multi-call turns interleave.
//
// No network. Both readers are driven with hand-built frames, because the point is what our code
// does with a frame sequence, not whether a vendor sends one.

import { PROVIDERS, configured, resolve, streamTurn, scrub, looksLikeSecret } from './api/llm.js';

let pass = 0, fail = 0;
const failures = [];
function ok(cond, label, extra) {
  if (cond) { pass++; console.log(`  ok   ${label}`); }
  else { fail++; failures.push(label); console.log(`  FAIL ${label}${extra ? `\n       ${extra}` : ''}`); }
}
function eq(a, b, label) {
  const same = JSON.stringify(a) === JSON.stringify(b);
  ok(same, label, same ? '' : `expected ${JSON.stringify(b)}\n       got      ${JSON.stringify(a)}`);
}

const { anthropic, compat } = PROVIDERS;

// The OpenAI-dialect instance is exercised through `compat`, which is now the only one. Groq was
// removed as a code entry (its free tier could not carry one turn and its paid tier was closed to new
// accounts), and the dialect it generalised into stayed -- so these assertions still cover the exact
// code path a Groq base url would run through, and Groq itself is one env var away if it is ever
// wanted again. The env is set here because compat, unlike a fixed-endpoint provider, has no default
// base url by design.
process.env.LL_OPENAI_COMPAT_BASE = process.env.LL_OPENAI_COMPAT_BASE || 'https://api.groq.com/openai/v1';

const TOOLS = [{
  name: 'search_catalog',
  description: 'Search the catalogue.',
  input_schema: { type: 'object', properties: { maxPerG: { type: 'number' } }, required: [] }
}];

// One conversation that exercises every shape: a text turn, an assistant turn that is nothing but
// two parallel tool calls, both results (one of them an error), then a normal answer.
const HISTORY = [
  { role: 'user', text: 'cheapest ounce?' },
  { role: 'assistant', text: '', calls: [
    { id: 'c1', name: 'search_catalog', args: { maxPerG: 5, sort: 'perG' } },
    { id: 'c2', name: 'get_product', args: { id: 'hipuffy__gold' } }
  ] },
  { role: 'tool', results: [
    { id: 'c1', name: 'search_catalog', output: '{"matched":31,"showing":12}', isError: false },
    { id: 'c2', name: 'get_product', output: '{"error":"sold out"}', isError: true }
  ] },
  { role: 'assistant', text: 'The Sour Diesel at $2.60/g.', calls: [] }
];

console.log('\n== tool results: one message vs one each ==');
{
  const a = anthropic.messages(HISTORY);
  const g = compat.messages('SYS', HISTORY);

  // Anthropic: the two results ride in ONE user message.
  const aTool = a.filter((m) => m.role === 'user' && Array.isArray(m.content)
    && m.content.some((c) => c.type === 'tool_result'));
  eq(aTool.length, 1, 'anthropic bundles both results into a single user message');
  eq(aTool[0].content.length, 2, 'and both are in it');
  eq(aTool[0].content.map((c) => c.tool_use_id), ['c1', 'c2'], 'keyed by tool_use_id, in order');
  eq(aTool[0].content[1].is_error, true, 'the failed one carries is_error');

  // Groq: one message EACH. Bundling is not representable in this shape.
  const gTool = g.filter((m) => m.role === 'tool');
  eq(gTool.length, 2, 'groq emits one tool message per result');
  eq(gTool.map((m) => m.tool_call_id), ['c1', 'c2'], 'keyed by tool_call_id, in order');
  ok(!('is_error' in gTool[1]), 'there is no is_error field in this shape');
  // So the error has to travel inside the content, or the model cannot tell a failed tool from an
  // empty one -- and it would then answer as though the product existed.
  ok(/^ERROR: /.test(gTool[1].content), 'so the failure is carried in the content instead');
  ok(!/^ERROR: /.test(gTool[0].content), 'and a successful result is not mislabelled');
}

console.log('\n== tool arguments: object vs JSON string ==');
{
  const a = anthropic.messages(HISTORY);
  const g = compat.messages('SYS', HISTORY);

  const aCall = a.find((m) => m.role === 'assistant' && Array.isArray(m.content)
    && m.content.some((c) => c.type === 'tool_use'));
  const use = aCall.content.find((c) => c.type === 'tool_use');
  ok(typeof use.input === 'object' && use.input !== null, 'anthropic sends input as an object');
  eq(use.input.maxPerG, 5, 'with the value intact');

  const gCall = g.find((m) => m.role === 'assistant' && m.tool_calls);
  const fn = gCall.tool_calls[0].function;
  ok(typeof fn.arguments === 'string', 'groq sends arguments as a JSON string');
  eq(JSON.parse(fn.arguments).maxPerG, 5, 'which parses back to the same value');
  // The double-encode: if the neutral shape had kept groq's string and re-stringified it, this would
  // be "\"{\\\"maxPerG\\\":5}\"" -- valid JSON that decodes to a string, not an object. It parses,
  // so nothing throws, and the model receives arguments it cannot use.
  ok(typeof JSON.parse(fn.arguments) === 'object', 'and is not double-encoded');
}

console.log('\n== an assistant turn that is only tool calls ==');
{
  const g = compat.messages('SYS', HISTORY);
  const gCall = g.find((m) => m.role === 'assistant' && m.tool_calls);
  eq(gCall.content, null, 'groq gets an explicit null content, not an empty string');

  const a = anthropic.messages(HISTORY);
  const aCall = a.find((m) => m.role === 'assistant' && Array.isArray(m.content)
    && m.content.some((c) => c.type === 'tool_use'));
  ok(!aCall.content.some((c) => c.type === 'text'), 'anthropic simply omits the text block');
  eq(aCall.content.length, 2, 'leaving only the two tool_use blocks');
}

console.log('\n== the system prompt goes to different places ==');
{
  const body = anthropic.body({ system: 'SYS', tools: TOOLS, history: HISTORY });
  ok(Array.isArray(body.system), 'anthropic: a top-level system array');
  eq(body.system[0].cache_control, { type: 'ephemeral' }, 'with the cache breakpoint on it');
  ok(!body.messages.some((m) => m.role === 'system'), 'and no system message in the array');

  const g = compat.messages('SYS', HISTORY);
  eq(g[0], { role: 'system', content: 'SYS' }, 'groq: messages[0] is the system turn');
  const gb = compat.body({ system: 'SYS', tools: TOOLS, history: HISTORY, model: 'test-model' });
  ok(!('system' in gb), 'with no top-level system field');
  // There is no cache_control in this API. Asserting its absence stops a future edit from copying
  // the Anthropic breakpoint across and quietly assuming a discount that does not exist.
  ok(!JSON.stringify(gb).includes('cache_control'), 'and no cache_control anywhere -- this API has none');
}

console.log('\n== tool schemas and token fields ==');
{
  const ab = anthropic.body({ system: 'S', tools: TOOLS, history: HISTORY });
  eq(ab.tools[0].input_schema.type, 'object', 'anthropic names the schema input_schema');
  ok('max_tokens' in ab, 'anthropic uses max_tokens');

  const gb = compat.body({ system: 'S', tools: TOOLS, history: HISTORY, model: 'test-model' });
  eq(gb.tools[0].type, 'function', 'groq wraps each tool as a function');
  eq(gb.tools[0].function.parameters.type, 'object', 'and names the schema parameters');
  eq(gb.tools[0].function.name, 'search_catalog', 'carrying the same name');
  ok('max_completion_tokens' in gb, 'groq uses max_completion_tokens');
  ok(!('max_tokens' in gb), 'and not the deprecated max_tokens');
}

console.log('\n== groq needs a model and says so ==');
{
  const before = process.env.LL_OPENAI_COMPAT_MODEL;
  delete process.env.LL_OPENAI_COMPAT_MODEL;
  let threw = null;
  try { compat.body({ system: 'S', tools: TOOLS, history: HISTORY }); } catch (e) { threw = e.message; }
  ok(threw && /model/i.test(threw), `an unconfigured model throws a named error rather than sending a bad request (${threw})`);
  process.env.LL_OPENAI_COMPAT_MODEL = 'from-env';
  eq(compat.body({ system: 'S', tools: TOOLS, history: HISTORY }).model, 'from-env', 'LL_OPENAI_COMPAT_MODEL is honoured');
  eq(compat.body({ system: 'S', tools: TOOLS, history: HISTORY, model: 'explicit' }).model, 'explicit',
    'and an explicit model wins over the env');
  if (before === undefined) delete process.env.LL_OPENAI_COMPAT_MODEL; else process.env.LL_OPENAI_COMPAT_MODEL = before;
}

console.log('\n== and the error names the ids, because the variable alone was not enough ==');
{
  // This is a real deploy's failure, not a hypothetical: LL_OPENAI_COMPAT_KEY set, LL_OPENAI_COMPAT_MODEL not, and every
  // turn answered "set LL_OPENAI_COMPAT_MODEL" -- which names the variable and not one usable value. Leaving
  // defaultModel null is still right; a stale id would be a 400 nobody can explain. So the throw asks
  // the provider what this key can use and says so.
  const beforeModel = process.env.LL_OPENAI_COMPAT_MODEL, beforeKey = process.env.LL_OPENAI_COMPAT_KEY;
  const realFetch = globalThis.fetch;
  delete process.env.LL_OPENAI_COMPAT_MODEL;
  process.env.LL_OPENAI_COMPAT_KEY = 'test-key';
  try {
    let asked = null;
    globalThis.fetch = async (url, init) => {
      asked = { url: String(url), auth: (init && init.headers && init.headers.authorization) || '' };
      return { ok: true, status: 200, json: async () => ({ data: [{ id: 'zeta-9' }, { id: 'alpha-1' }] }) };
    };
    let msg = null;
    try {
      await streamTurn('compat', { system: 'S', tools: TOOLS, history: HISTORY }, () => {});
    } catch (e) { msg = e.message; }
    ok(msg && /alpha-1/.test(msg) && /zeta-9/.test(msg),
      `the message lists what the key can actually use (${msg})`);
    ok(msg && msg.indexOf('alpha-1') < msg.indexOf('zeta-9'), 'sorted, so the text is stable between calls');
    ok(asked && /\/openai\/v1\/models$/.test(asked.url), `it asks the provider rather than guessing (${asked && asked.url})`);
    ok(asked && asked.auth === 'Bearer test-key', 'using the key already configured');
    ok(msg && /no model configured/.test(msg) && !/model: *['"]/.test(msg),
      'it is still the no-model error, and it still does not pick one -- that would be spending money by default');

    // The listing can fail too (a revoked key, a network refusal). That must not replace the original
    // diagnosis with a confusing second one.
    globalThis.fetch = async () => ({ ok: false, status: 401, json: async () => ({}), text: async () => '' });
    let msg2 = null;
    try {
      await streamTurn('compat', { system: 'S', tools: TOOLS, history: HISTORY }, () => {});
    } catch (e) { msg2 = e.message; }
    ok(msg2 && /no model configured/.test(msg2) && /check the key/.test(msg2),
      `a failed lookup still reports the real problem first (${msg2})`);
  } finally {
    globalThis.fetch = realFetch;
    if (beforeModel === undefined) delete process.env.LL_OPENAI_COMPAT_MODEL; else process.env.LL_OPENAI_COMPAT_MODEL = beforeModel;
    if (beforeKey === undefined) delete process.env.LL_OPENAI_COMPAT_KEY; else process.env.LL_OPENAI_COMPAT_KEY = beforeKey;
  }
}

console.log('\n== a secret in the model slot never leaves the process ==');
{
  // THIS IS A REAL INCIDENT, not a hypothetical. A Groq key was pasted into LL_OPENAI_COMPAT_MODEL. It travelled as
  // the model name, so it reached the provider's request log, came back inside their 404 ("the model
  // `gsk_...` does not exist"), and that text was forwarded to the browser -- so any visitor who opened
  // the concierge would have been shown the key. Three separate things had to be true for that, and
  // each is pinned below.
  const FAKE = 'gsk_' + 'a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6q7r8s9t0';
  const beforeModel = process.env.LL_OPENAI_COMPAT_MODEL, beforeKey = process.env.LL_OPENAI_COMPAT_KEY;
  const realFetch = globalThis.fetch;
  process.env.LL_OPENAI_COMPAT_KEY = 'test-key';
  process.env.LL_OPENAI_COMPAT_MODEL = FAKE;
  try {
    let sent = null;
    globalThis.fetch = async (url, init) => {
      sent = { url: String(url), body: (init && init.body) || '' };
      return { ok: false, status: 404, json: async () => ({}), text: async () => '' };
    };
    let msg = null;
    try { await streamTurn('compat', { system: 'S', tools: TOOLS, history: HISTORY }, () => {}); }
    catch (e) { msg = e.message; }
    // 1. It is refused BEFORE the request, because a leak into someone else's log cannot be recalled.
    ok(sent === null, 'no request was made at all -- the key never reached the provider');
    ok(msg && /looks like an API key/.test(msg), `and the error says what is wrong (${msg})`);
    // 2. The error does not quote the offending value back, which is what turned a typo into a leak.
    ok(msg && msg.indexOf(FAKE) === -1, 'the error does not echo the key it just refused');
    ok(msg && /LL_OPENAI_COMPAT_MODEL/.test(msg), 'it names the variable to fix instead');
    ok(msg && /leaked/.test(msg), 'and says to treat the key as compromised, because it was pasted somewhere it is logged');
  } finally {
    globalThis.fetch = realFetch;
    if (beforeModel === undefined) delete process.env.LL_OPENAI_COMPAT_MODEL; else process.env.LL_OPENAI_COMPAT_MODEL = beforeModel;
    if (beforeKey === undefined) delete process.env.LL_OPENAI_COMPAT_KEY; else process.env.LL_OPENAI_COMPAT_KEY = beforeKey;
  }
}

console.log('\n== the provider\'s prose never reaches the client ==');
{
  // 3. The third condition: an upstream error body was forwarded verbatim. A vendor's free-text message
  // quotes the request back, and there is no knowing in advance which field it will echo -- so the
  // status and the structured code go out, and the prose goes to the server log.
  const SECRET = 'gsk_' + 'zzzz1111yyyy2222xxxx3333wwww4444vvvv5555';
  const beforeModel = process.env.LL_OPENAI_COMPAT_MODEL, beforeKey = process.env.LL_OPENAI_COMPAT_KEY;
  const realFetch = globalThis.fetch, realErr = console.error;
  process.env.LL_OPENAI_COMPAT_KEY = 'test-key';
  process.env.LL_OPENAI_COMPAT_MODEL = 'a-real-looking-model';
  const logged = [];
  console.error = (...a) => logged.push(a.join(' '));
  try {
    globalThis.fetch = async (url) => {
      if (/\/models$/.test(String(url))) return { ok: true, status: 200, json: async () => ({ data: [{ id: 'model-b' }, { id: 'model-a' }] }) };
      return { ok: false, status: 404,
        json: async () => ({ error: { message: 'The model `' + SECRET + '` does not exist or you do not have access to it.',
          type: 'invalid_request_error', code: 'model_not_found' } }) };
    };
    let msg = null, status = null;
    try { await streamTurn('compat', { system: 'S', tools: TOOLS, history: HISTORY }, () => {}); }
    catch (e) { msg = e.message; status = e.status; }
    ok(msg && msg.indexOf(SECRET) === -1, `the thrown message carries no part of the vendor's prose (${msg})`);
    ok(msg && /model_not_found/.test(msg), 'but it does carry the structured code, which is safe and diagnostic');
    eq(status, 404, 'and the status survives for the handler to map');
    ok(msg && /model-a/.test(msg) && /model-b/.test(msg),
      'a wrong model id gets the same self-answering treatment as a missing one');
    ok(logged.some((l) => /model_not_found/.test(l)), 'the full body is still logged server-side');
    ok(logged.every((l) => l.indexOf(SECRET) === -1), 'with the recognised secret shapes scrubbed even there');
  } finally {
    globalThis.fetch = realFetch;
    console.error = realErr;
    if (beforeModel === undefined) delete process.env.LL_OPENAI_COMPAT_MODEL; else process.env.LL_OPENAI_COMPAT_MODEL = beforeModel;
    if (beforeKey === undefined) delete process.env.LL_OPENAI_COMPAT_KEY; else process.env.LL_OPENAI_COMPAT_KEY = beforeKey;
  }
}

console.log('\n== anthropic: Haiku by default, and nothing model-gated sent by accident ==');
{
  // THE NEAR MISS THIS PINS. `output_config.effort` reads like a universal cost lever and is not:
  // per the API reference it ERRORS on Haiku 4.5 and Sonnet 4.5. This adapter sent `effort: 'low'`
  // unconditionally, so pointing it at Haiku -- the cheap tier, the whole reason the concierge is
  // affordable -- would have 400'd every turn. Same shape of mistake as forwarding a generic effort
  // hint into Groq's `reasoning_effort`, one file over, caught the same way: by reading the reference
  // instead of assuming the parameter is universal.
  const env = { m: process.env.LL_ANTHROPIC_MODEL, e: process.env.LL_ANTHROPIC_EFFORT,
    f: process.env.LL_ANTHROPIC_FALLBACKS };
  try {
    delete process.env.LL_ANTHROPIC_MODEL;
    delete process.env.LL_ANTHROPIC_EFFORT;
    delete process.env.LL_ANTHROPIC_FALLBACKS;

    const b = anthropic.body({ system: 'S', tools: TOOLS, history: HISTORY, maxTokens: 1024 });
    eq(b.model, 'claude-haiku-4-5', 'the default model is the cheap tier');
    ok(!('output_config' in b), 'and no output_config at all -- effort errors on this model');
    ok(!('fallbacks' in b), 'no fallbacks either: they are for the frontier tier\'s classifiers');
    ok(!('thinking' in b), 'and no thinking field, which is the only value correct on both tiers');
    ok(!('anthropic-beta' in anthropic.headers('k')),
      'the fallback beta header rides with the parameter rather than being advertised alone');
    eq(b.max_tokens, 1024, 'the reservation is passed through');

    // A caller who moves up a tier gets the lever back, through config rather than a code change.
    process.env.LL_ANTHROPIC_MODEL = 'claude-opus-5';
    process.env.LL_ANTHROPIC_EFFORT = 'high';
    process.env.LL_ANTHROPIC_FALLBACKS = '1';
    const up = anthropic.body({ system: 'S', tools: TOOLS, history: HISTORY });
    eq(up.model, 'claude-opus-5', 'the model comes from the env');
    eq(up.output_config, { effort: 'high' }, 'and effort is sent once it is asked for');
    eq(up.fallbacks, 'default', 'as are fallbacks');
    ok('anthropic-beta' in anthropic.headers('k'), 'and now the beta header appears, in step with it');

    // The documented enum is checkable locally; which models accept the parameter is not.
    process.env.LL_ANTHROPIC_EFFORT = 'lowish';
    let threw = null;
    try { anthropic.body({ system: 'S', tools: TOOLS, history: HISTORY }); } catch (e) { threw = e.message; }
    ok(threw && /not one of/.test(threw) && /xhigh/.test(threw),
      `a value outside the documented set fails locally (${threw})`);
    process.env.LL_ANTHROPIC_EFFORT = 'off';
    ok(!('output_config' in anthropic.body({ system: 'S', tools: TOOLS, history: HISTORY })),
      '"off" suppresses it, matching the groq spelling');

    // The cache breakpoint stays regardless. It cannot engage at this prompt size on Haiku -- the
    // minimum cacheable prefix is 4096 tokens there against ~1,455 here -- but it costs nothing and
    // starts working the moment the model moves up. Asserted so a future edit does not "clean it up".
    delete process.env.LL_ANTHROPIC_MODEL;
    const hk = anthropic.body({ system: 'S', tools: TOOLS, history: HISTORY });
    eq(hk.system[0].cache_control, { type: 'ephemeral' },
      'the breakpoint is kept on Haiku even though the prefix is too short to cache');
  } finally {
    for (const [k, v] of [['LL_ANTHROPIC_MODEL', env.m], ['LL_ANTHROPIC_EFFORT', env.e],
      ['LL_ANTHROPIC_FALLBACKS', env.f]]) {
      if (v === undefined) delete process.env[k]; else process.env[k] = v;
    }
  }
}

console.log('\n== the same dialect, pointed anywhere ==');
{
  // "The Groq adapter" was never Groq-specific: it is the OpenAI chat-completions dialect, which many
  // hosts speak. It is built from config now and instantiated twice, so choosing a different cheap
  // provider is three env vars rather than a code change. This asserts the second instance really is
  // the same dialect and not a near-copy that will drift -- drift being the failure this whole file
  // exists to prevent.
  const env = { k: process.env.LL_OPENAI_COMPAT_KEY, b: process.env.LL_OPENAI_COMPAT_BASE,
    m: process.env.LL_OPENAI_COMPAT_MODEL, a: process.env.ANTHROPIC_API_KEY, g: process.env.LL_OPENAI_COMPAT_KEY };
  try {
    delete process.env.ANTHROPIC_API_KEY; delete process.env.LL_OPENAI_COMPAT_KEY;

    // A key with no base url is NOT configured. Otherwise it would be selected and then send every
    // turn to nowhere -- a failure that looks like the provider being down.
    process.env.LL_OPENAI_COMPAT_KEY = 'k';
    delete process.env.LL_OPENAI_COMPAT_BASE;
    eq(configured(), [], 'a compatible host with no base url does not count as configured');
    eq(resolve(null), null, 'so nothing is resolved');
    eq(resolve('compat'), null, 'and naming it explicitly does not bypass the check');

    process.env.LL_OPENAI_COMPAT_BASE = 'https://api.example-host.ai/v1/';
    process.env.LL_OPENAI_COMPAT_MODEL = 'some-cheap-model';
    eq(configured(), ['compat'], 'with both, it is available');
    eq(resolve(null), 'compat', 'and resolvable');
    eq(compat.url, 'https://api.example-host.ai/v1/chat/completions',
      'the endpoint is built from the base, with the trailing slash trimmed rather than doubled');

    // Byte-for-byte the same rendering as groq, which is the point of one factory rather than two files.
    process.env.LL_OPENAI_COMPAT_MODEL = 'some-cheap-model';
    eq(JSON.stringify(compat.messages('SYS', HISTORY)), JSON.stringify(compat.messages('SYS', HISTORY)),
      'history renders identically to the groq instance');
    eq(JSON.stringify(compat.tools(TOOLS)), JSON.stringify(compat.tools(TOOLS)), 'and so do the tool schemas');
    const cb = compat.body({ system: 'S', tools: TOOLS, history: HISTORY, maxTokens: 1024 });
    eq(cb.model, 'some-cheap-model', 'the model comes from its own env var');
    ok('max_completion_tokens' in cb && cb.stream === true, 'and the body is the same dialect');
    delete process.env.LL_OPENAI_COMPAT_MODEL;

    // Its own missing-model error names its own variable rather than the other provider's.
    delete process.env.LL_OPENAI_COMPAT_MODEL;
    let threw = null;
    try { compat.body({ system: 'S', tools: TOOLS, history: HISTORY }); } catch (e) { threw = e.message; }
    ok(threw && /LL_OPENAI_COMPAT_MODEL/.test(threw) && !/ANTHROPIC/.test(threw),
      `the error names the right variable (${threw})`);

    // Preference order: the fixed endpoint first, the explicitly pointed one last.
    process.env.ANTHROPIC_API_KEY = 'a'; process.env.LL_OPENAI_COMPAT_KEY = 'g';
    eq(configured(), ['anthropic', 'compat'], 'anthropic first, then the compatible host');
  } finally {
    for (const [k, v] of [['LL_OPENAI_COMPAT_KEY', env.k], ['LL_OPENAI_COMPAT_BASE', env.b],
      ['LL_OPENAI_COMPAT_MODEL', env.m], ['ANTHROPIC_API_KEY', env.a], ['LL_OPENAI_COMPAT_KEY', env.g]]) {
      if (v === undefined) delete process.env[k]; else process.env[k] = v;
    }
  }
}

console.log('\n== a 429 keeps its numbers, because they are the answer ==');
{
  // "Send the code, not the prose" is right and it threw away the one error where the detail IS the
  // fix: rate_limit_exceeded/tokens names the bucket and nothing else -- not the size, not what is
  // left, not how long to wait. Those are headers: structured, enumerated, and carrying nothing of
  // ours, so they can be surfaced without reopening the hole the rule closes.
  const beforeModel = process.env.LL_OPENAI_COMPAT_MODEL, beforeKey = process.env.LL_OPENAI_COMPAT_KEY;
  const realFetch = globalThis.fetch, realErr = console.error;
  process.env.LL_OPENAI_COMPAT_KEY = 'test-key';
  process.env.LL_OPENAI_COMPAT_MODEL = 'llama-3.3-70b-versatile';
  console.error = () => {};
  try {
    const headers = new Map([
      ['retry-after', '7.5'],
      ['x-ratelimit-limit-tokens', '6000'],
      ['x-ratelimit-remaining-tokens', '112']
    ]);
    globalThis.fetch = async () => ({
      ok: false, status: 429,
      headers: { get: (n) => (headers.has(String(n).toLowerCase()) ? headers.get(String(n).toLowerCase()) : null) },
      json: async () => ({ error: { message: 'Rate limit reached for model ... Used 5888, Requested 4096.',
        type: 'tokens', code: 'rate_limit_exceeded' } })
    });
    let msg = null, status = null;
    try { await streamTurn('compat', { system: 'S', tools: TOOLS, history: HISTORY, maxTokens: 1024 }, () => {}); }
    catch (e) { msg = e.message; status = e.status; }
    eq(status, 429, 'the status is preserved so a handler can back off on it');
    ok(msg && /rate_limit_exceeded/.test(msg), 'the code still travels');
    ok(msg && /6000/.test(msg) && /112 left/.test(msg), `the quota and the remainder come from headers (${msg})`);
    ok(msg && /retry in 7\.5/.test(msg), 'and so does the wait, which is the actionable part');
    ok(msg && /reserved 1024/.test(msg),
      'the request states its own reservation, which the provider cannot tell you and is usually the lever');
    ok(msg && !/Used 5888/.test(msg), 'the vendor prose is still not forwarded');

    // A provider that publishes none of those headers must degrade to the plain code, not to a message
    // full of "undefined".
    globalThis.fetch = async () => ({ ok: false, status: 429, headers: { get: () => null },
      json: async () => ({ error: { code: 'rate_limit_exceeded', type: 'tokens' } }) });
    let bare = null;
    try { await streamTurn('compat', { system: 'S', tools: TOOLS, history: HISTORY, maxTokens: 1024 }, () => {}); }
    catch (e) { bare = e.message; }
    ok(bare && !/undefined|null|NaN/.test(bare), `no headers means no header text, not "undefined" (${bare})`);
    ok(bare && /rate_limit_exceeded/.test(bare), 'and the code is still there');
  } finally {
    globalThis.fetch = realFetch;
    console.error = realErr;
    if (beforeModel === undefined) delete process.env.LL_OPENAI_COMPAT_MODEL; else process.env.LL_OPENAI_COMPAT_MODEL = beforeModel;
    if (beforeKey === undefined) delete process.env.LL_OPENAI_COMPAT_KEY; else process.env.LL_OPENAI_COMPAT_KEY = beforeKey;
  }
}

console.log('\n== scrub is a net, and is described as one ==');
{
  ok(scrub('key gsk_abcdefghijklmnopqrstuvwxyz012345 here').indexOf('gsk_abc') === -1, 'groq keys');
  ok(scrub('sk-ant-api03-' + 'x'.repeat(40)).indexOf('x'.repeat(40)) === -1, 'anthropic keys');
  ok(scrub('sk-' + 'y'.repeat(40)).indexOf('y'.repeat(40)) === -1, 'openai-style keys');
  eq(scrub('nothing secret here'), 'nothing secret here', 'and ordinary text is untouched');
  eq(scrub(null), '', 'null is empty, not the string "null"');
  ok(looksLikeSecret('gsk_abcdefghijklmnopqrstuvwxyz012345'), 'looksLikeSecret agrees with scrub');
  ok(!looksLikeSecret('llama-3.3-70b-versatile'), 'and a real model id is not mistaken for one');
  ok(!looksLikeSecret(''), 'empty is not a secret');
  ok(!looksLikeSecret(undefined), 'nor undefined');
  // Said out loud because the guarantee is narrow: this recognises PUBLISHED key prefixes. An
  // unrecognised shape passes straight through, which is exactly why the rule above is "send the code,
  // not the prose" rather than "scrub the prose and send it".
  ok(!looksLikeSecret('hunter2-but-actually-a-token'), 'an unrecognised shape is NOT caught -- this is a net, not a proof');
}

console.log('\n== reasoning_effort is opt-in, because a wrong value is a 400 ==');
{
  const before = process.env.LL_OPENAI_COMPAT_EFFORT;
  delete process.env.LL_OPENAI_COMPAT_EFFORT;
  // Per Groq's reference: low/medium/high on openai/gpt-oss-20b and -120b, none/default on qwen3, and
  // nothing at all on the llama models. A hardcoded model list here would rot, so nothing is inferred.
  const off = compat.body({ system: 'S', tools: TOOLS, history: HISTORY, model: 'm' });
  ok(!('reasoning_effort' in off), 'omitted when nothing asked for it');

  // THE CALLER'S GENERIC `effort` MUST NOT BECOME THIS PARAMETER. It exists for Anthropic's
  // output_config.effort, which every model there accepts. The concierge sets effort:'low' on every
  // turn as a cost lever, and forwarding that here made llama-3.3-70b-versatile -- the id in Groq's
  // own curl example, so the likeliest thing anyone sets -- a guaranteed 400. Two providers using the
  // same English word is not a reason to wire one to the other.
  const notForwarded = compat.body({ system: 'S', tools: TOOLS, history: HISTORY, model: 'm', effort: 'low' });
  ok(!('reasoning_effort' in notForwarded),
    'a provider-neutral effort hint is NOT translated into a model-gated groq parameter');

  process.env.LL_OPENAI_COMPAT_EFFORT = 'high';
  const on = compat.body({ system: 'S', tools: TOOLS, history: HISTORY, model: 'm' });
  eq(on.reasoning_effort, 'high', 'it comes only from the env var, set by whoever also chose the model');
  process.env.LL_OPENAI_COMPAT_EFFORT = 'off';
  const disabled = compat.body({ system: 'S', tools: TOOLS, history: HISTORY, model: 'm' });
  ok(!('reasoning_effort' in disabled), 'and "off" suppresses it for a model that rejects every value');

  // The allowed VALUES are enumerated in the API reference, so a typo can be caught here rather than
  // by a 400 that names nothing. Which of them a given model takes is still the model's business.
  for (const v of ['none', 'default', 'low', 'medium', 'high']) {
    process.env.LL_OPENAI_COMPAT_EFFORT = v;
    eq(compat.body({ system: 'S', tools: TOOLS, history: HISTORY, model: 'm' }).reasoning_effort, v,
      `"${v}" is accepted, per the reference`);
  }
  process.env.LL_OPENAI_COMPAT_EFFORT = 'lowest';
  let threw = null;
  try { compat.body({ system: 'S', tools: TOOLS, history: HISTORY, model: 'm' }); } catch (e) { threw = e.message; }
  ok(threw && /not one of/.test(threw) && /medium/.test(threw),
    `a value outside the documented set fails locally and names the set (${threw})`);
  if (before === undefined) delete process.env.LL_OPENAI_COMPAT_EFFORT; else process.env.LL_OPENAI_COMPAT_EFFORT = before;
}

console.log('\n== the request matches the documented contract ==');
{
  // Checked field by field against Groq's API reference rather than against memory of it. Each of these
  // is a documented requirement or a documented deprecation, and each is cheap to get wrong.
  process.env.LL_OPENAI_COMPAT_MODEL = 'llama-3.3-70b-versatile';
  const b = compat.body({ system: 'S', tools: TOOLS, history: HISTORY, maxTokens: 4096 });
  ok(typeof b.model === 'string' && b.model.length > 0, 'model: string, required');
  ok(Array.isArray(b.messages) && b.messages.length > 0, 'messages: array, required');
  ok('max_completion_tokens' in b && !('max_tokens' in b),
    'max_completion_tokens, and not the deprecated max_tokens');
  eq(b.stream, true, 'stream: true, so the reader gets deltas and a [DONE] sentinel');
  ok(b.tools.length <= 128, 'tools: within the documented maximum of 128');
  ok(b.tools.every((t) => t.type === 'function'), 'and every tool is type function, the only kind supported');
  ok(!('n' in b), 'n is left unset -- its documented range is 1-1, so sending it can only be wrong');
  ok(!('functions' in b) && !('function_call' in b), 'neither deprecated function field is sent');
  ok(!('logprobs' in b) && !('logit_bias' in b) && !('top_logprobs' in b),
    'and nothing the reference marks "not yet supported by any of our models"');
  delete process.env.LL_OPENAI_COMPAT_MODEL;
}

console.log('\n== the anthropic reader ==');
{
  const r = anthropic.reader();
  const seen = [];
  const feed = (f) => r.frame(f, (t) => seen.push(t));
  feed({ type: 'content_block_start', content_block: { type: 'text', text: '' } });
  feed({ type: 'content_block_delta', delta: { type: 'text_delta', text: 'Chea' } });
  feed({ type: 'content_block_delta', delta: { type: 'text_delta', text: 'pest' } });
  feed({ type: 'content_block_stop' });
  feed({ type: 'content_block_start', content_block: { type: 'tool_use', id: 'c9', name: 'search_catalog', input: {} } });
  for (const frag of ['{"maxP', 'erG":', '5}']) feed({ type: 'content_block_delta', delta: { type: 'input_json_delta', partial_json: frag } });
  feed({ type: 'content_block_stop' });
  feed({ type: 'message_delta', delta: { stop_reason: 'tool_use' } });
  const out = r.done();
  eq(seen.join(''), 'Cheapest', 'text deltas stream in order');
  eq(out.text, 'Cheapest', 'and accumulate into the turn');
  eq(out.calls, [{ id: 'c9', name: 'search_catalog', args: { maxPerG: 5 } }], 'fragmented arguments parse once, intact');
  eq(out.stopReason, 'tool_use', 'stop_reason comes off message_delta');
}

console.log('\n== a refusal, and the fact groq cannot signal one ==');
{
  const r = anthropic.reader();
  r.frame({ type: 'message_delta', delta: { stop_reason: 'refusal', stop_details: { category: 'cyber' } } }, () => {});
  const out = r.done();
  eq(out.stopReason, 'refusal', 'anthropic surfaces a structural refusal');
  eq(out.refusalCategory, 'cyber', 'with its category');

  // Groq has no refusal stop reason: a declined answer arrives as prose with finish_reason "stop",
  // indistinguishable from a real answer at this layer. Pinned because it is a real gap in what the
  // router can know, and the temptation later will be to assume parity.
  const g = compat.reader();
  g.frame({ choices: [{ delta: { content: 'I cannot help with that.' }, finish_reason: 'stop' }] }, () => {});
  const gout = g.done();
  eq(gout.stopReason, 'end_turn', 'groq reports a refusal as an ordinary end_turn');
  eq(gout.refusalCategory, null, 'with no category to report');
}

console.log('\n== the groq reader: tool calls arrive keyed by index ==');
{
  const r = compat.reader();
  const seen = [];
  const feed = (f) => r.frame(f, (t) => seen.push(t));
  feed({ choices: [{ delta: { content: 'Look' } }] });
  feed({ choices: [{ delta: { content: 'ing' } }] });
  // Two parallel calls, interleaved, with names on the first fragment and arguments dribbled after.
  // Accumulating by id instead of index would drop everything before the id arrives.
  feed({ choices: [{ delta: { tool_calls: [{ index: 0, id: 'c1', function: { name: 'search_catalog', arguments: '' } }] } }] });
  feed({ choices: [{ delta: { tool_calls: [{ index: 1, id: 'c2', function: { name: 'get_product', arguments: '' } }] } }] });
  feed({ choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: '{"maxPerG"' } }] } }] });
  feed({ choices: [{ delta: { tool_calls: [{ index: 1, function: { arguments: '{"id":"x' } }] } }] });
  feed({ choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: ':5}' } }] } }] });
  feed({ choices: [{ delta: { tool_calls: [{ index: 1, function: { arguments: '"}' } }] } }] });
  feed({ choices: [{ delta: {}, finish_reason: 'tool_calls' }] });
  const out = r.done();
  eq(seen.join(''), 'Looking', 'text deltas stream in order');
  eq(out.calls, [
    { id: 'c1', name: 'search_catalog', args: { maxPerG: 5 } },
    { id: 'c2', name: 'get_product', args: { id: 'x' } }
  ], 'two interleaved calls reassemble correctly and stay in index order');
  eq(out.stopReason, 'tool_use', 'finish_reason tool_calls maps to tool_use');
}

console.log('\n== groq finish_reason mapping and malformed arguments ==');
{
  const mk = (finish) => {
    const r = compat.reader();
    r.frame({ choices: [{ delta: { content: 'x' }, finish_reason: finish }] }, () => {});
    return r.done().stopReason;
  };
  eq(mk('stop'), 'end_turn', 'stop -> end_turn');
  eq(mk('length'), 'max_tokens', 'length -> max_tokens');
  eq(mk('function_call'), 'tool_use', 'the legacy function_call -> tool_use');

  const r = compat.reader();
  r.frame({ choices: [{ delta: { tool_calls: [{ index: 0, id: 'c1', function: { name: 'search_catalog', arguments: '{"broke' } }] }, finish_reason: 'tool_calls' }] }, () => {});
  const out = r.done();
  eq(out.calls[0].args, {}, 'truncated arguments degrade to an empty object rather than throwing mid-stream');
  eq(out.calls[0].name, 'search_catalog', 'and the call is still reported, so it gets a tool_result');
}

console.log('\n== round trip: render, then read back, and the ids still line up ==');
{
  // The invariant the whole seam rests on: a call rendered into provider shape and a result rendered
  // back must agree on the id, or the model cannot match one to the other. Checked on both paths.
  for (const [name, render] of [
    ['anthropic', () => {
      const msgs = anthropic.messages(HISTORY);
      const calls = msgs.flatMap((m) => Array.isArray(m.content) ? m.content.filter((c) => c.type === 'tool_use').map((c) => c.id) : []);
      const results = msgs.flatMap((m) => Array.isArray(m.content) ? m.content.filter((c) => c.type === 'tool_result').map((c) => c.tool_use_id) : []);
      return { calls, results };
    }],
    ['groq', () => {
      const msgs = compat.messages('S', HISTORY);
      const calls = msgs.flatMap((m) => (m.tool_calls || []).map((c) => c.id));
      const results = msgs.filter((m) => m.role === 'tool').map((m) => m.tool_call_id);
      return { calls, results };
    }]
  ]) {
    const { calls, results } = render();
    eq(calls, ['c1', 'c2'], `${name}: both calls rendered with their ids`);
    eq(results, ['c1', 'c2'], `${name}: both results rendered against the same ids`);
  }
}

console.log('\n== provider resolution ==');
{
  const a = process.env.ANTHROPIC_API_KEY, g = process.env.LL_OPENAI_COMPAT_KEY;
  delete process.env.ANTHROPIC_API_KEY; delete process.env.LL_OPENAI_COMPAT_KEY;
  eq(configured(), [], 'no keys means no providers');
  eq(resolve(null), null, 'and nothing to resolve -- which is what makes the endpoint fail closed');

  process.env.LL_OPENAI_COMPAT_KEY = 'x';
  eq(configured(), ['compat'], 'a compat-only deploy reports it');
  eq(resolve(null), 'compat', 'and resolves to it');
  eq(resolve('anthropic'), 'compat', 'asking for an unconfigured provider falls back rather than erroring');

  process.env.ANTHROPIC_API_KEY = 'y';
  eq(resolve(null), 'anthropic', 'with both configured, anthropic is preferred');
  eq(resolve('compat'), 'compat', 'but a configured provider can be named');

  if (a === undefined) delete process.env.ANTHROPIC_API_KEY; else process.env.ANTHROPIC_API_KEY = a;
  if (g === undefined) delete process.env.LL_OPENAI_COMPAT_KEY; else process.env.LL_OPENAI_COMPAT_KEY = g;
}

console.log(`\n${fail === 0 ? 'PASS' : 'FAIL'}  ${pass} passed, ${fail} failed`);
if (fail) { console.log('failed:\n' + failures.map((f) => '  - ' + f).join('\n')); process.exitCode = 1; }
