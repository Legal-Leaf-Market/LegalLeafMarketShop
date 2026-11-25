import { NmiBilling } from "./nmi-client"

/**
 * Convert a Medusa billing address (as carried on the payment session `data`,
 * using Medusa's snake_case address keys) into the provider's NmiBilling shape.
 *
 * Returns undefined when the address is absent or lacks the fields AVS needs to
 * verify (name + street + city + state + zip). In that case the charge proceeds
 * without AVS fields rather than sending blanks — a safe no-op for that order.
 */
export function toNmiBilling(raw: unknown): NmiBilling | undefined {
  if (!raw || typeof raw !== "object") return undefined
  const a = raw as Record<string, unknown>

  const str = (v: unknown): string | undefined => {
    const s = typeof v === "string" ? v.trim() : undefined
    return s ? s : undefined
  }

  const firstName = str(a.first_name)
  const lastName = str(a.last_name)
  const address1 = str(a.address_1)
  const city = str(a.city)
  const state = str(a.province)
  const zip = str(a.postal_code)

  // Without these, AVS has nothing meaningful to verify.
  if (!firstName || !lastName || !address1 || !city || !state || !zip) {
    return undefined
  }

  const billing: NmiBilling = { firstName, lastName, address1, city, state, zip }

  const company = str(a.company)
  if (company) billing.company = company
  const address2 = str(a.address_2)
  if (address2) billing.address2 = address2
  const country = str(a.country_code)
  if (country) billing.country = country
  const email = str(a.email)
  if (email) billing.email = email
  const phone = str(a.phone)
  if (phone) billing.phone = phone

  return billing
}
