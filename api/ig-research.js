/* api/ig-research.js — the research half of /ig-studio.
 *
 *   POST /api/ig-research  { mode:"findings", topic? }        -> what happened, with sources
 *   POST /api/ig-research  { mode:"draft", finding, notes? }  -> a 7-slide draft of ONE finding
 *
 * Two calls with a person in between, deliberately. Run one goes and reads; you
 * pick; run two drafts the thing you picked. One call that researched AND wrote
 * would decide the angle for you, which is the half of the job you actually want
 * to keep.
 *
 * WHY THIS ENDPOINT REFUSES TO PRODUCE A FINISHED SLIDE. The pack's whole value is
 * being right when everybody else is wrong -- post 1 exists to correct an error
 * most outlets published as settled. A model can emit "90-6" or "H.R. 9830" that
 * looks exactly like the verified ones, and a wrong vote count set at 250px is the
 * most screenshottable mistake this account could make. So every factual claim in
 * a draft comes back in a `claims` array with the source it came from, the draft is
 * marked unverified, and the studio will not export a PNG until a human has ticked
 * each claim. The model researches. The editor publishes. Those are different jobs
 * and this file will not blur them.
 *
 * SEARCH IS ANTHROPIC'S SERVER-SIDE web_search, which matters for two reasons
 * beyond convenience: the fetching happens at the provider rather than from a
 * Vercel function (this repo does not fetch arbitrary urls it was handed -- see the
 * XRAY note in api/coldwater.js about SSRF), and results arrive already attributed,
 * so a source url is a fact about the search rather than something the model was
 * asked to remember.
 *
 * NO DAILY LEDGER HERE, AND THAT IS NOT AN OVERSIGHT. The concierge needs
 * LL_DAILY_USD because it is public: a stranger can spend the owner's money by
 * typing. This endpoint is gated on LL_ADMIN_TOKEN, so the only person who can
 * spend is the person who owns the key, one click at a time. The controls that fit
 * that threat model are per-request bounds (a search cap and a token cap, both
 * below) and telling the truth about cost in the response, which the studio prints.
 * Do not copy the concierge's ledger in here; if these ever share a wallet, lift
 * that ledger into a module both import rather than writing it twice.
 *
 * FAILS CLOSED. With no LL_ADMIN_TOKEN set the route is 501 and does nothing, the
 * same posture as POST /api/overrides -- an unconfigured deploy cannot be billed by
 * a stranger who found the url.
 */
import { streamTurn, configured, costOf } from './llm.js';

const MAX_SEARCHES = 6;      // one run reads widely, then stops
// findings is a short list (<=8 headlines); a draft is a title, 7 slide bodies, a
// claims array, a caption and hashtags -- reliably more text than findings, and
// output tokens are shared with the search tool_use/tool_result blocks that
// precede it, so a run with several searches was leaving less room for the JSON
// than the number alone suggested. 4000 was cutting drafts off mid-object, which
// surfaced as "the model did not return usable JSON" with a raw body ending
// mid-string -- readable as a model failure when it was a budget one.
const MAX_TOKENS = { findings: 4000, draft: 8000 };

/* The deck's own vocabulary, handed to the model rather than described loosely.
   It writes into the same classes public/js/ig-slides-data.js already uses, so a
   draft drops into the studio and renders without anyone translating it. */
const SLIDE_VOCAB = `
Slide bodies are HTML fragments using ONLY these classes:
  <h1>            huge headline (96px). Also h1 class="sm" (78px) and class="xs" (66px).
  <div class="numeral">   a giant figure (250px). Add class="sm" for 190px, and
                          class="leaf" (green) or class="red" for colour.
  <div class="label">     small uppercase caption under a numeral
  <div class="kicker">    small amber line above a headline
  <div class="sub">       large italic subhead
  <p>                     body copy. <b> inside it for emphasis.
  <div class="rule">      a short green divider (empty div)
  <div class="bullets">   a SET of points: each child a <div>. Order carries nothing.
  <div class="steps">     an ORDERED sequence: each child <div><span>1</span> text</div>
  <div class="quote">     a VERBATIM quotation only. <div class="attrib"> under it.
Rules that are not style preferences:
  - Non-ASCII must be a numeric entity: &#8212; em dash, &#8211; en dash (vote
    counts and ranges only), &#8217; apostrophe, &#162; cent.
  - A hyphen, not an en dash, in compound modifiers: Senate-passed, R-NC.
  - class="quote" is for words somebody actually said, verbatim. Reported speech
    or paraphrase goes in a <p> with only the quoted words inside quotation marks.
  - Never invent a bill number, a vote count, a date or a dollar figure. If a
    number is not in the sources, do not put it on a slide.`;

