/* netlify/lib/runtime.mjs — two things this host does to the environment that
 * the handlers in api/ were never written to expect.
 *
 * Called at the top of every invocation rather than once at import, because the
 * second of them is done to the process by the platform and nothing here says
 * when. It is two property reads; doing it every time costs nothing.
 */
export function prepare(env = process.env) {
  /* 1. NODE_ENV. api/admin/_gate.js marks the admin session cookie `Secure`
        when NODE_ENV is `production`. A function here is promised URL,
        SITE_NAME and SITE_ID and nothing else, so without this the cookie that
        guards /admin would go out without the flag. Under `netlify dev` it is
        left alone, so the cookie still works over plain http://localhost. */
  if (!env.NODE_ENV && !env.NETLIFY_DEV) env.NODE_ENV = 'production';

  /* 2. A KEY THAT IS NOT OURS. When a project has set neither ANTHROPIC_API_KEY
        nor ANTHROPIC_BASE_URL, Netlify's AI Gateway supplies both. The pair is
        meant to be used together and the usage is billed to the Netlify account
        in credits.

        api/llm.js does not read the base url: it talks to api.anthropic.com,
        where that key is refused. Left alone, the concierge would report
        itself configured and then fail every single turn with a 401 -- the
        half-configured state configured() in api/llm.js exists to prevent.

        And honouring the gateway instead is not this file's call to make. The
        concierge fails closed so that an unconfigured deploy cannot be run up a
        bill by a stranger (api/concierge.js), and on the free plan a team that
        runs out of credits has every one of its sites paused. "The chat widget
        quietly started billing the host" is a worse surprise than a 501. So a
        gateway key is treated as no key. Set your own ANTHROPIC_API_KEY in
        Netlify and nothing is injected, this does nothing, and the concierge
        runs exactly as it did before.

        HOW A GATEWAY KEY IS RECOGNISED, and it errs towards leaving a key
        alone. Netlify always sets NETLIFY_AI_GATEWAY_KEY and
        NETLIFY_AI_GATEWAY_URL when the gateway is on, whatever else is set. A
        key is the gateway's if it IS that key, or if the base url it came with
        is that url or lives on a Netlify host. A project's own key beside its
        own proxy (ANTHROPIC_BASE_URL pointing at, say, an observability
        service) matches none of those and is not touched. */
  const key = env.ANTHROPIC_API_KEY;
  if (!key) return;
  const base = String(env.ANTHROPIC_BASE_URL || '').trim();
  const gatewayKey = env.NETLIFY_AI_GATEWAY_KEY;
  const gatewayUrl = String(env.NETLIFY_AI_GATEWAY_URL || '').trim();
  let host = '';
  try { host = base ? new URL(base).hostname.toLowerCase() : ''; } catch { /* not a url: not evidence of anything */ }
  const theirs =
    (!!gatewayKey && key === gatewayKey) ||
    (!!gatewayUrl && !!base && base.startsWith(gatewayUrl)) ||
    /(^|\.)netlify\.(app|com)$/.test(host);
  if (theirs) delete env.ANTHROPIC_API_KEY;
}
