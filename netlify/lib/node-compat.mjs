/* netlify/lib/node-compat.mjs — run an api/*.js handler on Netlify, unchanged.
 *
 * WHAT THIS IS FOR. Every file in api/ is written as `handler(req, res)`: a Node
 * request it can read `query`, `body` and `headers` off, and a response it
 * answers with `res.status(200).json(...)`. That shape is what the platform this
 * repo was born on handed a function. Netlify hands a function a web `Request`
 * and expects a web `Response` back.
 *
 * So there were two ways to move: rewrite forty-one files and the eighty-one
 * suites that drive them, or translate at the door. This translates at the
 * door. Nothing in api/ knows which host it is on, server.mjs keeps working as
 * the local preview, and every suite that calls a handler directly still does.
 *
 * THREE THINGS HERE ARE LOAD BEARING, and each one fails quietly if it is lost:
 *
 *   1. THE BODY IS A STREAM, ALWAYS. Netlify buffers an ordinary response and
 *      caps it at 6 MB; a streamed one is allowed 20 MB. /api/products is ~7 MB,
 *      so a buffered reply would be refused on exactly the endpoint the site
 *      exists to serve. Streaming is also what lets the concierge's SSE reach
 *      the browser token by token instead of all at once at the end.
 *
 *   2. THE RESPONSE GOES OUT WHEN THE HEAD IS READY, NOT WHEN THE HANDLER
 *      RETURNS. api/track.js answers 204 first and does its forwarding after,
 *      on purpose. `waitUntil` keeps the function alive for that second half;
 *      without it the work after the answer is frozen mid-flight.
 *
 *   3. THE CLIENT'S ADDRESS COMES FROM THE PLATFORM, NEVER FROM THE CLIENT.
 *      The sign-in limiter and the concierge limiter both key on
 *      x-forwarded-for / x-real-ip. A visitor can send those headers
 *      themselves, so they are overwritten here with the address Netlify saw.
 *      Trusting the inbound value turns a rate limit into a suggestion.
 *
 * Zero dependencies, like everything else in this repo (CLAUDE.md §11).
 */
import { Readable } from 'node:stream';
import { EventEmitter } from 'node:events';
import { createHash } from 'node:crypto';

/* Statuses that may not carry a body. `new Response(stream, {status: 204})`
   throws, and api/track.js answers 204 on every beacon. */
const NULL_BODY = new Set([204, 205, 304]);

const bytes = (chunk, encoding) => {
  if (chunk == null) return null;
  if (typeof chunk === 'string') return Buffer.from(chunk, encoding || 'utf8');
  if (chunk instanceof Uint8Array) return chunk;
  if (chunk instanceof ArrayBuffer) return new Uint8Array(chunk);
  return Buffer.from(String(chunk));
};

/* `?a=1&a=2` is an array, a single value is a string: the shape the handlers
   were written against. `__proto__` is dropped rather than assigned: on a plain
   object that key is a setter, and `?__proto__=a&__proto__=b` would hand every
   handler a query whose prototype is an array. */
function queryOf(searchParams, extra) {
  const q = {};
  for (const [k, v] of searchParams) {
    if (k === '__proto__') continue;
    q[k] = Object.hasOwn(q, k) ? [].concat(q[k], v) : v;
  }
  return Object.assign(q, extra || {});
}

function cookiesOf(header) {
  const out = {};
  for (const part of String(header || '').split(';')) {
    const i = part.indexOf('=');
    if (i < 1) continue;
    const k = part.slice(0, i).trim();
    let v = part.slice(i + 1).trim();
    try { v = decodeURIComponent(v); } catch { /* keep the raw value */ }
    if (k && !(k in out)) out[k] = v;
  }
  return out;
}

/* PRE-PARSED, BY CONTENT TYPE, the way the handlers expect it. Each of them
   reads `req.body` first and only falls back to the stream when it is absent
   (see readBody() in api/subscribe.js, api/track.js and the rest), so both are
   provided. A body that claims to be JSON and is not is left undefined rather
   than thrown: the handler then reads the stream, fails to parse it the same
   way, and answers with its own validation error instead of a platform 500. */
function bodyOf(raw, contentType) {
  if (!contentType) return undefined;
  const type = String(contentType).split(';')[0].trim().toLowerCase();
  if (type === 'application/json') {
    const s = raw.toString('utf8');
    if (!s) return {};
    try { return JSON.parse(s); } catch { return undefined; }
  }
  if (type === 'application/x-www-form-urlencoded') return queryOf(new URLSearchParams(raw.toString('utf8')));
  if (type === 'text/plain') return raw.toString('utf8');
  if (type === 'application/octet-stream') return raw;
  return undefined;
}

/**
 * A web Request, as the Node request an api/ handler reads.
 * `client` is what the platform knows about the caller: { ip, geo }.
 * `query` is merged over the url's own, for routes that carry a parameter in
 * the path (/p/<id>).
 */
