import { ExecArgs } from "@medusajs/framework/types"
import { ContainerRegistrationKeys, Modules, ProductStatus } from "@medusajs/framework/utils"
import {
  createProductCategoriesWorkflow,
  createProductsWorkflow,
} from "@medusajs/medusa/core-flows"

/**
 * Copies the catalog out of the Shopify storefront into Medusa.
 *
 *   SHOPIFY_STORE=czmeq0-ik.myshopify.com npx medusa exec ./src/scripts/import-shopify.ts
 *
 * Reads only public storefront JSON (/products.json and /collections.json), so
 * it needs no Shopify login. Products already in Medusa (same handle) are
 * skipped, so it can be run again to pick up new ones. Handles are kept as-is
 * so old /products/<handle> links can redirect one-to-one.
 *
 * Mapping
 *   Shopify product_type -> Medusa product type
 *   Shopify vendor       -> Medusa collection (the brand)
 *   Shopify collections  -> Medusa categories (Head Shop, Lookah, ...)
 *   Shopify tags         -> Medusa tags
 *   vape / nicotine / tobacco items get metadata.age_restricted = true, which
 *   the checkout hook (src/workflows/hooks/age-check.ts) enforces.
 *
 * Inventory is not tracked: almost everything is special order. Variants allow
 * backorders so a 0 count never blocks a sale.
 *
 * Images still point at Shopify's CDN. They keep working while the Shopify
 * store exists; re-host them before closing it.
 */

type ShopifyVariant = {
  id: number
  title: string
  sku: string | null
  price: string
  compare_at_price: string | null
  option1: string | null
  option2: string | null
  option3: string | null
  grams: number
}
type ShopifyProduct = {
  id: number
  title: string
  handle: string
  body_html: string | null
  vendor: string
  product_type: string
  tags: string[] | string
  options: { name: string; values: string[] }[]
  variants: ShopifyVariant[]
  images: { src: string }[]
}
type ShopifyCollection = { handle: string; title: string; description?: string }

const AGE_RESTRICTED =
  /\b(vape|vapes|vaping|vaporizer|e-?liquid|e-?juice|disposable|pod|pods|nicotine|nicotia|tobacco|cigar|cigars|cigarillo|hookah|shisha|pouch|pouches)\b/i
// Shopify collections that are just merchandising, not shop sections.
const SKIP_COLLECTIONS = new Set(["frontpage", "all", "home-page"])
const BATCH = 25

function shopUrl(path: string) {
  const host = (process.env.SHOPIFY_STORE || "czmeq0-ik.myshopify.com").replace(/^https?:\/\//, "")
  return `https://${host}${path}`
}

async function getJson<T>(path: string): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    const res = await fetch(shopUrl(path), { headers: { accept: "application/json" } })
    if (res.ok) return (await res.json()) as T
    if (attempt >= 5 || (res.status !== 429 && res.status < 500)) {
      throw new Error(`GET ${path} -> ${res.status}`)
    }
    await new Promise((r) => setTimeout(r, 2000 * attempt))
  }
}

async function allPages<T>(path: string, key: string): Promise<T[]> {
  const out: T[] = []
  for (let page = 1; page < 200; page++) {
    const sep = path.includes("?") ? "&" : "?"
    const body = await getJson<Record<string, T[]>>(`${path}${sep}limit=250&page=${page}`)
    const rows = body[key] || []
    out.push(...rows)
    if (rows.length < 250) break
  }
  return out
}

const tagsOf = (p: ShopifyProduct) =>
  (Array.isArray(p.tags) ? p.tags : String(p.tags || "").split(","))
    .map((t) => t.trim())
    .filter(Boolean)

