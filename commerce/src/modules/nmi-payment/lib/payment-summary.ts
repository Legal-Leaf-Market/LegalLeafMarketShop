/**
 * Turns the `data` this provider leaves on a Medusa payment into something a
 * person can read. Used by the order-details admin widget, and exported so a
 * store can show the same summary elsewhere (emails, a custom admin page).
 *
 * Pure functions with no Node or React imports: this file is bundled into the
 * admin extension as well as the server build.
 */

/** The parts of a Medusa payment this summary reads. */
export interface PaymentLike {
  id?: string
  provider_id?: string
  amount?: unknown
  currency_code?: string
  captured_at?: string | Date | null
  canceled_at?: string | Date | null
  data?: Record<string, unknown> | null
  refunds?: { amount?: unknown }[] | null
}

export type NmiPaymentState =
  /** Charged, nothing reversed. */
  | "charged"
  /** Authorized on a card, not captured yet. */
  | "authorized"
  /** ACH debit submitted, settlement not confirmed yet. */
  | "ach_pending"
  /** ACH debit confirmed settled by NMI's webhook. */
  | "ach_settled"
  /** Reversed by void before settlement: no charge will ever appear. */
  | "voided"
  /** Cancelled in Medusa but the void was refused by NMI. Needs a person. */
  | "void_failed"
  /** Part of the charge has been refunded. */
  | "partially_refunded"
  /** The whole charge has been refunded as a refund transaction. */
  | "refunded"
  /** No NMI transaction on this payment. */
  | "none"

export type Tone = "green" | "orange" | "red" | "grey" | "blue"

export interface NmiPaymentSummary {
  state: NmiPaymentState
  /** Short label for a badge, e.g. "Voided". */
  label: string
  tone: Tone
  /** One sentence saying what this means for the buyer's statement. */
  detail: string
  method: "card" | "ach"
  /** e.g. "Visa ending 1111", when the storefront recorded it. */
  card?: string
  transactionId?: string
  authCode?: string
  /** The refund transaction id, when the last reversal was a refund. */
  refundId?: string
  avs?: { code: string; text: string; tone: Tone }
  cvv?: { code: string; text: string; tone: Tone }
  /** True when the charge was confirmed through the Query API after a lost response. */
  recovered: boolean
  refundedAmount: number
  amount: number
}

/** True for payments made through any variant of this provider. */
export function isNmiPayment(payment: PaymentLike | null | undefined): boolean {
  return typeof payment?.provider_id === "string" && payment.provider_id.startsWith("pp_nmi")
}

const num = (v: unknown): number => {
  if (typeof v === "number") return v
  if (typeof v === "string") return Number(v)
  if (v && typeof v === "object") {
    const o = v as { numeric?: unknown; value?: unknown }
    if (typeof o.numeric === "number") return o.numeric
    if (o.value != null) return Number(o.value)
  }
  return NaN
}

const str = (v: unknown): string | undefined => {
  if (typeof v === "string" && v.trim()) return v.trim()
  if (typeof v === "number") return String(v)
  return undefined
}

/**
 * NMI's AVS response codes in plain words.
 * See https://docs.nmi.com/reference/response-codes ("AVS Response Codes").
 */
export function describeAvs(code: unknown): { code: string; text: string; tone: Tone } | undefined {
  const c = str(code)?.toUpperCase()
  if (!c) return undefined
  const is = (set: string) => set.includes(c)
  if (is("XYDM26")) return { code: c, text: "Street address and ZIP match", tone: "green" }
  if (is("AB37")) return { code: c, text: "Street address matches, ZIP does not", tone: "orange" }
  if (is("WZPL15")) return { code: c, text: "ZIP matches, street address does not", tone: "orange" }
  if (is("NC48")) return { code: c, text: "Neither street address nor ZIP matches", tone: "red" }
  if (is("U")) return { code: c, text: "Address information unavailable from the issuer", tone: "grey" }
  if (is("GI")) return { code: c, text: "Issuer outside the US does not verify addresses", tone: "grey" }
  if (is("R")) return { code: c, text: "Issuer's address check was unavailable", tone: "grey" }
  if (is("E")) return { code: c, text: "Not eligible for address verification", tone: "grey" }
  if (is("S")) return { code: c, text: "Issuer does not support address verification", tone: "grey" }
  if (is("0O")) return { code: c, text: "Address verification not available", tone: "grey" }
  return { code: c, text: `Address check returned code ${c}`, tone: "grey" }
}

