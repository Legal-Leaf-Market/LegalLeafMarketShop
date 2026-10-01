// api/admin/_gate.js — the admin gate. Shared by session.js, sign-in.js, home.js
// and model.js. Prefixed with `_` so Vercel does not turn this into its own route.
//
// One way in: ADMIN_PASSCODE, typed at /admin/sign-in. It doubles as the HMAC key
// for the session cookie, so rotating it signs everyone out — no separate signing
// secret to manage, and no database.
//
// The brief this was built from also specced an ADMIN_EMAILS + Better Auth path
// (an allowlist checked against the site's own login). This codebase has no user
// accounts, no Better Auth, and no DATABASE_URL — it is the zero-dependency
// static + serverless site CLAUDE.md describes, and adding a login system to gate
// one internal page would be a much bigger addition than the page itself. That
// path is intentionally not implemented here; see docs/ADMIN-OPERATING-MODEL.md.
//
// With ADMIN_PASSCODE unset, the gate denies everyone. That is deliberate: an
// unset env var on a fresh deploy must never publish the financials.

import { createHmac, timingSafeEqual } from 'node:crypto';

export const ADMIN_COOKIE = 'llm_admin';
export const ADMIN_SESSION_SECONDS = 60 * 60 * 24 * 30; // 30 days

export function passcode() {
  const value = (process.env.ADMIN_PASSCODE || '').trim();
  return value ? value : null;
}

export function adminConfigured() {
  return passcode() !== null;
}

function sign(payload, secret) {
  return createHmac('sha256', secret).update(payload).digest('hex');
}

/** Constant-time comparison that tolerates differing lengths. */
function safeEqualHex(a, b) {
  const bufA = Buffer.from(a, 'hex');
  const bufB = Buffer.from(b, 'hex');
  if (bufA.length === 0 || bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

export function issueToken(now = Date.now()) {
  const secret = passcode();
  if (!secret) return null;
  const issuedAt = Math.floor(now / 1000);
  return `${issuedAt}.${sign(`v1:${issuedAt}`, secret)}`;
}

function verifyToken(token, now = Date.now()) {
  const secret = passcode();
  if (!secret) return false;
  const separator = token.indexOf('.');
  if (separator <= 0) return false;
  const issuedAt = Number(token.slice(0, separator));
  const signature = token.slice(separator + 1);
  if (!Number.isFinite(issuedAt)) return false;

  const age = Math.floor(now / 1000) - issuedAt;
  // A future-dated token is a forged one; an expired token is simply stale.
  if (age < -60 || age > ADMIN_SESSION_SECONDS) return false;

  return safeEqualHex(sign(`v1:${issuedAt}`, secret), signature);
}

/** Constant-time check of a submitted passcode against the configured one. */
export function passcodeMatches(submitted) {
  const secret = passcode();
  if (!secret) return false;
  // Hash both sides first so the comparison is length-independent.
  const a = createHmac('sha256', secret).update(submitted).digest('hex');
  const b = createHmac('sha256', secret).update(secret).digest('hex');
  return safeEqualHex(a, b);
}

function parseCookies(header) {
  const out = {};
  if (!header) return out;
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq < 0) continue;
    const key = part.slice(0, eq).trim();
    if (!key) continue;
    out[key] = decodeURIComponent(part.slice(eq + 1).trim());
  }
  return out;
}

export function isAdmin(req) {
  const secret = passcode();
  if (!secret) return false;
  const cookies = parseCookies(req.headers.cookie);
  const token = cookies[ADMIN_COOKIE];
  return !!(token && verifyToken(token));
}

export function setSessionCookie(res, token) {
  const parts = [
    `${ADMIN_COOKIE}=${token}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${ADMIN_SESSION_SECONDS}`,
  ];
  if (process.env.NODE_ENV === 'production') parts.push('Secure');
  res.setHeader('Set-Cookie', parts.join('; '));
}

export function clearSessionCookie(res) {
  const parts = [`${ADMIN_COOKIE}=`, 'Path=/', 'HttpOnly', 'SameSite=Lax', 'Max-Age=0'];
  if (process.env.NODE_ENV === 'production') parts.push('Secure');
  res.setHeader('Set-Cookie', parts.join('; '));
}

/**
 * Per-instance attempt counter. A serverless deployment spreads requests across
 * instances so this is a speed bump rather than a hard limit — combined with the
 * fixed delay on failure it makes online guessing impractical without a shared
 * store, matching the throttle already used nowhere else in this repo (this is
 * the first endpoint that needed one).
 */
const attempts = new Map();
const WINDOW_MS = 10 * 60 * 1000;
const MAX_ATTEMPTS = 8;

export function clientKey(req) {
  const forwarded = req.headers['x-forwarded-for'];
  if (forwarded) return String(forwarded).split(',')[0].trim();
  return req.headers['x-real-ip'] || req.socket?.remoteAddress || 'unknown';
}

export function throttled(key) {
  const now = Date.now();
  const entry = attempts.get(key);
  if (!entry || now > entry.resetAt) {
    attempts.set(key, { count: 1, resetAt: now + WINDOW_MS });
    return false;
  }
  entry.count += 1;
  return entry.count > MAX_ATTEMPTS;
}

export const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
