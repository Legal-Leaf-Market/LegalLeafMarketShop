/**
 * NMI transact.php returns a flat set of fields. We classify the outcome:
 *   response: "1" approved | "2" declined | "3" error
 *   response_code: numeric reason (100 = approved; 2xx = issuer decline;
 *   3xx = gateway reject; 4xx = processor/communication).
 * See https://docs.nmi.com/reference/response-codes
 */
export interface NmiTransactResult {
  response: string
  responsetext?: string
  response_code?: string
  transactionid?: string
  authcode?: string
  [k: string]: string | undefined
}

export class NmiError extends Error {
  constructor(
    message: string,
    readonly response: string,
    readonly responseCode?: string,
    readonly raw?: NmiTransactResult,
    /**
     * True when we could not establish whether NMI processed the request: the
     * response was lost and the transaction could not be looked up. The money may
     * or may not have moved. Never treat this as "it failed" — do not re-send, and
     * do not tell a buyer they were not charged.
     */
    readonly outcomeUnknown: boolean = false
  ) {
    super(message)
    this.name = "NmiError"
  }
}

/**
 * Communication failures: NMI received the request but could not tell us how it
 * ended (420 "Communication error", 421 "Communication error with issuer"). The
 * outcome is ambiguous, so the client resolves it through the Query API instead
 * of re-sending.
 *
 * 430 (duplicate at processor), 440 (processor format error) and 441 (invalid
 * transaction information) used to be in this set. They are definitive: the same
 * request cannot succeed on a second try.
 */
const AMBIGUOUS = new Set(["420", "421"])

export function isAmbiguousCode(code?: string): boolean {
  return code ? AMBIGUOUS.has(code) : false
}

/** @deprecated Renamed: these codes are ambiguous, not safely retryable. Use isAmbiguousCode. */
export const isRetryableCode = isAmbiguousCode

/**
 * response_code 301 (and HTTP 429) is NMI's rate limit. NMI: "do not immediately
 * retry the request" — retrying extends the lockout. A rate-limited request was
 * rejected before processing, so it is a definitive failure.
 */
export function isRateLimitCode(code?: string): boolean {
  return code === "301"
}

/** Throw if NMI did not approve (response !== "1"). */
export function assertApproved(r: NmiTransactResult): void {
  if (r.response !== "1") {
    throw new NmiError(
      `NMI transaction ${r.response === "2" ? "declined" : "error"}: ${r.responsetext ?? "unknown"}`,
      r.response,
      r.response_code,
      r
    )
  }
}

/**
 * A message that is safe to show the buyer for a failed charge. It never repeats
 * gateway text: issuer responses can say "pick up card", "lost", "stolen" or
 * "suspected fraud", none of which should be put in front of the person holding
 * the card. The full gateway detail belongs in the server log.
 */
export function buyerMessageFor(error: unknown, method: "card" | "ach" = "card"): string {
  if (!(error instanceof NmiError)) {
    return "We could not process your payment. Please try again."
  }
  if (error.outcomeUnknown) {
    return "We could not confirm whether your payment went through. Please do not try again yet. Contact us and we will check for you."
  }
  if (isRateLimitCode(error.responseCode)) {
    return "We could not process your payment right now. Please wait a minute and try again."
  }
  if (/duplicate/i.test(error.raw?.responsetext ?? "")) {
    // NMI's duplicate check matches on card and amount inside a window set in the
    // portal, so it also catches a deliberate second order. Say what will work.
    return "This looks like a repeat of a payment made a few minutes ago with the same card and amount. If you meant to place another order, please wait a few minutes and try again, or contact us."
  }
  // 300 = "rejected by gateway". That covers the AVS and CVV rules set in the
  // portal, which the buyer can fix, and also things they cannot (a bad API key
  // answers 300 "Authentication Failed"). Only blame the card details when the
  // gateway text says that is what it was.
  const gatewayRuleReject =
    error.responseCode === "300" &&
    /avs|cvv|cvc|csc|address|zip|postal|security code/i.test(error.raw?.responsetext ?? "")
  // response "3" = error in the request or at the gateway/processor. Not the
  // buyer's fault and not something they can fix by editing their card.
  if ((error.response !== "2" || error.responseCode === "300") && !gatewayRuleReject) {
    return "We could not process your payment. Please try again in a moment."
  }
  if (method === "ach") {
    return "Your bank payment was not accepted. Please check your account details or use another payment method."
  }
  switch (error.responseCode) {
    case "202":
      return "Your card was declined for insufficient funds. Please use a different card."
    case "203":
      return "Your card was declined because it is over its limit. Please use a different card."
    case "220":
    case "221":
    case "222":
      return "Your card number could not be verified. Please check it and try again."
    case "223":
    case "224":
      return "Your card has expired or the expiration date is incorrect. Please check it and try again."
    case "225":
      return "The security code (CVV) is incorrect. Please check it and try again."
    case "300":
      return "Your payment was not approved. Please check your card details and billing address, or use a different card."
    default:
      return "Your card was declined. Please use a different card or contact your bank."
  }
}