export async function nodeRequest(request, { client = {}, query } = {}) {
  const url = new URL(request.url);
  const raw = request.body ? Buffer.from(await request.arrayBuffer()) : Buffer.alloc(0);

  const req = Readable.from(raw.length ? [raw] : [], { objectMode: false });
  req.method = request.method;
  req.url = url.pathname + url.search;
  req.httpVersion = '1.1';

  const headers = {};
  for (const [k, v] of request.headers) headers[k.toLowerCase()] = v;

  headers.host = headers.host || url.host;
  headers['x-forwarded-host'] = url.host;
  headers['x-forwarded-proto'] = url.protocol.replace(':', '');

  /* See (3) in the header of this file. Deleted before they are set, so a
     caller-supplied value cannot survive a platform that reports nothing. */
  delete headers['x-real-ip'];
  delete headers['x-forwarded-for'];
  if (client.ip) {
    headers['x-real-ip'] = client.ip;
    headers['x-forwarded-for'] = client.ip;
  }

  /* WHERE THE VISITOR IS, as three plain headers api/track.js reads. Same rule
     as the address: removed first, so nobody can tell the analytics they are
     somewhere they are not. The city is percent-encoded because a header is
     ASCII and "São Paulo" is not; the reader already decodes it. */
  for (const k of ['x-geo-country', 'x-geo-region', 'x-geo-city']) delete headers[k];
  const geo = client.geo || {};
  if (geo.country && geo.country.code) headers['x-geo-country'] = String(geo.country.code);
  if (geo.subdivision && geo.subdivision.code) headers['x-geo-region'] = String(geo.subdivision.code);
  if (geo.city) headers['x-geo-city'] = encodeURIComponent(String(geo.city));

  req.headers = headers;
  req.query = queryOf(url.searchParams, query);
  req.cookies = cookiesOf(headers.cookie);
  req.body = bodyOf(raw, headers['content-type']);
  req.socket = { remoteAddress: client.ip || undefined };
  req.connection = req.socket;
  return req;
}

/* Weak, and derived from the bytes: the same reply gets the same tag on every
   instance, so the CDN can answer a browser's If-None-Match with a 304 instead
   of sending seven megabytes of catalogue to someone who already holds them.
   Answering 304 is left to the CDN; this only gives it something to compare. */
const etagOf = (buf) => `W/"${buf.length.toString(16)}-${createHash('sha1').update(buf).digest('base64').slice(0, 27)}"`;

/**
 * The Node response an api/ handler writes to, and the web Response it becomes.
 *
 *   const res = nodeResponse();
 *   handler(req, res);
 *   const { status, headers, body } = await res.head;   // settles on first write
 */
