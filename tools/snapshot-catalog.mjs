// tools/snapshot-catalog.mjs -- writes public/shop/catalog.json for /shop.
//
//   node tools/snapshot-catalog.mjs [shopify-host]
//
// Reads the Shopify storefront's public /products.json (no login) and keeps a
// small, static copy of the catalog so /shop works with no backend. When the
// Medusa store (commerce/) is hosted, /shop reads it live instead and this
// file is only the fallback.
//
// WHAT IS LEFT OUT, ON PURPOSE: anything cannabinoid or botanical-drug
// (THC of any kind, CBD/CBN/CBG, hemp flower, kratom, mushrooms). The card
// processor for this store (a vape/tobacco merchant account) does not cover
// those, and underwriters reject a site that shows them. Excluded items are
// listed in the summary the script prints so nothing disappears silently.
import { writeFileSync, mkdirSync } from "node:fs"

const host = (process.argv[2] || process.env.SHOPIFY_STORE || "czmeq0-ik.myshopify.com").replace(/^https?:\/\//, "")
const OUT = new URL("../public/shop/catalog.json", import.meta.url)

export const EXCLUDE =
  /\b(thc|thca|thc-?[apvo]|delta[ -]?(8|9|10)|d8|d9|d10|hhc|hhc-?p|thcp|cbd|cbn|cbg|cbc|hemp flower|pre-?rolls?|cannabis|cannabinoid|marijuana|dispensary|kratom|kava|amanita|muscimol|psilocybin|mushroom|shroom|gummy|gummies|edible|edibles|out of office|g\.?o\.?b\.?|good old boys|mystery weed|package protection)\b/i
// Hemp wick and hemp papers are fibre, not a cannabinoid, so "hemp" alone does
// not exclude. Slang in a maker's title is rewritten rather than dropping the
// item: the processor's wording rule is about what the site says.
const cleanTitle = (t) => t.replace(/\bweed\b/gi, "Herb").replace(/\s{2,}/g, " ").trim()
export const AGE_RESTRICTED =
  /\b(vape|vapes|vaping|vaporizer|e-?liquid|e-?juice|disposable|pod|pods|nicotine|nicotia|tobacco|cigar|cigars|cigarillo|hookah|shisha|pouch|pouches)\b/i

async function getJson(path) {
  for (let attempt = 1; ; attempt++) {
    const res = await fetch(`https://${host}${path}`, { headers: { accept: "application/json" } })
    if (res.ok) return res.json()
    if (attempt >= 5 || (res.status !== 429 && res.status < 500)) throw new Error(`GET ${path} -> ${res.status}`)
    await new Promise((r) => setTimeout(r, 2000 * attempt))
  }
}
async function allPages(path, key) {
  const out = []
  for (let page = 1; page < 200; page++) {
    const sep = path.includes("?") ? "&" : "?"
    const rows = (await getJson(`${path}${sep}limit=250&page=${page}`))[key] || []
    out.push(...rows)
    if (rows.length < 250) break
  }
  return out
}
const tagsOf = (p) => (Array.isArray(p.tags) ? p.tags : String(p.tags || "").split(",")).map((t) => t.trim()).filter(Boolean)
const text = (html) => String(html || "").replace(/<style[\s\S]*?<\/style>|<script[\s\S]*?<\/script>/gi, " ").replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/\s+/g, " ").trim()

// Shop sections, in menu order. First match wins.
const SECTIONS = [
  ["cigars", "Cigars & Tobacco", /\b(cigar|cigars|cigarillo|humidor|hookah|shisha|pipe tobacco|cutter)\b/i],
  // Not bare "pouch": Kavatza's joint pouches are cases, and Black Buffalo's
  // ZERO pouches are nicotine-free herbal dip (Herbal, below).
  ["vapes", "Vapes & Disposables", /\b(vape|vapes|disposable|e-?liquid|e-?juice|pod|pods|nicotine|nicotine pouch|nicotine pouches)\b/i],
  ["vaporizers", "Vaporizers & Rigs", /\b(vaporizer|e-?rig|dab|wax pen|510|battery|atomizer|coil)\b/i],
  ["glass", "Glass & Pipes", /\b(glass|pipe|pipes|bong|bubbler|water pipe|rig|chillum|one-?hitter|dugout|nectar collector)\b/i],
  ["papers", "Papers & Rolling", /\b(paper|papers|rolling|cone|cones|wrap|wraps|tips|filter|filters|tray|trays|roller)\b/i],
  ["grinders", "Grinders", /\b(grinder|grinders)\b/i],
  ["herbal", "Herbal & Tobacco-free", /\b(herbal|herb|herbs|tea|blend|nicotine-?free|tobacco-?free|shaman|bear blend|ceremonial|zero pouches|zero long cut)\b/i],
  ["storage", "Storage & Accessories", /./],
]

const products = await allPages("/products.json", "products")
const kept = []
const excluded = []
for (const p of products) {
  const tags = tagsOf(p)
  const hay = [p.title, p.product_type, p.vendor, tags.join(" ")].join(" ")
  if (EXCLUDE.test(hay)) { excluded.push(p.title); continue }
  const prices = p.variants.map((v) => Number(v.price)).filter((n) => n > 0)
  if (!prices.length) { excluded.push(`${p.title} (no price)`); continue }
  // Sections read the title and type first: tags carry store names
  // ("nicotia-cigars") that would file a vape under cigars.
  const own = [p.title, p.product_type].join(" ")
  const section = SECTIONS.slice(0, -1).find(([, , re]) => re.test(own)) || SECTIONS.find(([, , re]) => re.test(hay))
  const realOptions = p.options.filter((o) => !(o.name === "Title" && o.values.length === 1 && o.values[0] === "Default Title"))
  kept.push({
    h: p.handle,
    t: cleanTitle(p.title),
    b: p.vendor || "",
    s: section[0],
    a: AGE_RESTRICTED.test(hay) ? 1 : 0,
    p: Math.min(...prices),
    img: (p.images || []).slice(0, 4).map((i) => i.src.replace(/\?.*$/, "")),
    d: text(p.body_html).replace(/\b(weed|marijuana|cannabis|420)\b/gi, "herb").slice(0, 900),
    o: realOptions.map((o) => o.name),
    v: p.variants.map((v) => ({
      id: v.id,
      t: realOptions.length ? v.title : "",
      p: Number(v.price),
      sku: v.sku || "",
    })).filter((v) => v.p > 0),
  })
}
kept.sort((x, y) => x.s.localeCompare(y.s) || x.t.localeCompare(y.t))
mkdirSync(new URL("../public/shop/", import.meta.url), { recursive: true })
writeFileSync(
  OUT,
  JSON.stringify({
    from: host,
    at: new Date().toISOString(),
    sections: SECTIONS.map(([id, name]) => ({ id, name, n: kept.filter((k) => k.s === id).length })),
    products: kept,
  })
)
console.log(`Shopify ${host}: ${products.length} published, kept ${kept.length}, excluded ${excluded.length}`)
for (const [id, name] of SECTIONS) console.log(`  ${name}: ${kept.filter((k) => k.s === id).length}`)
console.log("Excluded:\n  " + excluded.join("\n  "))
