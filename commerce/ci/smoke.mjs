// End-to-end check against a running backend: catalog is there, a cart can be
// built, the 21+ gate refuses a vape order without a date of birth, and the
// same order goes through with one. Uses only the public store API.
//
//   MEDUSA_URL=http://localhost:9000 PUBLISHABLE_KEY=pk_... MIN_PRODUCTS=400 node ci/smoke.mjs
const base = process.env.MEDUSA_URL || "http://localhost:9000"
const key = process.env.PUBLISHABLE_KEY
const minProducts = Number(process.env.MIN_PRODUCTS || 1)
if (!key) throw new Error("PUBLISHABLE_KEY is required")

async function api(method, path, body) {
  const res = await fetch(base + path, {
    method,
    headers: { "content-type": "application/json", "x-publishable-api-key": key },
    body: body ? JSON.stringify(body) : undefined,
  })
  const json = await res.json().catch(() => ({}))
  return { status: res.status, json }
}
function must(cond, msg) {
  if (!cond) {
    console.error("FAIL:", msg)
    process.exit(1)
  }
  console.log("ok  ", msg)
}

const { json: list } = await api("GET", "/store/products?limit=1")
must(list.count >= minProducts, `catalog has ${list.count} products (need ${minProducts})`)

const { json: regions } = await api("GET", "/store/regions")
const region = regions.regions?.find((r) => r.currency_code === "usd")
must(region, "US region exists")

// Find a 21+ product.
let restricted = null
for (let offset = 0; offset < list.count && !restricted; offset += 100) {
  const { json } = await api(
    "GET",
    `/store/products?limit=100&offset=${offset}&region_id=${region.id}&fields=id,title,handle,metadata,*variants`
  )
  restricted = json.products.find((p) => p.metadata?.age_restricted && p.variants?.length)
}
must(restricted, `found a 21+ product: ${restricted?.title}`)

async function buildCart(metadata) {
  const { json: c } = await api("POST", "/store/carts", { region_id: region.id })
  const id = c.cart.id
  const add = await api("POST", `/store/carts/${id}/line-items`, {
    variant_id: restricted.variants[0].id,
    quantity: 1,
  })
  must(add.status === 200, `added to cart (${add.status} ${add.json.message || ""})`)
  const upd = await api("POST", `/store/carts/${id}`, {
    email: "ci@legalleafmarket.shop",
    shipping_address: {
      first_name: "CI", last_name: "Test", address_1: "1 Washington St",
      city: "Columbus", province: "IN", postal_code: "47201", country_code: "us",
    },
    ...(metadata ? { metadata } : {}),
  })
  must(upd.status === 200, `address set (${upd.status} ${upd.json.message || ""})`)
  const { json: opts } = await api("GET", `/store/shipping-options?cart_id=${id}`)
  must(opts.shipping_options?.length, "local delivery is offered for Columbus, IN")
  const ship = await api("POST", `/store/carts/${id}/shipping-methods`, {
    option_id: opts.shipping_options[0].id,
  })
  must(ship.status === 200, `delivery chosen (${ship.status} ${ship.json.message || ""})`)
  const { json: pc } = await api("POST", "/store/payment-collections", { cart_id: id })
  const sess = await api(
    "POST",
    `/store/payment-collections/${pc.payment_collection.id}/payment-sessions`,
    { provider_id: "pp_system_default" }
  )
  must(sess.status === 200, `payment session (${sess.status} ${sess.json.message || ""})`)
  return id
}

const noDob = await buildCart(null)
const refused = await api("POST", `/store/carts/${noDob}/complete`)
const refusedMsg = refused.json.message || refused.json.error?.message || ""
must(refused.json.type !== "order", `no date of birth -> refused (${refused.status}: ${refusedMsg})`)
must(/21/.test(refusedMsg), "refusal explains the 21+ rule")

const young = await buildCart({ dob: new Date(Date.now() - 18 * 365.25 * 864e5).toISOString().slice(0, 10) })
const youngRes = await api("POST", `/store/carts/${young}/complete`)
must(youngRes.json.type !== "order", "18-year-old -> refused")

const adult = await buildCart({ dob: "1990-05-01" })
const done = await api("POST", `/store/carts/${adult}/complete`)
must(done.json.type === "order", `adult -> order ${done.json.order?.display_id ?? ""} (${done.status} ${done.json.message || ""})`)

console.log("\nAll smoke checks passed.")
