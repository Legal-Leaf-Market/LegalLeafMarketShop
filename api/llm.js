// api/llm.js -- the provider seam for the concierge.
//
// WHY A NEUTRAL HISTORY SHAPE AND NOT A TRANSLATOR
//
// Adding a second provider is not a second request builder. The two wire formats disagree about the
// SHAPE OF CONVERSATION HISTORY, and history is replayed in full on every turn, so a translation bug
// does not fail once -- it corrupts every subsequent turn of that conversation, quietly.
//
// The specific disagreement, which is easy to get backwards:
//
//   tool results, Anthropic:  ONE user message whose content holds every tool_result block.
//                             Splitting them across messages "silently trains Claude to stop making
//                             parallel calls" -- no error, just a model that stops doing something.
//   tool results, OpenAI/Groq: ONE MESSAGE PER RESULT, each {role:'tool', tool_call_id, content}.
//                             Bundling them is not representable.
//
// So there are two right answers and no shared one. Translating between the two live formats means
// two lossy directions to keep in sync -- and this repo has a documented history of exactly that
// (four copies of storeCheckoutUrl(), _OV_FIELDS in two places). Instead the conversation is stored
// once, in a neutral shape that neither provider owns, and each provider RENDERS it on the way out.
// Rendering is one direction, so there is nothing to keep in sync.
//
//   {role:'user',      text}
//   {role:'assistant', text, calls:[{id, name, args}]}
//   {role:'tool',      results:[{id, name, output, isError}]}
//
// `args` is always a parsed object in the neutral shape. That matters: Anthropic sends tool input as
// an object and OpenAI sends `arguments` as a JSON STRING, so a seam that keeps the provider's own
// representation ends up double-encoding one of them. Parse on the way in, stringify on the way out,
// and the bug cannot exist.
//
// WHAT THIS FILE DELIBERATELY DOES NOT DO
//
// It does not decide which provider a request should use. Routing is a policy question -- cheap tier
// for shallow turns, strong tier for anything reasoning over lab data -- and it belongs with the
// caller, above this seam. See BUDTENDER_PLAN.md section 8.

const ANTHROPIC_VERSION = '2023-06-01';

/* ------------------------------------------------------------------ *
 * Anthropic                                                          *
 * ------------------------------------------------------------------ */

// THE DOCUMENTED SET for output_config.effort. Enumerated in the API reference, so a copy here does
// not rot -- but WHICH MODELS ACCEPT THE PARAMETER AT ALL does, which is the point of the note below.
const ANTHROPIC_EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max'];

// Off unless asked for. Read in two places -- the header and the body -- and they must never disagree.
function anthropicFallbacks() {
  const v = process.env.LL_ANTHROPIC_FALLBACKS;
  return !!v && v !== 'off' && v !== '0' && v !== 'false';
}