export function nodeResponse() {
  const res = new EventEmitter();
  const store = new Map();            // lower-cased name -> [original name, value]
  let controller = null;
  let open = true;                    // the client is still listening
  let settle;

  res.head = new Promise((resolve) => { settle = resolve; });
  res.statusCode = 200;
  res.statusMessage = '';
  res.headersSent = false;
  res.writableEnded = false;
  res.finished = false;

  const body = new ReadableStream({
    start(c) { controller = c; },
    /* The browser went away: closed tab, aborted fetch, a finished EventSource.
       The handler is told the Node way, and later writes become no-ops rather
       than exceptions thrown into the middle of a model stream. */
    cancel() { open = false; res.destroyed = true; res.emit('close'); },
  });

  const commit = () => {
    if (res.headersSent) return;
    const headers = new Headers();
    for (const [, [name, value]] of store) {
      if (Array.isArray(value)) for (const v of value) headers.append(name, String(v));
      else headers.set(name, String(value));
    }
    /* Marked sent only once there is something to send. Had the loop above
       thrown with this already true, the failure path would have believed the
       head was on the wire, said nothing, and left the caller waiting on a
       promise nobody was ever going to settle. */
    res.headersSent = true;
    settle({ status: res.statusCode, headers, body });
  };

  /* REFUSED HERE, AT THE CALL, the way Node refuses it (ERR_INVALID_CHAR). A
     value a header cannot carry -- a newline, a character above U+00FF, as in
     a `?redirect=` echoed into Location -- throws in the handler, where it
     becomes an ordinary 500, instead of surfacing later inside commit(). */
  const probe = new Headers();
  res.setHeader = (name, value) => {
    for (const v of Array.isArray(value) ? value : [value]) probe.set(String(name), String(v));
    store.set(String(name).toLowerCase(), [String(name), value]);
    return res;
  };
  res.getHeader = (name) => { const h = store.get(String(name).toLowerCase()); return h ? h[1] : undefined; };
  res.hasHeader = (name) => store.has(String(name).toLowerCase());
  res.removeHeader = (name) => { store.delete(String(name).toLowerCase()); };
  res.getHeaderNames = () => [...store.keys()];
  res.getHeaders = () => Object.fromEntries([...store].map(([k, [, v]]) => [k, v]));

  res.writeHead = (code, message, headers) => {
    if (typeof message === 'object' && message) { headers = message; message = undefined; }
    res.statusCode = code;
    if (message) res.statusMessage = message;
    for (const [k, v] of Object.entries(headers || {})) res.setHeader(k, v);
    commit();
    return res;
  };
  res.flushHeaders = () => commit();

  res.write = (chunk, encoding, cb) => {
    if (typeof encoding === 'function') { cb = encoding; encoding = undefined; }
    commit();
    const b = bytes(chunk, encoding);
    if (b && b.length && open && !res.writableEnded) {
      try { controller.enqueue(b); } catch { open = false; }
    }
    if (cb) cb();
    return true;
  };

  res.end = (chunk, encoding, cb) => {
    if (typeof chunk === 'function') { cb = chunk; chunk = undefined; }
    if (typeof encoding === 'function') { cb = encoding; encoding = undefined; }
    if (res.writableEnded) { if (cb) cb(); return res; }
    if (chunk != null) res.write(chunk, encoding);
    commit();
    res.writableEnded = true;
    res.finished = true;
    if (open) { try { controller.close(); } catch { /* already closed by the client */ } }
    res.emit('finish');
    if (cb) cb();
    return res;
  };

  /* ---- the helper surface the handlers actually use (server.mjs has the same
     three in enhanceRes(), for the same reason) ---- */
  res.status = (code) => { res.statusCode = code; return res; };

  res.send = (data) => {
    if (data != null && typeof data === 'object' && !(data instanceof Uint8Array)) return res.json(data);
    if (typeof data === 'number' || typeof data === 'boolean') return res.json(data);
    if (typeof data === 'string') {
      const type = res.getHeader('content-type');
      if (!type) res.setHeader('Content-Type', 'text/html; charset=utf-8');
      else if (typeof type === 'string' && !/charset=/i.test(type)) res.setHeader('Content-Type', `${type}; charset=utf-8`);
    } else if (data instanceof Uint8Array && !res.hasHeader('content-type')) {
      res.setHeader('Content-Type', 'application/octet-stream');
    }
    const buf = bytes(data) || Buffer.alloc(0);
    if (buf.length && res.statusCode === 200 && !res.hasHeader('etag')) res.setHeader('ETag', etagOf(buf));
    return res.end(buf);
  };

  res.json = (value) => {
    if (!res.hasHeader('content-type')) res.setHeader('Content-Type', 'application/json; charset=utf-8');
    return res.send(JSON.stringify(value));
  };

  res.redirect = (code, location) => {
    if (typeof code === 'string') { location = code; code = 307; }
    res.statusCode = code;
    res.setHeader('Location', location);
    return res.end();
  };

  /* Reached when the handler threw after the head went out: the status is
     already on the wire, so all that is left is to stop cleanly. */
  res.abort = (err) => {
    if (res.writableEnded) return;
    res.writableEnded = true;
    if (open) { try { controller.error(err); } catch { /* nothing left to tell */ } }
  };

  return res;
}

/**
 * Run one handler against one web Request and answer with a web Response.
 *
 *   handler   an api/*.js default export
 *   opts      { client: { ip, geo }, query, waitUntil, decorate(headers, { status, req }) }
 *
 * `decorate` is the platform's last word on the headers, applied once, at the
 * moment they are sent. It lives with the caller because what belongs there is
 * a hosting decision, not a property of translating Node to the web.
 */
export async function serve(handler, request, opts = {}) {
  const req = await nodeRequest(request, opts);
  const res = nodeResponse();

  /* ONE FAILURE PATH, and the tidy-up after a handler that returned without
     answering goes through it too. Whatever goes wrong, `res.head` is settled:
     a request must end in an answer, never in the platform's 60-second kill. */
  const fail = (err) => {
    console.error(`[api] ${req.method} ${req.url} threw:`, err && err.stack ? err.stack : err);
    if (res.headersSent) return res.abort(err);
    try {
      res.statusCode = 500;
      for (const name of res.getHeaderNames()) res.removeHeader(name);
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.setHeader('Cache-Control', 'no-store');
      res.end(JSON.stringify({ error: 'server error' }));
    } catch (again) {
      console.error('[api] could not even answer 500:', again);
    }
  };
  const done = (async () => handler(req, res))()
    .then(() => { if (!res.writableEnded) res.end(); })    // returned without answering: say so, as server.mjs does
    .catch(fail);

  /* See (2) in the header of this file. */
  if (typeof opts.waitUntil === 'function') opts.waitUntil(done);

  const { status, headers, body } = await res.head;
  if (typeof opts.decorate === 'function') opts.decorate(headers, { status, req });

  /* A bodiless answer leaves the stream unread rather than cancelled: cancelling
     would tell the handler its client had hung up, and api/track.js is still
     working at that point by design. */
  const bare = NULL_BODY.has(status) || request.method === 'HEAD';
  /* A web Response can only be built for 200-599. Anything else a handler
     might set is a bug in the handler, and it is answered as one. */
  if (!(status >= 200 && status <= 599)) {
    console.error(`[api] ${req.method} ${req.url} set status ${status}, which cannot be sent`);
    return new Response(JSON.stringify({ error: 'server error' }), {
      status: 500, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
    });
  }
  return new Response(bare ? null : body, { status, headers });
}
