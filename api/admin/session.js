// api/admin/session.js — /api/admin/session
//
// POST checks the admin passcode and issues the session cookie; DELETE clears
// it. Follows the same shape as api/overrides.js: fail closed when nothing is
// configured, never break on missing env vars.
//
//   POST   { passcode }  -> 200 { ok: true } + Set-Cookie, or 401/429/501
//   DELETE               -> 200 { ok: true }, clears the cookie

import { passcode, passcodeMatches, issueToken, setSessionCookie, clearSessionCookie, clientKey, throttled, delay } from './_gate.js';

function readBody(req) {
  return new Promise((resolve) => {
    if (req.body) {
      try {
        return resolve(typeof req.body === 'string' ? JSON.parse(req.body) : req.body);
      } catch (e) {
        return resolve({});
      }
    }
    let d = '';
    req.on('data', (c) => (d += c));
    req.on('end', () => {
      try {
        resolve(JSON.parse(d || '{}'));
      } catch (e) {
        resolve({});
      }
    });
  });
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');

  if (req.method === 'POST') {
    // Fails closed: no passcode configured means nobody can sign in, ever,
    // rather than the endpoint silently doing nothing useful.
    if (!passcode()) {
      return res.status(501).json({ error: 'Passcode sign-in is not configured on this deployment.' });
    }

    if (throttled(clientKey(req))) {
      return res.status(429).json({ error: 'Too many attempts. Wait a few minutes and try again.' });
    }

    const body = await readBody(req);
    const submitted = typeof body.passcode === 'string' ? body.passcode : '';

    if (!submitted || !passcodeMatches(submitted)) {
      await delay(400);
      return res.status(401).json({ error: "That passcode isn't right." });
    }

    const token = issueToken();
    if (!token) return res.status(501).json({ error: 'Passcode sign-in is not configured.' });

    setSessionCookie(res, token);
    return res.status(200).json({ ok: true });
  }

  if (req.method === 'DELETE') {
    clearSessionCookie(res);
    return res.status(200).json({ ok: true });
  }

  res.setHeader('Allow', 'POST, DELETE');
  return res.status(405).json({ error: 'POST or DELETE only' });
}