const FINDINGS_SYSTEM = `You are a research assistant for a hemp-policy advocacy account. You find what
actually happened and hand it to a human editor. You do not write posts in this mode.

Search the web for genuinely RECENT developments. For each finding report: what happened, the date,
why it matters to small hemp businesses and their customers, and the source url you got it from.

Rank by what a shopper or a small seller would act on, not by what is loudest.

Prefer primary sources and established trade press (Marijuana Moment, MJBizDaily, LegiScan,
congressional and agency pages). Say so when a claim rests on a single outlet.

Return ONLY a JSON array, no prose around it, of at most 8 objects:
[{"headline": "...", "what": "one or two sentences", "why": "why it matters, one sentence",
  "date": "YYYY-MM-DD or a range", "sources": ["url", ...], "confidence": "high|medium|low",
  "angle": "the post this could become, one line"}]
confidence is LOW when one outlet carries it, MEDIUM when it is reported but not primary, HIGH when
a primary source confirms it. Be honest here; the editor is deciding what to publish on it.`;

const DRAFT_SYSTEM = `You draft one Instagram carousel for a hemp-policy advocacy account, from a
finding a human editor has already chosen. Seven slides. The house voice: correction-led, specific,
numbers doing the work, no hype, no product talk.

Slide 1 is the hook and must land the correction or the stake in a few words. Slide 7 closes with the
ask. Middle slides carry one idea each.

Instagram's Restricted Goods policy permits advocacy and education and forbids the transactional, so:
no product, no prices, no menus, no "shop", no health or therapeutic claims. Legislative and policy
framing only.

${SLIDE_VOCAB}

Search the web to confirm every number before you use it.

Return ONLY JSON, no prose around it:
{"title": "short title for the post",
 "slides": [{"eyebrow": "small uppercase line", "body": "HTML fragment"}, ... exactly 7],
 "claims": [{"claim": "the factual assertion as it appears on a slide", "slide": 3,
             "source": "url", "confidence": "high|medium|low"}],
 "caption": "the Instagram caption, first line carrying the hook",
 "hashtags": ["#hemp", ...]}
Every number, name, date and bill reference that appears on a slide must have a matching entry in
claims. A claim with no source url does not belong on a slide.`;

/* The model is asked for bare JSON and usually complies, but a stray sentence
   before it is the most common way this fails, so the first balanced block is
   taken rather than trusting the whole body to parse. */