const anthropic = {
  id: 'anthropic',
  envKey: 'ANTHROPIC_API_KEY',
  modelEnv: 'LL_ANTHROPIC_MODEL',
  // Haiku 4.5 -- the cheap tier, and the reason this concierge can run at all. $1/$5 per million
  // against Opus 5's $5/$25. Overridable with LL_ANTHROPIC_MODEL so moving up a tier is config.
  defaultModel: 'claude-haiku-4-5',
  url: 'https://api.anthropic.com/v1/messages',

  headers(key) {
    const h = {
      'content-type': 'application/json',
      'x-api-key': key,
      'anthropic-version': ANTHROPIC_VERSION
    };
    // The beta header rides with the parameter, not on its own: advertising a beta we are not using
    // is a lie in the request, and the header alone changes what /v1/models reports.
    if (anthropicFallbacks()) h['anthropic-beta'] = 'server-side-fallback-2026-07-01';
    return h;
  },

  tools(defs) {
    // SERVER-SIDE TOOLS PASS THROUGH UNTOUCHED. Anthropic runs some tools itself --
    // web_search is the one in use here -- and those are declared by `type` plus
    // their own fields, never by input_schema. Mapping one through the custom-tool
    // shape below strips the type and sends a tool with no schema, which comes back
    // as a 400 about a malformed tool definition rather than as this function having
    // eaten it. Custom tools are untouched by the branch.
    return defs.map((t) => (t.type
      ? t
      : { name: t.name, description: t.description, input_schema: t.input_schema }));
  },

  messages(history) {
    return history.map((m) => {
      if (m.role === 'user') return { role: 'user', content: m.text };
      if (m.role === 'assistant') {
        const content = [];
        if (m.text) content.push({ type: 'text', text: m.text });
        for (const c of m.calls || []) content.push({ type: 'tool_use', id: c.id, name: c.name, input: c.args });
        return { role: 'assistant', content };
      }
      // ONE user message carrying every result. See the header note.
      return {
        role: 'user',
        content: (m.results || []).map((r) => ({
          type: 'tool_result', tool_use_id: r.id, content: r.output, is_error: !!r.isError
        }))
      };
    });
  },

  body({ system, tools, history, model, maxTokens }) {
    const b = {
      model: model || process.env.LL_ANTHROPIC_MODEL || anthropic.defaultModel,
      max_tokens: maxTokens || 4096,
      stream: true,
      // ONE cache breakpoint on the last system block. Render order is tools -> system -> messages,
      // so this caches the tool schemas with it, and nothing volatile may sit above it.
      //
      // IT WILL NOT ENGAGE ON HAIKU, and that is worth stating rather than discovering. The minimum
      // cacheable prefix is model-dependent and NOT monotonic across generations: 512 tokens on
      // Opus 5, 4096 on Haiku 4.5. This prompt is ~1,455 tokens, so on Haiku the entry is silently
      // never created -- no error, just cache_creation_input_tokens: 0. The breakpoint stays because
      // it costs nothing and starts working the moment the model changes; what does not stay is the
      // claim that caching saves us anything here. Verify with usage.cache_read_input_tokens before
      // believing any figure.
      system: [{ type: 'text', text: system, cache_control: { type: 'ephemeral' } }],
      tools: anthropic.tools(tools),
      messages: anthropic.messages(history)
    };

    // NO THINKING FIELD, deliberately, and the reason differs by model -- which is why it is absent
    // rather than set. On Haiku 4.5 adaptive thinking does not exist; on Opus 5 omitting the field
    // runs adaptive, which is what we want there anyway. Setting it would be wrong on one or the
    // other, so the omission is the only value correct for both.

    // output_config.effort IS MODEL-GATED, and this is the same mistake the Groq adapter already
    // made once: `effort` is not a universal cost lever. It ERRORS on Haiku 4.5 and Sonnet 4.5, and
    // this code used to send `effort: 'low'` unconditionally -- which would have 400'd every single
    // turn on the model we just made the default. So it comes only from LL_ANTHROPIC_EFFORT, set by
    // whoever also chose the model and can therefore know whether that model takes it.
    const eff = process.env.LL_ANTHROPIC_EFFORT;
    if (eff && eff !== 'off') {
      if (ANTHROPIC_EFFORTS.indexOf(eff) === -1) {
        throw new Error(`anthropic: LL_ANTHROPIC_EFFORT="${eff}" is not one of `
          + `${ANTHROPIC_EFFORTS.join(', ')} (or "off" to send none at all)`);
      }
      b.output_config = { effort: eff };
    }

    // Server-side fallbacks route a policy decline to another model. They exist for the elevated
    // safety classifiers on the frontier tier; Haiku is not that tier, and a fallback target must be
    // in the requested model's own allowed list. Opt-in for the same reason as effort.
    if (anthropicFallbacks()) b.fallbacks = 'default';

    return b;
  },

  // Stateful frame consumer. Tool arguments arrive as input_json_delta fragments and are parsed ONCE
  // at content_block_stop -- a fragment that happens to parse is worse than one that throws.
  reader() {
    const blocks = [];
    let partial = null, jsonBuf = '', stopReason = null, stopDetails = null;
    // USAGE IS READ, NOT ESTIMATED. It arrives split across two frames -- input on message_start,
    // output on message_delta -- and was previously thrown away, which is why "what have I spent"
    // could only ever be answered with arithmetic over character counts. A spend cap cannot be built
    // on an estimate: it would either throttle early or bill past the ceiling, and there would be no
    // way to tell which. cache_read is carried too, because it is the only honest way to check
    // whether the prompt-cache breakpoint is doing anything on the current model (it is not, on
    // Haiku -- the prefix is under its 4,096-token minimum).
    const usage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, measured: false };
    return {
      frame(ev, onText) {
        if (ev.type === 'message_start') {
          const u = (ev.message && ev.message.usage) || {};
          usage.input += u.input_tokens || 0;
          usage.cacheRead += u.cache_read_input_tokens || 0;
          usage.cacheWrite += u.cache_creation_input_tokens || 0;
          if (u.input_tokens != null) usage.measured = true;
        } else if (ev.type === 'message_delta' && ev.usage) {
          usage.output += ev.usage.output_tokens || 0;
          if (ev.usage.output_tokens != null) usage.measured = true;
        }
        if (ev.type === 'content_block_start') {
          partial = ev.content_block; jsonBuf = '';
          if (partial && partial.type === 'text') partial.text = partial.text || '';
        } else if (ev.type === 'content_block_delta' && partial) {
          const d = ev.delta || {};
          if (d.type === 'text_delta') { partial.text = (partial.text || '') + d.text; onText(d.text); }
          else if (d.type === 'input_json_delta') jsonBuf += d.partial_json || '';
          // thinking_delta dropped: display defaults to omitted, and reasoning is not ours to stream.
        } else if (ev.type === 'content_block_stop' && partial) {
          if (partial.type === 'tool_use') {
            try { partial.input = jsonBuf ? JSON.parse(jsonBuf) : {}; } catch { partial.input = {}; }
          }
          blocks.push(partial); partial = null; jsonBuf = '';
        } else if (ev.type === 'message_delta') {
          stopReason = (ev.delta && ev.delta.stop_reason) || stopReason;
          stopDetails = (ev.delta && ev.delta.stop_details) || stopDetails;
        } else if (ev.type === 'error') {
          throw new Error('model stream error: ' + JSON.stringify(ev.error || {}).slice(0, 300));
        }
      },
      done() {
        return {
          text: blocks.filter((b) => b.type === 'text').map((b) => b.text).join(''),
          calls: blocks.filter((b) => b.type === 'tool_use').map((b) => ({ id: b.id, name: b.name, args: b.input || {} })),
          stopReason: stopReason === 'tool_use' ? 'tool_use'
            : stopReason === 'refusal' ? 'refusal'
              : stopReason === 'max_tokens' ? 'max_tokens' : 'end_turn',
          refusalCategory: (stopDetails && stopDetails.category) || null,
          usage
        };
      }
    };
  }
};

