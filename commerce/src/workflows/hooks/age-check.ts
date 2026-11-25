import { completeCartWorkflow } from "@medusajs/medusa/core-flows"
import { ContainerRegistrationKeys, MedusaError } from "@medusajs/framework/utils"

/**
 * 21+ gate at checkout, enforced on the server so a page edit cannot skip it.
 *
 * If any item in the cart is age_restricted (set by import-shopify.ts for vape,
 * nicotine and tobacco items), the order is refused unless:
 *   - the storefront saved the buyer's date of birth on the cart
 *     (cart.metadata.dob = "YYYY-MM-DD") and it makes them 21 or older, and
 *   - the order is delivered in Indiana, by hand, where ID is checked at the
 *     door. No shipping of these items (PACT Act).
 *
 * The typed date of birth is a first filter, not proof of age. The door check
 * is the real one, and the driver must refuse the hand-over without a valid ID.
 */
export function ageOn(dob: string, today = new Date()): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dob || "")
  if (!m) return null
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])]
  let age = today.getUTCFullYear() - y
  const beforeBirthday =
    today.getUTCMonth() + 1 < mo || (today.getUTCMonth() + 1 === mo && today.getUTCDate() < d)
  if (beforeBirthday) age--
  return age
}

completeCartWorkflow.hooks.validate(async ({ cart }, { container }) => {
  const query = container.resolve(ContainerRegistrationKeys.QUERY)
  const { data } = await query.graph({
    entity: "cart",
    fields: [
      "id",
      "metadata",
      "shipping_address.province",
      "shipping_address.country_code",
      "items.product.metadata",
      "items.product.title",
    ],
    filters: { id: cart.id },
  })
  const full = data[0]
  if (!full) return

  const restricted = (full.items || []).filter(
    (i: any) => i?.product?.metadata?.age_restricted === true
  )
  if (!restricted.length) return

  const age = ageOn(String(full.metadata?.dob || ""))
  if (age === null || age < 21) {
    throw new MedusaError(
      MedusaError.Types.NOT_ALLOWED,
      "You must be 21 or older to buy vaping, nicotine and tobacco products. " +
        "Please enter your date of birth at checkout."
    )
  }

  const province = String(full.shipping_address?.province || "").toLowerCase()
  const country = String(full.shipping_address?.country_code || "").toLowerCase()
  if (country !== "us" || !["in", "us-in", "indiana"].includes(province)) {
    throw new MedusaError(
      MedusaError.Types.NOT_ALLOWED,
      "Vaping, nicotine and tobacco products are hand-delivered in Indiana only, " +
        "with a 21+ ID check at the door."
    )
  }
})
