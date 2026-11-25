/* api/order.js -- an order from /shop, checked on the server.
 *
 * WHAT AN ORDER IS, UNTIL THE CARD PROCESSOR APPROVES US. PaymentCloud's
 * application went in on 25 Nov 2026. Until it issues NMI keys there is no
 * online card payment, so an order here is a request: we confirm it, deliver
 * it by hand, check ID at the door, and take payment there (card reader or
 * cash). When the keys arrive, checkout moves to the Medusa backend, which
 * already carries the NMI provider (commerce/src/modules/nmi-payment).
 *
 * THE RULES ARE ENFORCED HERE, NOT ON THE PAGE, so editing the page skips
 * nothing. They mirror commerce/src/workflows/hooks/age-check.ts:
 *   - every buyer gives a date of birth that makes them 21 or older (the whole
 *     site is 21+, so this is not limited to vape items);
 *   - delivery is by hand in Indiana only, so the address must be an Indiana
 *     one (state IN, ZIP 460xx-479xx);
 *   - prices come from the catalogue, never from the request.
 * The typed date of birth is a first filter, not proof. The ID check at the
 * door is the real one.
 *
 * WHERE AN ORDER GOES (any that are configured; at least one must succeed):
 *   KV (Upstash)            order:<number>, kept 400 days        (api/kv.js)
 *   RESEND_API_KEY          an email to LL_ORDER_EMAIL (default jake@legalleafmarket.shop)
 *                           from LL_ORDER_FROM (default orders@legalleafmarket.shop,
 *                           which must be a domain verified in Resend)
 *   LL_ORDER_WEBHOOK        a POST of the JSON, e.g. an Apps Script /exec url
 * If none is configured or all fail, the answer is 503 with the order summary,
 * and the page offers to send it by email instead. An order is never reported
 * as received when nothing received it.
 */
import { loadCatalog } from './catalog.js';
import { kvOn, kvSetJson } from './kv.js';

export const TAX_RATE = 0.07; // Indiana state sales tax
const MAX_LINES = 40;
const MAX_QTY = 20;

function readBody(req) {
  return new Promise((resolve) => {
    if (req.body && typeof req.body === 'object' && !Buffer.isBuffer(req.body)) return resolve(req.body);
    if (typeof req.body === 'string') { try { return resolve(JSON.parse(req.body)); } catch { return resolve({}); } }
    let d = '';
    req.on('data', (c) => { d += c; if (d.length > 100000) d = ''; });
    req.on('end', () => { try { resolve(JSON.parse(d || '{}')); } catch { resolve({}); } });
    req.on('error', () => resolve({}));
  });
}

/** Whole years between a YYYY-MM-DD birth date and `today` (UTC), or null. */
export function ageOn(dob, today = new Date()) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(dob || ''));
  if (!m) return null;
  const y = +m[1], mo = +m[2], d = +m[3];
  if (mo < 1 || mo > 12 || d < 1 || d > 31 || y < 1900) return null;
  let age = today.getUTCFullYear() - y;
  const before = today.getUTCMonth() + 1 < mo || (today.getUTCMonth() + 1 === mo && today.getUTCDate() < d);
  if (before) age--;
  return age;
}

export const isIndianaZip = (z) => /^4[67]\d{3}(-\d{4})?$/.test(String(z || '').trim()) && +String(z).slice(0, 3) >= 460 && +String(z).slice(0, 3) <= 479;
const isIndiana = (s) => ['in', 'indiana'].includes(String(s || '').trim().toLowerCase());
const okEmail = (e) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(e || '').trim());
const digits = (s) => String(s || '').replace(/\D/g, '');
const clip = (s, n) => String(s == null ? '' : s).trim().slice(0, n);
const cents = (n) => Math.round(n * 100) / 100;

function orderNumber(now = new Date()) {
  const ymd = now.toISOString().slice(2, 10).replace(/-/g, '');
  const rand = Math.random().toString(36).slice(2, 6).toUpperCase();
  return `LL-${ymd}-${rand}`;
}