/* ------------------------------------------------------------------ *
 * Groq (OpenAI-compatible)                                           *
 * ------------------------------------------------------------------ */

// The documented values for the OpenAI dialect's `reasoning_effort`. An enumerated request parameter,
// not a catalogue, which is why it is safe to hold a copy of here -- unlike a model id.
const DIALECT_EFFORTS = ['none', 'default', 'low', 'medium', 'high'];

// ONE DIALECT, MANY VENDORS -- which is the whole reason this file exists, finally taken literally.
//
// What was written as "the Groq adapter" is not Groq-specific in any line of it: it is the
// OpenAI chat-completions dialect, which a dozen hosts speak. So it is built from config instead of
// hardcoded, and instantiated twice. Groq keeps its own entry and its own env names; the second entry
// points at ANY compatible endpoint through LL_OPENAI_COMPAT_BASE.
//
// The reason this is worth doing rather than leaving as a future option: Groq's free tier hit a
// tokens-per-minute wall and their paid tier was closed to new accounts, and at that moment the
// question "which cheap provider instead" turned into a code question when it should have been a
// config one. It is a config one now. What genuinely differs between vendors is the model id and the
// price, and neither belongs in this file.
//
// The base is stored WITHOUT a trailing slash and with /chat/completions and /models appended, because
// those two paths are the parts of the dialect that are actually fixed.
function base(cfg) {
  const raw = cfg.baseEnv ? process.env[cfg.baseEnv] : null;
  return String(raw || cfg.base || '').replace(/\/+$/, '');
}