export default async function importShopify({ container }: ExecArgs) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER)
  const productService = container.resolve(Modules.PRODUCT)
  const salesChannelService = container.resolve(Modules.SALES_CHANNEL)

  // ---- read Shopify --------------------------------------------------------
  const products = await allPages<ShopifyProduct>("/products.json", "products")
  logger.info(`Shopify: ${products.length} published products`)
  if (!products.length) throw new Error("No products came back from Shopify")

  const collections = (
    await allPages<ShopifyCollection>("/collections.json", "collections")
  ).filter((c) => !SKIP_COLLECTIONS.has(c.handle))
  const membership = new Map<string, string[]>() // product handle -> collection handles
  for (const c of collections) {
    const rows = await allPages<ShopifyProduct>(`/collections/${c.handle}/products.json`, "products")
    for (const p of rows) {
      membership.set(p.handle, [...(membership.get(p.handle) || []), c.handle])
    }
  }
  logger.info(`Shopify: ${collections.length} collections`)

  // ---- sales channels: imported products go on both Web and Kiosk ----------
  const channels = await salesChannelService.listSalesChannels({ name: ["Web", "Kiosk"] })
  if (!channels.length) throw new Error("Run setup-store.ts first (no Web/Kiosk sales channels)")
  const salesChannels = channels.map((c) => ({ id: c.id }))

  // ---- categories from collections ----------------------------------------
  const categoryId = new Map<string, string>()
  for (const c of await productService.listProductCategories({}, { take: 1000 })) {
    categoryId.set(c.handle, c.id)
  }
  const newCats = collections.filter((c) => !categoryId.has(c.handle))
  if (newCats.length) {
    const { result } = await createProductCategoriesWorkflow(container).run({
      input: {
        product_categories: newCats.map((c) => ({
          name: c.title,
          handle: c.handle,
          is_active: true,
        })),
      },
    })
    for (const c of result) categoryId.set(c.handle, c.id)
    logger.info(`Created ${result.length} categories`)
  }

  // ---- types, brands (collections), tags -----------------------------------
  const typeId = new Map<string, string>()
  for (const t of await productService.listProductTypes({}, { take: 5000 })) typeId.set(t.value, t.id)
  const wantTypes = [...new Set(products.map((p) => p.product_type.trim()).filter(Boolean))]
  const missingTypes = wantTypes.filter((v) => !typeId.has(v))
  if (missingTypes.length) {
    for (const t of await productService.createProductTypes(missingTypes.map((value) => ({ value })))) {
      typeId.set(t.value, t.id)
    }
  }

  const brandId = new Map<string, string>()
  for (const c of await productService.listProductCollections({}, { take: 5000 })) brandId.set(c.title, c.id)
  const wantBrands = [...new Set(products.map((p) => p.vendor.trim()).filter(Boolean))]
  const missingBrands = wantBrands.filter((v) => !brandId.has(v))
  if (missingBrands.length) {
    const handles = new Set<string>()
    const rows = missingBrands.map((title) => {
      let handle = "brand-" + title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")
      while (handles.has(handle)) handle += "-x"
      handles.add(handle)
      return { title, handle }
    })
    for (const c of await productService.createProductCollections(rows)) brandId.set(c.title, c.id)
  }

  const tagId = new Map<string, string>()
  for (const t of await productService.listProductTags({}, { take: 20000 })) tagId.set(t.value, t.id)
  const wantTags = [...new Set(products.flatMap(tagsOf))]
  const missingTags = wantTags.filter((v) => !tagId.has(v))
  for (let i = 0; i < missingTags.length; i += 500) {
    const made = await productService.createProductTags(
      missingTags.slice(i, i + 500).map((value) => ({ value }))
    )
    for (const t of made) tagId.set(t.value, t.id)
  }
  logger.info(`Types ${typeId.size}, brands ${brandId.size}, tags ${tagId.size}`)

  // ---- products ------------------------------------------------------------
  const existing = new Set<string>()
  for (const p of await productService.listProducts({}, { select: ["handle"], take: 100000 })) {
    existing.add(p.handle)
  }
  const todo = products.filter((p) => !existing.has(p.handle))
  logger.info(`${existing.size} already in Medusa, importing ${todo.length}`)

  // SKUs must be unique across the whole catalog. Some makers reuse a SKU on
  // several listings; the first one keeps it, later ones go without.
  const usedSkus = new Set<string>()
  for (const v of await productService.listProductVariants({}, { select: ["sku"], take: 1000000 })) {
    if (v.sku) usedSkus.add(v.sku)
  }

  let made = 0
  let restricted = 0
  for (let i = 0; i < todo.length; i += BATCH) {
    const input = todo.slice(i, i + BATCH).map((p) => {
      const tags = tagsOf(p)
      const ageRestricted = AGE_RESTRICTED.test([p.title, p.product_type, tags.join(" ")].join(" "))
      if (ageRestricted) restricted++

      // Shopify's single-variant products carry a fake "Title / Default Title" option.
      const realOptions = p.options.filter(
        (o) => !(o.name === "Title" && o.values.length === 1 && o.values[0] === "Default Title")
      )
      const options = realOptions.length
        ? realOptions.map((o) => ({ title: o.name, values: [...new Set(o.values)] }))
        : [{ title: "Option", values: ["Standard"] }]

      const seenTitles = new Set<string>()
      const variants = p.variants.map((v, idx) => {
        const values = [v.option1, v.option2, v.option3]
        const opts: Record<string, string> = {}
        if (realOptions.length) {
          realOptions.forEach((o, j) => (opts[o.name] = String(values[j] ?? o.values[0])))
        } else {
          opts.Option = "Standard"
        }
        let title = realOptions.length ? v.title : p.title
        if (seenTitles.has(title)) title = `${title} (${idx + 1})`
        seenTitles.add(title)
        return {
          title,
          sku: v.sku?.trim() ? v.sku.trim() : undefined,
          options: opts,
          manage_inventory: false,
          allow_backorder: true,
          weight: v.grams || undefined,
          prices: [{ currency_code: "usd", amount: Number(v.price) }],
          metadata: {
            shopify_variant_id: v.id,
            ...(v.compare_at_price ? { compare_at_price: Number(v.compare_at_price) } : {}),
          },
        }
      })

      for (const v of variants) {
        if (!v.sku) continue
        if (usedSkus.has(v.sku)) v.sku = undefined
        else usedSkus.add(v.sku)
      }

      return {
        title: p.title,
        handle: p.handle,
        description: p.body_html || undefined,
        status: ProductStatus.PUBLISHED,
        thumbnail: p.images[0]?.src,
        images: p.images.map((im) => ({ url: im.src })),
        type_id: typeId.get(p.product_type.trim()),
        collection_id: brandId.get(p.vendor.trim()),
        tag_ids: tags.map((t) => tagId.get(t)!).filter(Boolean),
        category_ids: (membership.get(p.handle) || [])
          .map((h) => categoryId.get(h)!)
          .filter(Boolean),
        sales_channels: salesChannels,
        options,
        variants,
        metadata: {
          shopify_id: p.id,
          vendor: p.vendor,
          age_restricted: ageRestricted,
          special_order: tags.includes("special-order"),
        },
      }
    })

    try {
      await createProductsWorkflow(container).run({ input: { products: input } })
      made += input.length
    } catch (e) {
      // One bad product should not sink 24 good ones: retry the batch one by one.
      logger.warn(`Batch at ${i} failed (${(e as Error).message}); retrying singly`)
      for (const one of input) {
        try {
          await createProductsWorkflow(container).run({ input: { products: [one] } })
          made++
        } catch (err) {
          logger.error(`Skipped ${one.handle}: ${(err as Error).message}`)
        }
      }
    }
    logger.info(`Imported ${made}/${todo.length}`)
  }

  logger.info(
    `Done. ${made} products imported, ${restricted} flagged 21+ (age_restricted), ` +
      `${existing.size} were already there.`
  )
}