/** Validate and price an order against the catalogue. Pure apart from `now`. */
export function buildOrder(body, products, now = new Date()) {
  const errors = [];
  const c = (body && body.customer) || {};
  const a = (body && body.address) || {};

  const name = clip(c.name, 120);
  const email = clip(c.email, 200).toLowerCase();
  const phone = clip(c.phone, 40);
  if (name.length < 2) errors.push({ field: 'name', message: 'Please enter your full name, as it appears on your ID.' });
  if (!okEmail(email)) errors.push({ field: 'email', message: 'Please enter a valid email address.' });
  if (digits(phone).length < 10) errors.push({ field: 'phone', message: 'Please enter a phone number so the driver can reach you.' });

  const age = ageOn(c.dob, now);
  if (age === null) errors.push({ field: 'dob', message: 'Please enter your date of birth.' });
  else if (age < 21) errors.push({ field: 'dob', message: 'You must be 21 or older to order from Legal-Leaf Market.' });
  else if (age > 120) errors.push({ field: 'dob', message: 'Please check your date of birth.' });

  const address = {
    line1: clip(a.line1, 160), line2: clip(a.line2, 160), city: clip(a.city, 80),
    state: clip(a.state, 20).toUpperCase(), zip: clip(a.zip, 10),
  };
  if (address.line1.length < 3) errors.push({ field: 'line1', message: 'Please enter a street address.' });
  if (address.city.length < 2) errors.push({ field: 'city', message: 'Please enter a city.' });
  if (!isIndiana(address.state) || !isIndianaZip(address.zip)) {
    errors.push({ field: 'zip', message: 'We hand-deliver in Indiana only. Please use an Indiana delivery address.' });
  }
  if (!body || body.agree !== true) errors.push({ field: 'agree', message: 'Please confirm you are 21+ and will show a valid photo ID at delivery.' });

  const byId = new Map(products.map((p) => [p.id, p]));
  const lines = [];
  const items = Array.isArray(body && body.items) ? body.items.slice(0, MAX_LINES) : [];
  for (const it of items) {
    const p = byId.get(String(it && it.id));
    if (!p) { errors.push({ field: 'items', message: 'One item in your cart is no longer available. Please remove it and try again.' }); continue; }
    const v = p.variants.find((x) => x.id === String(it.variant)) || (p.variants.length === 1 ? p.variants[0] : null);
    if (!v) { errors.push({ field: 'items', message: `Please choose an option for ${p.title}.` }); continue; }
    const qty = Math.max(1, Math.min(MAX_QTY, Math.floor(Number(it.qty) || 1)));
    lines.push({ id: p.id, variant: v.id, title: p.title, option: v.title, brand: p.brand, qty, price: v.price, total: cents(v.price * qty), ageRestricted: p.ageRestricted });
  }
  if (!lines.length && !errors.some((e) => e.field === 'items')) errors.push({ field: 'items', message: 'Your cart is empty.' });

  const subtotal = cents(lines.reduce((s, l) => s + l.total, 0));
  const fee = cents(Math.max(0, Number(process.env.LL_DELIVERY_FEE || 0)));
  const tax = cents((subtotal + fee) * TAX_RATE);
  const total = cents(subtotal + fee + tax);

  const channel = String((body && body.channel) || 'web') === 'kiosk' ? 'kiosk' : 'web';
  const partner = clip(body && body.partner, 60).toLowerCase().replace(/[^a-z0-9-]/g, '');

  return {
    errors,
    order: {
      number: orderNumber(now),
      placed: now.toISOString(),
      status: 'requested',
      payment: 'at_delivery',
      channel, partner,
      customer: { name, email, phone, dob: String(c.dob), age },
      address,
      notes: clip(body && body.notes, 1000),
      lines, subtotal, delivery: fee, tax, taxRate: TAX_RATE, total,
      ageRestricted: lines.some((l) => l.ageRestricted),
    },
  };
}

const usd = (n) => '$' + Number(n).toFixed(2);

export function orderText(o) {
  const rows = o.lines.map((l) => `  ${l.qty} x ${l.title}${l.option ? ' (' + l.option + ')' : ''}  ${usd(l.total)}${l.ageRestricted ? '  [21+ ID]' : ''}`);
  return [
    `Order ${o.number}  (${o.channel}${o.partner ? ': ' + o.partner : ''})`,
    `Placed ${o.placed}`,
    '',
    `${o.customer.name}  |  ${o.customer.phone}  |  ${o.customer.email}`,
    `DOB ${o.customer.dob} (age ${o.customer.age})`,
    `${o.address.line1}${o.address.line2 ? ', ' + o.address.line2 : ''}, ${o.address.city}, ${o.address.state} ${o.address.zip}`,
    '',
    ...rows,
    '',
    `Subtotal ${usd(o.subtotal)}`,
    `Delivery ${usd(o.delivery)}`,
    `Tax (7%) ${usd(o.tax)}`,
    `Total    ${usd(o.total)}   payment at delivery`,
    o.notes ? `\nNotes: ${o.notes}` : '',
    o.ageRestricted ? '\nCheck a valid photo ID (21+) at the door before handing over.' : '\nCheck a valid photo ID (21+) at the door.',
  ].join('\n');
}

async function deliver(o) {
  const sinks = {};
  const jobs = [];
  if (kvOn()) {
    jobs.push(kvSetJson(`order:${o.number}`, o, 400 * 86400).then((ok) => { sinks.kv = !!ok; }).catch(() => { sinks.kv = false; }));
  }
  if (process.env.RESEND_API_KEY) {
    const to = process.env.LL_ORDER_EMAIL || 'jake@legalleafmarket.shop';
    const from = process.env.LL_ORDER_FROM || 'Legal-Leaf Market <orders@legalleafmarket.shop>';
    jobs.push(fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + process.env.RESEND_API_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from, to: [to], reply_to: o.customer.email, subject: `New order ${o.number}: ${usd(o.total)}`, text: orderText(o) }),
    }).then((r) => { sinks.email = r.ok; }).catch(() => { sinks.email = false; }));
  }
  if (process.env.LL_ORDER_WEBHOOK) {
    jobs.push(fetch(process.env.LL_ORDER_WEBHOOK, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ type: 'order', ...o }),
    }).then((r) => { sinks.webhook = r.ok; }).catch(() => { sinks.webhook = false; }));
  }
  await Promise.all(jobs);
  return sinks;
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') { res.setHeader('Allow', 'POST'); return res.status(405).json({ ok: false, error: 'POST only' }); }
  const body = await readBody(req);
  if (body && body.website) return res.status(200).json({ ok: true }); // honeypot

  let catalog;
  try { catalog = await loadCatalog(); } catch (e) {
    return res.status(503).json({ ok: false, error: 'Our catalogue could not be loaded just now. Please try again in a minute.' });
  }
  const { errors, order } = buildOrder(body, catalog.products);
  if (errors.length) return res.status(400).json({ ok: false, errors });

  const sinks = await deliver(order);
  const received = Object.values(sinks).some(Boolean);
  const summary = { number: order.number, lines: order.lines, subtotal: order.subtotal, delivery: order.delivery, tax: order.tax, total: order.total, payment: order.payment };
  if (!received) {
    console.error('[order] no sink accepted order', order.number, JSON.stringify(sinks));
    return res.status(503).json({ ok: false, fallback: 'email', email: 'jake@legalleafmarket.shop', text: orderText(order), order: summary });
  }
  return res.status(200).json({ ok: true, order: summary });
}