function openAiDialect(cfg) {
    const p = {
    id: cfg.id,
    envKey: cfg.envKey,
    // Carried on the provider, not just the config, because the leaked-key error names it.
    modelEnv: cfg.modelEnv,
    // Left unset on purpose. Groq's catalogue turns over faster than this file will be edited, and a
    // stale default here is a 400 nobody can explain. Set GROQ_MODEL, or pass `model` explicitly; the
    // available ids come from GET /openai/v1/models.
    defaultModel: null,
    get url() { return base(cfg) + '/chat/completions'; },

    headers(key) {
      return { 'content-type': 'application/json', authorization: 'Bearer ' + key };
    },

    // The ids this key may actually use, asked of the provider rather than remembered. `active` is a
    // documented field on that response, so a retired model is dropped; nothing else is filtered, which
    // means the list still includes the whisper and TTS ids -- they are not chat models, but deciding
    // that from a name would be the same rotting guess this whole arrangement exists to avoid. Sorted so
    // the message is stable between calls. Failures are the caller's to absorb, since this only ever
    // runs to improve an error that is already being thrown.
    async listModels(key) {
      const r = await fetch(base(cfg) + '/models', { headers: p.headers(key) });
      if (!r.ok) throw new Error(cfg.id + ' models ' + r.status);
      const j = await r.json();
      return (j.data || []).filter((m) => m && m.id && m.active !== false).map((m) => m.id).sort();
    },

    tools(defs) {
      // OpenAI shape names the schema `parameters`, not `input_schema`.
      return defs.map((t) => ({
        type: 'function',
        function: { name: t.name, description: t.description, parameters: t.input_schema }
      }));
    },

    messages(system, history) {
      const out = [{ role: 'system', content: system }];
      for (const m of history) {
        if (m.role === 'user') { out.push({ role: 'user', content: m.text }); continue; }
        if (m.role === 'assistant') {
          const msg = { role: 'assistant', content: m.text || null };
          if (m.calls && m.calls.length) {
            msg.tool_calls = m.calls.map((c) => ({
              id: c.id, type: 'function',
              // A JSON STRING here, not an object. This is the asymmetry with Anthropic that the
              // neutral shape exists to absorb.
              function: { name: c.name, arguments: JSON.stringify(c.args || {}) }
            }));
          }
          out.push(msg);
          continue;
        }
        // ONE MESSAGE PER RESULT. There is no is_error field in this shape, so an error has to travel
        // inside the content or the model cannot tell a failed tool from an empty one.
        for (const r of m.results || []) {
          out.push({
            role: 'tool',
            tool_call_id: r.id,
            content: r.isError ? 'ERROR: ' + r.output : r.output
          });
        }
      }
      return out;
    },

    body({ system, tools, history, model, effort, maxTokens }) {
      const m = model || process.env[cfg.modelEnv] || p.defaultModel;
      if (!m) throw new Error(cfg.id + ': no model configured -- set ' + cfg.modelEnv + ' or pass model');
      const b = {
        model: m,
        // max_tokens is deprecated in this API in favour of max_completion_tokens.
        max_completion_tokens: maxTokens || 4096,
        stream: true,
        // Ask for the usage chunk. Unlike reasoning_effort above this is not model-gated -- it is a
        // property of the API surface, documented across every host that speaks this dialect -- and a
        // host that does not implement it ignores an unknown key rather than 400ing. Without it a
        // streamed response reports no usage at all, and the spend cap would then treat every turn on
        // this provider as free.
        stream_options: { include_usage: true },
        tools: p.tools(tools),
        messages: p.messages(system, history)
      };
      // reasoning_effort is MODEL-GATED and a value the model does not accept is a 400: per Groq's own
      // reference, low/medium/high exist on openai/gpt-oss-20b and -120b, none/default on qwen3, and
      // nothing at all on the llama models. So it comes only from GROQ_REASONING_EFFORT, set by whoever
      // also chose the model and can therefore know which values it takes.
      //
      // The caller's generic `effort` is deliberately NOT translated into it. That argument exists for
      // Anthropic's output_config.effort, which every model there accepts; forwarding it here turned a
      // provider-neutral cost hint into a 400 on the most obvious model to pick. Wiring one provider's
      // parameter to another's on the strength of a shared word is exactly the kind of silent
      // mistranslation the neutral shape in this file exists to prevent.
      //
      // The ALLOWED VALUES are part of the API rather than the catalogue -- Groq's reference enumerates
      // `none, default, low, medium, high` -- so unlike a model id they can be checked here without
      // rotting, and a typo becomes a local error naming the set instead of a remote 400 naming nothing.
      // Which of them a given model accepts is still the model's business, and still not guessed at.
      const re = process.env[cfg.effortEnv];
      if (re && re !== 'off') {
        if (DIALECT_EFFORTS.indexOf(re) === -1) {
          throw new Error(`${cfg.id}: ${cfg.effortEnv}="${re}" is not one of ${DIALECT_EFFORTS.join(', ')} `
            + '(or "off" to send none at all)');
        }
        b.reasoning_effort = re;
      }
      // NOTE: no cache_control. This API has no prompt-cache breakpoint to place -- `cached_tokens`
      // appears in usage on the Responses API, so prefix caching may happen automatically, but there
      // is nothing to control and no documented discount. Do not assume the Anthropic cost model.
      return b;
    },

    reader() {
      let text = '';
      const byIndex = new Map();     // streamed tool_calls are keyed by index, not by id
      let finish = null;
      // This dialect sends usage on a FINAL CHUNK WITH NO CHOICES, and only when the request asked
      // for it (stream_options.include_usage, set in the body builder). So the choices guard below has
      // to come after this, or the one frame carrying the numbers is the one frame dropped. A host
      // that ignores stream_options simply leaves measured:false, and the caller estimates instead of
      // silently counting zero -- an unmeasured turn that reads as free is how a cap gets bypassed.
      const usage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, measured: false };
      return {
        frame(ev, onText) {
          if (ev.usage) {
            usage.input += ev.usage.prompt_tokens || 0;
            usage.output += ev.usage.completion_tokens || 0;
            const det = ev.usage.prompt_tokens_details || {};
            usage.cacheRead += det.cached_tokens || 0;
            if (ev.usage.prompt_tokens != null || ev.usage.completion_tokens != null) usage.measured = true;
          }
          const choice = (ev.choices && ev.choices[0]) || null;
          if (!choice) return;
          const d = choice.delta || {};
          if (typeof d.content === 'string' && d.content) { text += d.content; onText(d.content); }
          for (const tc of d.tool_calls || []) {
            // `index` is the only field present on every fragment; id and name usually arrive on the
            // first one and arguments accumulate across the rest.
            const k = tc.index != null ? tc.index : byIndex.size;
            let slot = byIndex.get(k);
            if (!slot) { slot = { id: null, name: null, argBuf: '' }; byIndex.set(k, slot); }
            if (tc.id) slot.id = tc.id;
            if (tc.function && tc.function.name) slot.name = tc.function.name;
            if (tc.function && typeof tc.function.arguments === 'string') slot.argBuf += tc.function.arguments;
          }
          if (choice.finish_reason) finish = choice.finish_reason;
        },
        done() {
          const calls = [];
          for (const [k, s] of [...byIndex.entries()].sort((a, b) => a[0] - b[0])) {
            let args = {};
            try { args = s.argBuf ? JSON.parse(s.argBuf) : {}; } catch { args = {}; }
            calls.push({ id: s.id || ('call_' + k), name: s.name || '', args });
          }
          return {
            text,
            calls,
            // This API has NO structural refusal signal -- a model that declines does so in prose with
            // finish_reason "stop". So a Groq refusal is indistinguishable from an answer at this
            // layer, which is one more reason the eval harness matters more than the wire format.
            stopReason: (finish === 'tool_calls' || finish === 'function_call') ? 'tool_use'
              : finish === 'length' ? 'max_tokens' : 'end_turn',
            refusalCategory: null,
            usage
          };
        }
      };
    }
  };
  return p;
}