/** NMI's CVV response codes in plain words. */
export function describeCvv(code: unknown): { code: string; text: string; tone: Tone } | undefined {
  const c = str(code)?.toUpperCase()
  if (!c) return undefined
  switch (c) {
    case "M": return { code: c, text: "Security code matches", tone: "green" }
    case "N": return { code: c, text: "Security code does not match", tone: "red" }
    case "P": return { code: c, text: "Security code was not checked", tone: "grey" }
    case "S": return { code: c, text: "Card should have a security code but none was given", tone: "orange" }
    case "U": return { code: c, text: "Issuer could not check the security code", tone: "grey" }
    default: return { code: c, text: `Security code check returned code ${c}`, tone: "grey" }
  }
}

function describeCard(data: Record<string, unknown>): string | undefined {
  const type = str(data.card_type)
  const last4 = str(data.card_last4)
  if (!type && !last4) return undefined
  const brand = type ? type.charAt(0).toUpperCase() + type.slice(1) : "Card"
  return last4 ? `${brand} ending ${last4}` : brand
}

/**
 * Summarise one payment. The point of the `voided` state: Medusa's admin only
 * offers Refund on a captured payment, and this provider turns a same-day full
 * refund into a void. Medusa then shows the amount as "refunded", which is right
 * for the totals but hides that no charge will ever settle.
 */
export function summarizeNmiPayment(payment: PaymentLike): NmiPaymentSummary {
  const data = (payment.data ?? {}) as Record<string, unknown>
  const method: "card" | "ach" = data.payment_method === "ach" ? "ach" : "card"
  const transactionId = str(data.transactionid)
  const amount = num(payment.amount ?? data.amount)
  const refundedAmount = (payment.refunds ?? []).reduce((sum, r) => {
    const a = num(r?.amount)
    return Number.isFinite(a) ? sum + a : sum
  }, 0)
  const raw = (data.raw ?? {}) as Record<string, unknown>

  const base = {
    method,
    card: method === "card" ? describeCard(data) : undefined,
    transactionId,
    authCode: str(data.authcode),
    avs: describeAvs(data.avs_response),
    cvv: method === "card" ? describeCvv(data.cvv_response) : undefined,
    recovered: raw.recovered === "query",
    refundedAmount,
    amount,
  }
  const what = method === "ach" ? "bank debit" : "charge"

  if (!transactionId) {
    return {
      ...base, state: "none", label: "No transaction", tone: "grey",
      detail: "Nothing was sent to NMI for this payment.",
    }
  }
  if (data.void_failed) {
    return {
      ...base, state: "void_failed", label: "Void failed", tone: "red",
      detail:
        `The payment was cancelled in Medusa but NMI refused to void the ${what}` +
        (str(data.void_error) ? ` (${str(data.void_error)})` : "") +
        ". Check the transaction in the NMI portal.",
    }
  }
  if (data.voided || data.canceled || data.already_voided) {
    return {
      ...base, state: "voided", label: "Voided", tone: "orange",
      detail: data.voided
        ? `Refunded in full before settlement, so NMI voided the ${what} instead. ` +
          `Nothing will settle and the buyer will not see a charge followed by a credit; ` +
          `a pending authorization may show on their statement until their bank releases it.`
        : `The ${what} was voided before settlement. Nothing will settle.`,
    }
  }
  const refundId = str(data.refundId)
  if (refundedAmount > 0 || refundId) {
    const full = Number.isFinite(amount) && refundedAmount >= amount - 0.005
    return {
      ...base, refundId,
      state: full ? "refunded" : "partially_refunded",
      label: full ? "Refunded" : "Partially refunded",
      tone: full ? "grey" : "blue",
      // Whether the charge had settled is not knowable from payment.data, so
      // say how it was reversed, not when.
      detail: full
        ? `Refunded in full through NMI as a refund, not a void. The buyer sees the ${what} and a separate credit.`
        : `Part of the ${what} was refunded through NMI. The buyer sees the original ${what} and a separate credit for each refund.`,
    }
  }
  if (method === "ach") {
    return payment.captured_at
      ? {
          ...base, state: "ach_settled", label: "Settled", tone: "green",
          detail: "The bank debit settled. An ACH debit can still be returned by the buyer's bank for up to 60 days.",
        }
      : {
          ...base, state: "ach_pending", label: "Awaiting settlement", tone: "orange",
          detail: "The bank debit was submitted. No money has moved yet; NMI reports settlement or a return in a few business days.",
        }
  }
  return payment.captured_at
    ? {
        ...base, state: "charged", label: "Charged", tone: "green",
        detail: "The card was charged.",
      }
    : {
        ...base, state: "authorized", label: "Authorized", tone: "blue",
        detail: "The amount is held on the card but not captured. Capture it before the authorization expires.",
      }
}
