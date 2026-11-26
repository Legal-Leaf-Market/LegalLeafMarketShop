/* api/catalog.js -- the catalogue behind /shop, our own storefront.
 *
 * WHY THIS EXISTS (25 Nov 2026). Shopify banned vape products for US merchants
 * in 2026, and vapes are core to this business, so the shop is moving off it.
 * The new backend is Medusa (branch claude/medusa-commerce, commerce/). Until
 * that is hosted, this endpoint reads the catalogue straight out of the
 * existing Shopify storefront's public JSON, so /shop works today and keeps
 * working the day the source changes.
 *
 * SOURCE ORDER, decided by env, one at a time:
 *   MEDUSA_URL + MEDUSA_PUBLISHABLE_KEY  -> Medusa store API (/store/products)
 *   otherwise                            -> Shopify /products.json at
 *                                           SHOPIFY_STORE (default below)
 * The shape that comes out is the same either way, so the page never knows.
 *
 * WHAT IS LEFT OUT, AND WHY. The card processor (PaymentCloud, tobacco/vape
 * account) reviews this site. Their rule, and Soar's, is no marijuana or
 * cannabis products, imagery or wording. So anything THC-family, cannabis
 * worded, or smokable-hemp is dropped here, server side, rather than hidden by
 * the page, and descriptions lose any sentence that names those words. It is
 * also the legal half: from 11 Dec 2026 most intoxicating hemp products stop
 * counting as legal hemp federally (gob/ notes). Vapes, e-liquid, nicotine,
 * tobacco and glass stay, and are flagged ageRestricted.
 *
 * ZERO DEPENDENCIES like the rest of api/ (CLAUDE.md section 1).
 */

const DEFAULT_SHOPIFY = 'czmeq0-ik.myshopify.com';
const PAGE = 250;
const MAX_PAGES = 8; // 2,000 rows; the store holds ~1,200
const TTL_MS = 15 * 60 * 1000;

/* Same list the Medusa import uses (commerce/src/scripts/import-shopify.ts),
   so the two storefronts agree on what needs a 21+ check at the door. */
export const AGE_RESTRICTED =
  /\b(vape|vapes|vaping|vaporizer|vaporizers|e-?liquid|e-?juice|disposable|disposables|pod|pods|nicotine|nicotia|tobacco|cigar|cigars|cigarillo|cigarillos|hookah|shisha|pouch|pouches|salt nic|coil|coils|atomizer)\b/i;

/* Products that do not go on this storefront at all. Word-anchored so "Weedless"
   glass or a "Pod" is not caught by accident; "flower" is only blocked in its
   product sense. */
export const BLOCKED =
  /\b(thc|thca|thc-?a|thcp|thcv|thc-?o|delta[- ]?(8|9|10)|d8|d9|d10|hhc|hhc-?p|cannabis|cannabinoid|marijuana|weed|kush|420|dispensary|strain|strains|indica|sativa|pre-?rolls?|prerolls?|hemp flower|smokable hemp|live resin|live rosin|distillate|kratom|amanita|psilocybin|magic mushrooms?|gob|good old boys)\b/i;

/* Words that drop a SENTENCE from a description, not the product. A bong
   whose blurb says "great for your favourite strain" keeps the bong. */
const SENTENCE_BLOCK =
  /\b(thc|thca|delta[- ]?(8|9|10)|hhc|cannabis|cannabinoid|marijuana|weed|kush|420|dispensary|strain|strains|indica|sativa|nug|nugs|stoned|get high|getting high|blazed|dank|ganja|reefer|pot leaf)\b/i;

const cache = { at: 0, data: null, inflight: null };

function stripHtml(html) {
  return String(html || '')
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<br\s*\/?>|<\/(p|li|div|h\d)>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&rsquo;|&lsquo;/g, "'")
    .replace(/&ldquo;|&rdquo;/g, '"')
    .replace(/&ndash;|&mdash;/g, '-')
    .replace(/&[a-z]+;/gi, ' ')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n\s*\n+/g, '\n')
    .trim();
}

/** Plain-text description with any cannabis-worded sentence removed. */
export function cleanDescription(html, max = 1200) {
  const text = stripHtml(html);
  const kept = text
    .split(/(?<=[.!?])\s+|\n+/)
    .map((s) => s.trim())
    .filter((s) => s && !SENTENCE_BLOCK.test(s));
  let out = kept.join(' ');
  if (out.length > max) out = out.slice(0, max - 1).replace(/\s+\S*$/, '') + '...';
  return out;
}

const tagsOf = (t) =>
  (Array.isArray(t) ? t : String(t || '').split(','))
    .map((x) => String(x).trim())
    .filter(Boolean);

const money = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : null;
};

/** One Shopify product -> our row, or null when it does not belong here. */
export function fromShopify(p) {
  if (!p || !p.handle || !p.title) return null;
  const tags = tagsOf(p.tags);
  const hay = [p.title, p.product_type, p.vendor, tags.join(' ')].join(' ');
  if (BLOCKED.test(hay)) return null;

  const variants = (p.variants || [])
    .map((v) => ({
      id: String(v.id),
      title: v.title && v.title !== 'Default Title' ? String(v.title) : '',
      price: money(v.price),
      compareAt: money(v.compare_at_price),
      available: v.available !== false,
    }))
    .filter((v) => v.price != null && v.price > 0)
    .filter((v) => !v.title || !BLOCKED.test(v.title));
  if (!variants.length) return null;

  const prices = variants.map((v) => v.price);
  const images = (p.images || []).map((i) => i && i.src).filter(Boolean).slice(0, 6);
  return {
    id: String(p.handle),
    title: String(p.title).trim(),
    brand: String(p.vendor || '').trim(),
    type: String(p.product_type || '').trim() || 'Accessories',
    tags,
    price: Math.min(...prices),
    priceMax: Math.max(...prices),
    image: images[0] || '',
    images,
    variants,
    description: cleanDescription(p.body_html),
    ageRestricted: AGE_RESTRICTED.test(hay),
  };
}