// GROQ IS GONE AS A CODE ENTRY, and is still reachable without one.
//
// It was worth trying and it did not work out: the free tier's tokens-per-minute cap was too low for a
// single concierge turn, and the paid tier was closed to new signups, so there was no way through. What
// the detour bought is the thing below it -- the realisation that "the Groq adapter" was never
// Groq-specific, only the OpenAI chat-completions dialect. So the dialect stays and the vendor entry
// goes: point LL_OPENAI_COMPAT_BASE at https://api.groq.com/openai/v1 and Groq works again, on exactly
// the same footing as DeepSeek or anything else. Deleting the factory too would have thrown away the
// only durable thing the exercise produced.

// Any OpenAI-compatible host: DeepSeek, Together, Fireworks, OpenRouter, Cerebras, a llama.cpp server,
// whatever is cheapest this month. Three env vars and no code. It is last in preference order because
// it is the most explicitly chosen -- nobody sets a base url by accident -- and `ready` is what stops a
// half-configured one (a key with no base) from being picked and then failing on every turn.
const compat = openAiDialect({
  id: 'compat',
  envKey: 'LL_OPENAI_COMPAT_KEY',
  modelEnv: 'LL_OPENAI_COMPAT_MODEL',
  effortEnv: 'LL_OPENAI_COMPAT_EFFORT',
  baseEnv: 'LL_OPENAI_COMPAT_BASE'
});
compat.ready = () => !!(process.env.LL_OPENAI_COMPAT_KEY && process.env.LL_OPENAI_COMPAT_BASE);