function extractJson(text) {
  const t = String(text || '').trim();
  const fenced = t.match(/```(?:json)?\s*([\s\S]*?)```/);
  const body = fenced ? fenced[1] : t;
  const start = body.search(/[[{]/);
  if (start < 0) return null;
  const open = body[start], close = open === '[' ? ']' : '}';
  let depth = 0, inStr = false, esc = false;
  for (let i = start; i < body.length; i++) {
    const c = body[i];
    if (esc) { esc = false; continue; }
    if (c === '\\') { esc = true; continue; }
    if (c === '"') { inStr = !inStr; continue; }
    if (inStr) continue;
    if (c === open) depth++;
    else if (c === close && --depth === 0) {
      try { return JSON.parse(body.slice(start, i + 1)); } catch { return null; }
    }
  }
  return null;
}

const send = (res, code, obj) => {
  res.statusCode = code;
  res.setHeader('content-type', 'application/json; charset=utf-8');
  res.setHeader('cache-control', 'no-store');   // never cache an editorial draft
  res.end(JSON.stringify(obj));
};

async function readBody(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  let raw = '';
  for await (const chunk of req) { raw += chunk; if (raw.length > 200000) break; }
  try { return JSON.parse(raw || '{}'); } catch { return {}; }
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return send(res, 405, { error: 'POST only' });

  const token = process.env.LL_ADMIN_TOKEN;
  if (!token) return send(res, 501, {
    error: 'LL_ADMIN_TOKEN is not set, so this endpoint is off',
    hint: 'it fails closed on purpose: an unconfigured deploy cannot be billed by a stranger'
  });
  if ((req.headers['x-ll-admin-token'] || '') !== token) return send(res, 401, { error: 'bad admin token' });

  // configured() returns provider KEYS, not objects.
  if (!configured().includes('anthropic')) return send(res, 501, {
    error: 'no ANTHROPIC_API_KEY, so there is nothing to research with',
    hint: 'web search runs at the provider; without a key this route has no way to read anything'
  });

  const body = await readBody(req);
  const mode = body.mode === 'draft' ? 'draft' : 'findings';

  let system, user;
  if (mode === 'findings') {
    const topic = String(body.topic || '').trim().slice(0, 400);
    system = FINDINGS_SYSTEM;
    user = topic
      ? `Research this specifically: ${topic}\n\nToday is ${new Date().toISOString().slice(0, 10)}.`
      : `Sweep the last 10 days of United States federal hemp and cannabis policy, plus Michigan state
action. Today is ${new Date().toISOString().slice(0, 10)}.`;
  } else {
    const finding = body.finding && typeof body.finding === 'object' ? body.finding : null;
    if (!finding) return send(res, 400, { error: 'draft mode needs the finding you picked' });
    system = DRAFT_SYSTEM;
    user = `Draft the carousel for this finding:\n\n${JSON.stringify(finding).slice(0, 4000)}` +
      (body.notes ? `\n\nEditor's steer: ${String(body.notes).slice(0, 600)}` : '');
  }

  const started = Date.now();
  let out;
  try {
    out = await streamTurn('anthropic', {
      system,
      /* Server-side search. max_uses is the real cost control on this route: each
         use is a fetch plus the tokens it drags into context. */
      tools: [{ type: 'web_search_20250305', name: 'web_search', max_uses: MAX_SEARCHES }],
      history: [{ role: 'user', text: user }],
      maxTokens: MAX_TOKENS[mode]
    }, () => {});
  } catch (e) {
    return send(res, 502, { error: 'the model call failed', detail: String(e && e.message || e).slice(0, 300) });
  }

  const model = process.env.LL_ANTHROPIC_MODEL || 'claude-haiku-4-5-20251001';
  // fallbackChars is {in,out}, used only when the provider reported no usage at all.
  const cost = costOf(model, out.usage, { in: system.length + user.length, out: (out.text || '').length });
  console.log(`[ig-research] ${mode} ${model} in=${out.usage?.input || 0} out=${out.usage?.output || 0} ` +
    `$${(cost?.usd ?? 0).toFixed(5)}${cost?.measured ? '' : ' ESTIMATED'}` +
    `${cost?.knownRate ? '' : ' UNKNOWN-RATE'} ${Date.now() - started}ms`);

  const parsed = extractJson(out.text);
  if (!parsed) return send(res, 502, {
    // A truncated response is a distinct, actionable case from a refusal or a
    // stray preamble: it names the actual cause (the budget, not the model)
    // rather than reading as an unexplained failure that "sometimes" happens.
    error: out.stopReason === 'max_tokens'
      ? `the model's response was cut off before it finished (hit the ${MAX_TOKENS[mode]}-token limit for ${mode} mode) -- try a narrower topic, or fewer searches`
      : 'the model did not return usable JSON',
    /* The raw text is returned rather than swallowed: when this fails it is
       usually a refusal or a preamble, and both are readable. */
    raw: String(out.text || '').slice(0, 1500)
  });

  if (mode === 'findings') {
    const findings = (Array.isArray(parsed) ? parsed : parsed.findings || [])
      .filter(f => f && f.headline)
      .map(f => ({ ...f, sources: Array.isArray(f.sources) ? f.sources.filter(Boolean) : [] }));
    return send(res, 200, { mode, findings, model, usd: cost?.usd ?? null, ms: Date.now() - started });
  }

  const slides = Array.isArray(parsed.slides) ? parsed.slides.filter(s => s && s.body) : [];
  if (!slides.length) return send(res, 502, { error: 'the draft came back with no slides', raw: JSON.stringify(parsed).slice(0, 1200) });
  const claims = Array.isArray(parsed.claims) ? parsed.claims : [];
  return send(res, 200, {
    mode, model, usd: cost?.usd ?? null, ms: Date.now() - started,
    draft: { title: String(parsed.title || 'Untitled'), slides },
    claims, caption: parsed.caption || '', hashtags: parsed.hashtags || [],
    /* Stated by the server rather than assumed by the page: a draft is unverified
       until a human says otherwise, and the studio blocks export on this. */
    verified: false
  });
}

/* Exported for the suite. extractJson is the piece most likely to break quietly:
   a model that prefaces its JSON with a sentence is the common case, and a parse
   that gives up there reads as "the model refused" in the panel. */
export const _internals = { extractJson };
