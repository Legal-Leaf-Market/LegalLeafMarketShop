/**
 * Per-merchant NMI configuration for the unified provider (card + ACH + wallets).
 * NMI uses two distinct keys:
 *  - securityKey:     PRIVATE API key for the server-side Payment API (transact.php).
 *  - tokenizationKey: PUBLIC key, safe to send to the browser (NmiPayments component).
 *  - webhookSecret:   the signing key from Merchant Portal > Settings > Webhooks.
 *                     Only needed for ACH, which finishes through a webhook.
 */
export interface NmiOptions {
  /** Private API security key (transact.php `security_key`). */
  securityKey: string
  /** Public tokenization key (sent to the storefront NmiPayments component). */
  tokenizationKey: string
  /**
   * Webhook signing key (HMAC-SHA256). Required for ACH: without it bank payments
   * are refused and every inbound webhook is ignored. Card and wallet payments do
   * not use webhooks, so a card-only store can leave it unset.
   */
  webhookSecret?: string
  /** Card/wallet capture model: "auth" then capture later, or "sale" (auth+capture). Default "auth". */
  captureMethod?: "auth" | "sale"
  /** ACH `sec_code`. Default "WEB" (internet-initiated consumer debit). */
  secCode?: "PPD" | "CCD" | "WEB" | "TEL"
  /** Use the NMI sandbox host. */
  sandbox?: boolean
  /** Abort a Payment API request after this many milliseconds. Default 60000. */
  timeoutMs?: number
}

/** Payment API (Direct Post) hosts. */
export const TRANSACT_HOSTS = {
  prod: "https://secure.nmi.com",
  sandbox: "https://sandbox.nmi.com",
} as const

/** transact.php `response` field. */
export type NmiResponseCode = "1" | "2" | "3" // 1 approved, 2 declined, 3 error