export const PROVIDERS = { anthropic, compat };

/* ------------------------------------------------------------------ *
 * Keeping secrets out of anything a client can read                   *
 * ------------------------------------------------------------------ */

// The prefixes are published, documented parts of each vendor's key format, which is what makes this
// checkable at all. It is a net, not a proof: an unrecognised key shape will not be caught, which is
// why the rule above is "send the code, not the prose" rather than "scrub and forward".
const SECRET_SHAPES = [
  /gsk_[A-Za-z0-9]{20,}/g,          // Groq
  /sk-ant-[A-Za-z0-9_-]{20,}/g,     // Anthropic
  /sk-[A-Za-z0-9]{32,}/g,           // OpenAI-style
  /\bxox[baprs]-[A-Za-z0-9-]{10,}/g // Slack, since LL_CRM_WEBHOOK-style vars invite pasting anything
];

export function scrub(text) {
  let s = String(text == null ? '' : text);
  for (const re of SECRET_SHAPES) s = s.replace(re, '[redacted]');
  return s;
}

export function looksLikeSecret(value) {
  const s = String(value == null ? '' : value);
  return SECRET_SHAPES.some((re) => new RegExp(re.source).test(s));
}

/* ------------------------------------------------------------------ *
 * One streaming call, either provider                                 *
 * ------------------------------------------------------------------ */

// Which providers this deploy can actually reach, in preference order.
// A provider counts as configured only if everything it needs is present. For the two fixed-endpoint
// entries that is just the key; the compatible-host entry also needs its base url, and a key without
// one would otherwise be selected and then fail every turn with a request to nowhere.
export function configured() {
  return Object.keys(PROVIDERS).filter((k) => {
    const p = PROVIDERS[k];
    return p.ready ? p.ready() : !!process.env[p.envKey];
  });
}

/* ------------------------------------------------------------------ *
 * Tokens -> dollars                                                   *
 * ------------------------------------------------------------------ */

// PUBLISHED PER-MILLION RATES, and the reason this is a table rather than two constants is that the
// model is config (LL_ANTHROPIC_MODEL, LL_OPENAI_COMPAT_MODEL). A single hardcoded Haiku rate would
// keep reporting Haiku prices after somebody moved the model up a tier, and the cap would then let
// through five times the spend it was set to allow -- silently, which is this repo's recurring
// failure mode. Prefix-matched so a dated snapshot id (claude-haiku-4-5-20251001) hits the same row.
const PRICES = [
  ['claude-opus-5',    5.00, 25.00],
  ['claude-sonnet-5',  3.00, 15.00],
  ['claude-haiku-4-5', 1.00,  5.00],
  ['claude-3-5-haiku', 0.80,  4.00]
];
// The rate used for a model not in the table. DELIBERATELY the most expensive row rather than an
// average or a zero: an unknown model must make the cap fire EARLY, never late. Guessing low here
// would mean a model swap could quietly spend several times the ceiling before anything noticed.
const UNKNOWN_RATE = [5.00, 25.00];

export function priceFor(model) {
  const m = String(model || '').toLowerCase();
  for (const [prefix, inRate, outRate] of PRICES) if (m.startsWith(prefix)) return { inRate, outRate, known: true };
  return { inRate: UNKNOWN_RATE[0], outRate: UNKNOWN_RATE[1], known: false };
}

