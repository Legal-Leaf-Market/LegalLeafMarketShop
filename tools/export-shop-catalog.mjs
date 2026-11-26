// tools/export-shop-catalog.mjs -- copy the catalogue OFF Shopify, photos included.
//
//   node tools/export-shop-catalog.mjs            (needs ImageMagick's `convert`)
//
// WHY: Shopify is being closed (owner, 25 Nov 2026: "we are ditching shopify").
// /shop reads api/_catalog-data.json first (api/catalog.js), so once this has
// run, nothing on the site asks Shopify for anything, and the store can be
// cancelled without the shop losing a single product or photo.
//
// WHERE FROM: every host in SOURCES, unioned by handle, first host wins. The
// old store (tjsd6x-jw) is listed first because it still publishes the whole
// catalogue; the new one (czmeq0-ik) only publishes about 500. A host that
// fails is reported and skipped, so this keeps working after either closes.
//
// WHAT IS WRITTEN
//   api/_catalog-data.json   Shopify-shaped rows (only the fields api/catalog.js
//                            reads), with image src rewritten to /shop/img/...
//   public/shelf.html etc.   any cdn.shopify.com image link in LOCALIZE files is
//                            downloaded and rewritten to /shop/img/cdn-<hash>.webp
//   public/shop/img/*.webp   up to IMAGES_PER_PRODUCT photos per product, 700px,
//                            quality 72 (about 30-40 KB each). Existing files are
//                            kept, so a re-run only downloads what is new.
// Products api/catalog.js would block anyway (cannabis-worded, THC, kratom...)
// are not exported at all, so their photos are never hosted here.
import { writeFileSync, readFileSync, mkdirSync, existsSync, unlinkSync } from "node:fs"
import { createHash } from "node:crypto"
import { execFileSync } from "node:child_process"
import { BLOCKED } from "../api/catalog.js"

const SOURCES = (process.env.SHOP_SOURCES || "tjsd6x-jw.myshopify.com,czmeq0-ik.myshopify.com")
  .split(",").map((s) => s.trim()).filter(Boolean)
const IMAGES_PER_PRODUCT = Number(process.env.IMAGES_PER_PRODUCT || 2)
const OUT_JSON = new URL("../api/_catalog-data.json", import.meta.url)
const IMG_DIR = new URL("../public/shop/img/", import.meta.url)

const tagsOf = (t) => (Array.isArray(t) ? t : String(t || "").split(",")).map((x) => x.trim()).filter(Boolean)
const slug = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 80)

async function getJson(url) {
  for (let attempt = 1; ; attempt++) {
    const r = await fetch(url, { headers: { accept: "application/json", "user-agent": "Mozilla/5.0 (legalleafmarket.shop export)" } })
    if (r.ok) return r.json()
    if (attempt >= 5 || (r.status !== 429 && r.status < 500)) throw new Error(`${r.status} ${url}`)
    await new Promise((res) => setTimeout(res, 2000 * attempt))
  }
}

async function readHost(host) {
  const rows = []
  for (let page = 1; page <= 20; page++) {
    const body = await getJson(`https://${host}/products.json?limit=250&page=${page}`)
    const got = body.products || []
    rows.push(...got)
    if (got.length < 250) break
  }
  return rows
}

async function fetchImage(src, outPath) {
  const tmp = outPath + ".src"
  const r = await fetch(src.replace(/^\/\//, "https://"))
  if (!r.ok) throw new Error(`${r.status}`)
  writeFileSync(tmp, Buffer.from(await r.arrayBuffer()))
  try {
    // First frame only (some product photos are animated GIFs), flattened onto white.
    execFileSync("convert", [tmp + "[0]", "-auto-orient", "-background", "white", "-alpha", "remove",
      "-resize", "700x700>", "-strip", "-quality", "72", outPath], { stdio: "pipe" })
  } finally {
    unlinkSync(tmp)
  }
}

// ---- read ----
const byHandle = new Map()
for (const host of SOURCES) {
  try {
    const rows = await readHost(host)
    let added = 0
    for (const p of rows) if (p.handle && !byHandle.has(p.handle)) { byHandle.set(p.handle, p); added++ }
    console.log(`${host}: ${rows.length} published, ${added} new`)
  } catch (e) {
    console.log(`${host}: FAILED (${e.message}), skipped`)
  }
}
if (!byHandle.size) throw new Error("No source answered; keeping the existing export untouched.")

// ---- export ----
mkdirSync(IMG_DIR, { recursive: true })
const out = []
let blocked = 0, imgNew = 0, imgKept = 0, imgFailed = 0
for (const p of byHandle.values()) {
  const tags = tagsOf(p.tags)
  if (BLOCKED.test([p.title, p.product_type, p.vendor, tags.join(" ")].join(" "))) { blocked++; continue }
  const images = []
  for (const [i, im] of (p.images || []).slice(0, IMAGES_PER_PRODUCT).entries()) {
    const name = `${slug(p.handle)}-${i + 1}.webp`
    const path = new URL(name, IMG_DIR).pathname
    if (existsSync(path)) { imgKept++; images.push({ src: `/shop/img/${name}` }); continue }
    try {
      await fetchImage(im.src, path)
      imgNew++
      images.push({ src: `/shop/img/${name}` })
    } catch (e) {
      imgFailed++
      console.log(`  image failed: ${p.handle} #${i + 1} (${e.message})`)
    }
  }
  out.push({
    handle: p.handle,
    title: p.title,
    vendor: p.vendor || "",
    product_type: p.product_type || "",
    tags,
    body_html: p.body_html || "",
    variants: (p.variants || []).map((v) => ({
      id: v.id, title: v.title, price: v.price, compare_at_price: v.compare_at_price || null,
      available: v.available !== false, sku: v.sku || "",
    })),
    images,
  })
}
out.sort((a, b) => a.handle.localeCompare(b.handle))
writeFileSync(OUT_JSON, JSON.stringify({ exportedAt: new Date().toISOString(), sources: SOURCES, products: out }))
console.log(`Exported ${out.length} products (${blocked} blocked, not exported). Images: ${imgNew} new, ${imgKept} kept, ${imgFailed} failed.`)

// ---- hand-written pages that link Shopify's CDN directly ----
const LOCALIZE = (process.env.LOCALIZE || "public/shelf.html").split(",").map((s) => s.trim()).filter(Boolean)
for (const file of LOCALIZE) {
  const path = new URL("../" + file, import.meta.url)
  if (!existsSync(path)) continue
  let html = readFileSync(path, "utf8")
  const urls = [...new Set(html.match(/https:\/\/cdn\.shopify\.com\/[^"'\s)]+/g) || [])]
  let done = 0
  for (const url of urls) {
    const name = `cdn-${createHash("sha1").update(url).digest("hex").slice(0, 12)}.webp`
    const out = new URL(name, IMG_DIR).pathname
    try {
      if (!existsSync(out)) await fetchImage(url, out)
      html = html.split(url).join(`/shop/img/${name}`)
      done++
    } catch (e) {
      console.log(`  ${file}: image failed (${e.message}) ${url}`)
    }
  }
  writeFileSync(path, html)
  console.log(`${file}: ${done}/${urls.length} Shopify image links now served from /shop/img`)
}