/** One Medusa store product -> our row. Prices are minor units in v2. */
export function fromMedusa(p) {
  if (!p || !p.handle || !p.title) return null;
  const tags = (p.tags || []).map((t) => t && t.value).filter(Boolean);
  const type = (p.type && p.type.value) || '';
  const brand = (p.collection && p.collection.title) || '';
  const hay = [p.title, type, brand, tags.join(' ')].join(' ');
  if (BLOCKED.test(hay)) return null;
  const variants = (p.variants || [])
    .map((v) => {
      const amt = v.calculated_price && v.calculated_price.calculated_amount;
      return {
        id: String(v.id),
        title: v.title && v.title !== 'Default' ? String(v.title) : '',
        price: money(amt),
        compareAt: money(v.calculated_price && v.calculated_price.original_amount),
        available: true,
      };
    })
    .filter((v) => v.price != null && v.price > 0);
  if (!variants.length) return null;
  const prices = variants.map((v) => v.price);
  const images = (p.images || []).map((i) => i && i.url).filter(Boolean).slice(0, 6);
  if (!images.length && p.thumbnail) images.push(p.thumbnail);
  return {
    id: String(p.handle),
    title: String(p.title).trim(),
    brand,
    type: type || 'Accessories',
    tags,
    price: Math.min(...prices),
    priceMax: Math.max(...prices),
    image: images[0] || '',
    images,
    variants,
    description: cleanDescription(p.description),
    ageRestricted: !!(p.metadata && p.metadata.age_restricted) || AGE_RESTRICTED.test(hay),
  };
}

async function getJson(url, headers = {}) {
  const r = await fetch(url, { headers: { accept: 'application/json', 'user-agent': 'Mozilla/5.0', ...headers } });
  if (!r.ok) throw new Error(`GET ${new URL(url).pathname} -> ${r.status}`);
  return r.json();
}

async function readShopify() {
  /* A bare host means https; a full http(s) origin is used as given (the test
     suites point this at a local fixture server). */
  const store = (process.env.SHOPIFY_STORE || DEFAULT_SHOPIFY).replace(/\/+$/, '');
  const origin = /^https?:\/\//.test(store) ? store : `https://${store}`;
  const raw = [];
  for (let page = 1; page <= MAX_PAGES; page++) {
    const body = await getJson(`${origin}/products.json?limit=${PAGE}&page=${page}`);
    const rows = (body && body.products) || [];
    raw.push(...rows);
    if (rows.length < PAGE) break;
  }
  return { source: 'shopify', raw: raw.length, products: raw.map(fromShopify).filter(Boolean) };
}

async function readMedusa() {
  const base = process.env.MEDUSA_URL.replace(/\/+$/, '');
  const headers = { 'x-publishable-api-key': process.env.MEDUSA_PUBLISHABLE_KEY };
  const region = process.env.MEDUSA_REGION_ID ? `&region_id=${encodeURIComponent(process.env.MEDUSA_REGION_ID)}` : '';
  const fields = '&fields=*variants.calculated_price,*images,*tags,*type,*collection,+metadata';
  const raw = [];
  for (let offset = 0; offset < PAGE * MAX_PAGES; offset += 100) {
    const body = await getJson(`${base}/store/products?limit=100&offset=${offset}${region}${fields}`, headers);
    const rows = (body && body.products) || [];
    raw.push(...rows);
    if (rows.length < 100) break;
  }
  return { source: 'medusa', raw: raw.length, products: raw.map(fromMedusa).filter(Boolean) };
}

/** The catalogue, cached per instance for 15 minutes. Shared with api/order.js. */
export async function loadCatalog({ fresh = false } = {}) {
  if (!fresh && cache.data && Date.now() - cache.at < TTL_MS) return cache.data;
  if (cache.inflight) return cache.inflight;
  const useMedusa = !!(process.env.MEDUSA_URL && process.env.MEDUSA_PUBLISHABLE_KEY);
  cache.inflight = (useMedusa ? readMedusa() : readShopify())
    .then((r) => {
      /* One row per handle; the first wins. */
      const seen = new Set();
      const products = r.products.filter((p) => (seen.has(p.id) ? false : (seen.add(p.id), true)));
      const data = { products, meta: { source: r.source, raw: r.raw, count: products.length, hidden: r.raw - products.length, updated: new Date().toISOString() } };
      cache.data = data;
      cache.at = Date.now();
      return data;
    })
    .finally(() => { cache.inflight = null; });
  return cache.inflight;
}

/** Test hook: forget the cached catalogue. */
export function _resetCatalog() { cache.at = 0; cache.data = null; cache.inflight = null; }

export default async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'GET only' });
  }
  try {
    const data = await loadCatalog();
    res.setHeader('Cache-Control', 'public, max-age=300, s-maxage=900, stale-while-revalidate=3600');
    const deliveryFee = Math.max(0, Number(process.env.LL_DELIVERY_FEE || 0)) || 0;
    return res.status(200).json({ products: data.products, meta: { ...data.meta, deliveryFee } });
  } catch (err) {
    console.error('[catalog]', err && err.message ? err.message : err);
    res.setHeader('Cache-Control', 'no-store');
    return res.status(502).json({ products: [], meta: { error: 'catalog unavailable' } });
  }
}