// ~3.5 chars per token is the middle of the range for prose-plus-JSON, and it is only ever reached
// when a provider reported no usage at all. It is labelled `estimated` all the way out so a spend
// figure can never be presented as measured when it was inferred -- and it errs by counting the
// request body, which is the larger half here (input outweighs output ~85:1).
const CHARS_PER_TOKEN = 3.5;

export function costOf(model, usage, fallbackChars) {
  const { inRate, outRate, known } = priceFor(model);
  let input = (usage && usage.input) || 0;
  let output = (usage && usage.output) || 0;
  const measured = !!(usage && usage.measured);
  if (!measured && fallbackChars) {
    input = Math.round((fallbackChars.in || 0) / CHARS_PER_TOKEN);
    output = Math.round((fallbackChars.out || 0) / CHARS_PER_TOKEN);
  }
  // Cache reads bill at a tenth of the input rate on the Anthropic path, and cache_read_input_tokens
  // is reported SEPARATELY from input_tokens rather than as a subset of it, so it is added, not
  // subtracted. On Haiku this term is always zero because the prefix never reaches the minimum.
  const cacheRead = (usage && usage.cacheRead) || 0;
  const cacheWrite = (usage && usage.cacheWrite) || 0;
  const usd = (input / 1e6) * inRate
    + (cacheRead / 1e6) * inRate * 0.1
    + (cacheWrite / 1e6) * inRate * 1.25
    + (output / 1e6) * outRate;
  return { usd, input, output, cacheRead, cacheWrite, measured, knownRate: known };
}

export function resolve(want) {
  const have = configured();
  // Honour a named provider only if it is actually usable -- the same `ready` test, not just the key,
  // or naming the half-configured one would bypass the check configured() exists to make.
  if (want && have.indexOf(want) !== -1) return want;
  return have[0] || null;
}

