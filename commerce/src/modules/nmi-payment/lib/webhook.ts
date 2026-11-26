import { createHmac, timingSafeEqual } from "crypto"

/** Parse `Webhook-Signature: t=<nonce>,s=<sig>`. */
export function parseSignatureHeader(
  header: string | undefined
): { nonce: string; signature: string } | null {
  if (!header || typeof header !== "string") return null
  let nonce = "", signature = ""
  for (const part of header.split(",")) {
    const eq = part.indexOf("=")
    if (eq < 0) continue
    const k = part.slice(0, eq).trim()
    const v = part.slice(eq + 1).trim()
    if (k === "t") nonce = v
    if (k === "s") signature = v
  }
  if (!nonce || !signature) return null
  return { nonce, signature }
}

/**
 * Verify HMAC-SHA256(nonce + "." + rawBody, secret) against the header signature.
 * This is the scheme in NMI's own sample (docs.nmi.com/reference/overview, "How to
 * Validate"): `hash_hmac("sha256", $nonce . "." . $webhookBody, $signingKey)`,
 * hex encoded. A missing secret never verifies: an unsigned or unverifiable
 * webhook must not be able to move a payment.
 */
export function verifySignature(
  secret: string | undefined,
  rawBody: string,
  header: string | undefined
): boolean {
  if (!secret || typeof secret !== "string") return false
  const parsed = parseSignatureHeader(header)
  if (!parsed) return false
  const expected = createHmac("sha256", secret)
    .update(`${parsed.nonce}.${rawBody}`)
    .digest("hex")
  if (expected.length !== parsed.signature.length) return false
  return timingSafeEqual(Buffer.from(expected), Buffer.from(parsed.signature))
}

/**
 * Recover the Medusa payment session id we stamped on the transaction.
 * We send it as both `orderid` and `merchant_defined_field_1`, so read either.
 */
export function extractSessionId(eventBody: Record<string, any>): string {
  // `||`, not `??`: NMI sends `order_id: ""` on events that have none.
  const id =
    eventBody.order_id ||
    eventBody.order?.order_id ||
    eventBody.merchant_defined_field_1 ||
    eventBody.merchant_defined_fields?.["1"] ||
    ""
  return typeof id === "string" ? id : String(id)
}

/**
 * True when the id is a Medusa payment session id. An NMI account can be shared
 * with other systems whose order ids mean nothing here; handing one of those to
 * Medusa's payment workflow makes it fail and retry for no reason.
 */
export function isMedusaSessionId(id: string): boolean {
  return id.startsWith("payses_")
}

/** Medusa payment action returned from getWebhookActionAndData. */
export type NmiAction = "authorized" | "captured" | "canceled" | "failed"

/**
 * The real ACH lifecycle, which Medusa's card-shaped payment status cannot express.
 * `settled` is not final: an unauthorized return can arrive up to 60 days later, and a
 * late return after that. Medusa records `settled` as `captured` and has no state at all
 * for the returns, so anything that depends on an ACH debit actually sticking has to read
 * this rather than the payment status.
 */
export type AchState = "settled" | "returned" | "late_returned"

/**
 * Classify an NMI event as an ACH lifecycle transition, or null if it is not one.
 * Exported so a `payment.webhook_received` subscriber can react to returns, which
 * Medusa core drops before the payment workflow runs.
 */
export function classifyAchEvent(eventType: string): AchState | null {
  switch (eventType) {
    case "transaction.check.status.settle": return "settled"
    case "transaction.check.status.return": return "returned"
    case "transaction.check.status.latereturn": return "late_returned"
    default: return null
  }
}

/**
 * Map an NMI webhook event to a Medusa action, or null to ignore it.
 *
 * Only the ACH outcomes are mapped, because ACH is the only payment that finishes
 * after the request that started it:
 *
 *  - `transaction.check.status.settle` captures the payment.
 *  - `transaction.check.status.return` / `.latereturn` and an ACH
 *    `transaction.sale.failure` report `failed`. Medusa core drops `failed` before
 *    the payment workflow runs, so a `payment.webhook_received` subscriber has to
 *    act on those (see `classifyAchEvent`).
 *
 * Every other transaction event is ignored on purpose. Card and wallet payments,
 * and the ACH submission itself, are decided inside the request that made them,
 * so Medusa already has the outcome when the event arrives and the event can only
 * race it:
 *
 *  - `sale.success` / `auth.success` / `capture.success` reach Medusa's payment
 *    workflow about five seconds after the charge. If the payment row is not
 *    there yet the workflow authorizes the session a second time; if the cart
 *    failed to complete and the charge was voided, it tries to complete the cart
 *    again against the voided payment.
 *  - `refund.success` carries a negative amount and usually no order id. Mapping
 *    it to `captured` never recorded a refund in Medusa; it could only ask for a
 *    capture of a negative amount.
 *  - `void.success` maps to `canceled`, which core discards.
 *  - `settlement.batch.complete` is a batch total with no order id.
 *
 * A refund or void made in the NMI portal is therefore not reflected in Medusa.
 * Make them from Medusa.
 *
 * See https://docs.nmi.com/reference/check-status
 */
export function mapNmiEvent(
  eventType: string,
  eventBody: Record<string, any>
): NmiAction | null {
  const ach = !!eventBody.check
  switch (eventType) {
    // ACH settlement outcomes, days after the debit was accepted.
    case "transaction.check.status.settle": return "captured"
    case "transaction.check.status.return": return "failed"
    case "transaction.check.status.latereturn": return "failed"
    // An ACH debit rejected at submission. Informational: the request that
    // submitted it already failed.
    case "transaction.sale.failure": return ach ? "failed" : null
    default: return null
  }
}