// Both APIs are SSE over POST and both terminate frames on a blank line, so the transport is shared
// and only the frame semantics differ. Groq additionally sends a literal `data: [DONE]` sentinel.
export async function streamTurn(providerId, opts, onText) {
  const p = PROVIDERS[providerId];
  if (!p) throw new Error('unknown provider ' + providerId);
  const key = process.env[p.envKey];
  if (!key) throw new Error(p.envKey + ' not set');

  // AN ERROR THAT ANSWERS ITSELF. groq.defaultModel is null on purpose (see the note on it), which is
  // the right call and still left a real deploy dead: the key was set, GROQ_MODEL was not, and every
  // turn came back "no model configured -- set GROQ_MODEL", which tells you the variable and not the
  // value. The valid values are a request away using the key already in hand, so the message names
  // them. It deliberately does NOT pick one: this provider's catalogue spans an order of magnitude in
  // price, and choosing silently would be spending someone's money by default.
  let body;
  try {
    body = p.body(opts);
  } catch (e) {
    if (p.listModels && /no model configured/.test(String(e && e.message))) {
      const ids = await p.listModels(key).catch(() => null);
      throw new Error(String(e.message) + (ids && ids.length
        ? ` -- this key can use: ${ids.slice(0, 12).join(', ')}${ids.length > 12 ? ', ...' : ''}`
        : ' -- and listing the available ids failed too, so check the key itself'));
    }
    throw e;
  }

  // A CONFIG VALUE SHAPED LIKE A SECRET DOES NOT LEAVE THIS PROCESS.
  //
  // This happened: an API key was pasted into GROQ_MODEL. The key then travelled as the model name, so
  // it landed in the provider's request log, came back inside their 404 ("the model `gsk_...` does not
  // exist"), and that text was forwarded verbatim to the browser -- which means any visitor who opened
  // the concierge would have been shown the key. A public endpoint must not be able to read a
  // server-side secret back out, and "do not paste it in the wrong box" is not a control.
  //
  // Refusing here is the cheap fix, and it is refused BEFORE the request rather than after, because
  // a leak into someone else's logs cannot be taken back.
  if (looksLikeSecret(body && body.model)) {
    throw new Error(`${providerId}: the configured model id looks like an API key, so it was not sent. `
      + `Set ${p.modelEnv || 'the model'} to a model id and treat that key as leaked.`);
  }

  const res = await fetch(p.url, {
    method: 'POST',
    headers: p.headers(key),
    body: JSON.stringify(body)
  });

  if (!res.ok || !res.body) {
    let raw = '';
    let parsed = null;
    try { parsed = await res.json(); raw = JSON.stringify(parsed); }
    catch { raw = await res.text().catch(() => ''); }

    // THE PROVIDER'S PROSE DOES NOT GO TO THE CLIENT, only its status and its structured code.
    // Free-text messages quote the request back -- that is how the key above escaped -- and there is
    // no way to know in advance which field a vendor will echo. Codes are enumerated values and carry
    // nothing of ours. The full body still goes to the server log, scrubbed of the shapes we know.
    const e = (parsed && parsed.error) || {};
    const code = [e.code, e.type].filter(Boolean).join('/');
    console.error(`[llm] ${providerId} ${res.status} ${code || '(no code)'}: ${scrub(raw).slice(0, 800)}`);

    let msg = `${providerId} API ${res.status}${code ? ' ' + code : ''}`;

    // A 429 IS THE ONE ERROR WHERE THE NUMBERS ARE THE ANSWER, and "send the code, not the prose" had
    // thrown them away: `rate_limit_exceeded/tokens` says which bucket without saying how big it is,
    // how much is left, or how long to wait. Those live in RESPONSE HEADERS, which are structured and
    // enumerated -- so they can be surfaced without reopening the hole the rule exists to close. Both
    // providers publish this family; unknown ones simply contribute nothing.
    if (res.status === 429) {
      const h = (n) => { try { return res.headers && res.headers.get(n); } catch { return null; } };
      const bits = [];
      const retry = h('retry-after');
      const limit = h('x-ratelimit-limit-tokens'), left = h('x-ratelimit-remaining-tokens');
      const reset = h('x-ratelimit-reset-tokens');
      if (limit) bits.push(`limit ${limit} tokens/min`);
      if (left != null) bits.push(`${left} left`);
      if (retry || reset) bits.push(`retry in ${retry || reset}${/\d$/.test(String(retry || reset)) ? 's' : ''}`);
      if (bits.length) msg += ` -- ${bits.join(', ')}`;
      // The request's own size is the half the provider cannot tell you, and on a per-minute TOKEN cap
      // it is usually the lever: what is counted is the prompt plus the completion you RESERVED, not
      // the one you used. Reported so the next reading is a measurement rather than a theory.
      msg += `; this request reserved ${body.max_completion_tokens || body.max_tokens || '?'} completion tokens`;
    }
    // The same self-answering treatment as a missing model, for the case of a wrong one -- which is the
    // far likelier mistake. The offending value is deliberately NOT quoted back.
    if (p.listModels && /model_not_found|does not exist|unknown_model/i.test(raw)) {
      const ids = await p.listModels(key).catch(() => null);
      msg += ids && ids.length
        ? ` -- that model id is not available to this key; it can use: ${ids.slice(0, 12).join(', ')}`
          + `${ids.length > 12 ? ', ...' : ''}`
        : ' -- that model id is not available to this key';
    }
    const err = new Error(msg);
    err.status = res.status;
    throw err;
  }

  const reader = res.body.getReader();
  const dec = new TextDecoder();
  const consumer = p.reader();
  let buf = '';

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let nl;
    while ((nl = buf.indexOf('\n')) !== -1) {
      const line = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 1);
      if (!line.startsWith('data:')) continue;      // `event:` lines are redundant with data.type
      const payload = line.slice(5).trim();
      if (!payload || payload === '[DONE]') continue;
      let ev;
      try { ev = JSON.parse(payload); } catch { continue; }
      consumer.frame(ev, onText);
    }
  }
  // The model id travels back with the turn, because the CALLER is the one that has to price it and
  // the id is config here (LL_ANTHROPIC_MODEL / LL_OPENAI_COMPAT_MODEL). Re-deriving it on the other
  // side of this call would mean two places agreeing about which model ran, and they would disagree
  // the first time somebody set the override -- pricing a turn as Haiku while Opus served it.
  return { ...consumer.done(), model: body.model };
}
