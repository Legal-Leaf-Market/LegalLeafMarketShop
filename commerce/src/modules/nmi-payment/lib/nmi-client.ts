import { TRANSACT_HOSTS } from "../types"
import {
  assertApproved,
  isAmbiguousCode,
  NmiError,
  NmiTransactResult,
} from "./errors"

/**
 * Cardholder billing address for AVS. Sent on sale/auth so NMI's
 * (portal-configured) AVS rules can verify it against the issuer on file.
 * Required fields mirror NMI's AVS inputs; optional fields are only emitted
 * when present.
 */
export interface NmiBilling {
  firstName: string
  lastName: string
  company?: string
  address1: string
  address2?: string
  city: string
  state: string
  zip: string
  /** 2-char country code; normalized to upper case (e.g. "us" -> "US"). */
  country?: string
  email?: string
  phone?: string
}

export interface ChargeParamsInput {
  securityKey: string
  type: "sale" | "auth" | "capture" | "refund" | "void"
  amount?: number
  paymentToken?: string
  transactionId?: string
  sessionId?: string
  /**
   * Marks the transaction as ACH/eCheck (`payment=check`). Required on the sale,
   * and also on a void or refund of an ACH transaction: transact.php defaults
   * `payment` to creditcard for those too. Pass `{}` for a void or refund.
   */
  ach?: {
    secCode?: "PPD" | "CCD" | "WEB" | "TEL"
    accountType?: "checking" | "savings"
    accountHolderType?: "personal" | "business"
  }
  /** Cardholder billing address for AVS (sale/auth only). */
  billing?: NmiBilling
  /** Buyer IP address (sale/auth only). NMI recommends it for fraud screening. */
  ipAddress?: string
  /** Free-text order description shown in the NMI portal (sale/auth only). */
  orderDescription?: string
}

/** Parse NMI's URL-encoded transact.php response into a flat object. */
export function parseTransactResponse(text: string): NmiTransactResult {
  const params = new URLSearchParams(text)
  const out: NmiTransactResult = { response: params.get("response") ?? "3" }
  for (const [k, v] of params.entries()) out[k] = v
  return out
}

/** Build the form body for a transact.php request. Amount is dollars x.xx. */
export function buildChargeParams(input: ChargeParamsInput): URLSearchParams {
  const p = new URLSearchParams()
  p.set("security_key", input.securityKey)
  p.set("type", input.type)
  if (input.amount != null) p.set("amount", input.amount.toFixed(2))
  if (input.paymentToken) p.set("payment_token", input.paymentToken)
  if (input.transactionId) p.set("transactionid", input.transactionId)
  if (input.sessionId) {
    p.set("orderid", input.sessionId)
    p.set("merchant_defined_field_1", input.sessionId)
  }
  if (input.ach) {
    // transact.php defaults `payment` to creditcard; without this the gateway
    // resolves the token in the card token space and rejects ACH tokens with
    // "Payment Token does not exist". The same default applies to a void or
    // refund of an ACH transaction.
    p.set("payment", "check")
    if (input.ach.secCode) p.set("sec_code", input.ach.secCode)
    if (input.ach.accountType) p.set("account_type", input.ach.accountType)
    if (input.ach.accountHolderType) p.set("account_holder_type", input.ach.accountHolderType)
  }
  if (input.billing) {
    const b = input.billing
    const set = (key: string, value?: string) => {
      const v = value?.trim()
      if (v) p.set(key, v)
    }
    set("firstname", b.firstName)
    set("lastname", b.lastName)
    set("company", b.company)
    set("address1", b.address1)
    set("address2", b.address2)
    set("city", b.city)
    set("state", b.state)
    set("zip", b.zip)
    set("country", b.country?.toUpperCase())
    set("email", b.email)
    set("phone", b.phone)
  }
  if (input.ipAddress) p.set("ipaddress", input.ipAddress)
  if (input.orderDescription) {
    p.set("order_description", input.orderDescription.slice(0, 255))
  }
  return p
}

/** One `<action>` of a Query API transaction (sale, auth, capture, void, settle, ...). */
export interface NmiQueryAction {
  action_type?: string
  amount?: string
  success?: string
  response_text?: string
  response_code?: string
  [k: string]: string | undefined
}

/** One `<transaction>` of a Query API response. */
export interface NmiQueryTransaction {
  transaction_id?: string
  order_id?: string
  /** pending | pendingsettlement | in_progress | abandoned | failed | canceled | complete | unknown */
  condition?: string
  transaction_type?: string
  authorization_code?: string
  avs_response?: string
  csc_response?: string
  actions: NmiQueryAction[]
  [k: string]: string | NmiQueryAction[] | undefined
}

const unescapeXml = (s: string) =>
  s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&")

function leafFields(xml: string): Record<string, string> {
  const out: Record<string, string> = {}
  const re = /<([a-zA-Z0-9_]+)>([^<]*)<\/\1>/g
  let m: RegExpExecArray | null
  while ((m = re.exec(xml))) {
    // First occurrence wins: transaction-level fields come before nested blocks.
    if (!(m[1] in out)) out[m[1]] = unescapeXml(m[2].trim())
  }
  return out
}

/**
 * Parse a Query API (query.php) XML response. Returns null when the body is not a
 * Query response at all (an HTML error page, an empty body). `error` is set when
 * NMI refused the query, e.g. a key without Query permission.
 * See https://docs.nmi.com/reference/query
 */
export function parseQueryResponse(
  xml: string
): { error?: string; transactions: NmiQueryTransaction[] } | null {
  if (!/<nm_response[\s/>]/.test(xml)) return null
  const err = /<error_response>([\s\S]*?)<\/error_response>/.exec(xml)
  if (err) return { error: unescapeXml(err[1].trim()), transactions: [] }
  const transactions: NmiQueryTransaction[] = []
  const txnRe = /<transaction>([\s\S]*?)<\/transaction>/g
  let t: RegExpExecArray | null
  while ((t = txnRe.exec(xml))) {
    const actions: NmiQueryAction[] = []
    const rest = t[1].replace(/<action>([\s\S]*?)<\/action>/g, (_all, inner: string) => {
      actions.push(leafFields(inner))
      return ""
    })
    transactions.push({ ...leafFields(rest), actions })
  }
  return { transactions }
}

export type NmiLogger = {
  warn: (msg: string) => void
  error: (msg: string) => void
}

export interface NmiClientOptions {
  /** Abort a transact.php request after this long. Default 60s. */
  timeoutMs?: number
  /** Abort a query.php lookup after this long. Default 15s. */
  queryTimeoutMs?: number
  logger?: NmiLogger
  /** Test seam: replaces the real backoff/poll delay. */
  sleep?: (ms: number) => Promise<void>
}

type Attempt =
  /** NMI answered. Approved, declined or errored, but definitive. */
  | { kind: "result"; result: NmiTransactResult }
  /** The connection was never established, so NMI cannot have seen the request. */
  | { kind: "not_sent"; detail: string }
  /** The request may have been processed; we do not know how it ended. */
  | { kind: "ambiguous"; detail: string; result?: NmiTransactResult }

type Resolution =
  | { kind: "approved"; result: NmiTransactResult }
  | { kind: "failed"; detail: string; result?: NmiTransactResult }
  /** The lookup worked and shows the request did not take effect. */
  | { kind: "absent" }
  /** The lookup worked but the transaction is in a state we cannot interpret. */
  | { kind: "unknown"; detail: string }
  /** The lookup itself could not be made (no Query permission, network, rate limit). */
  | { kind: "unavailable"; detail: string }

// Node/undici error codes raised before a request leaves the machine.
const NOT_SENT_CODES = new Set([
  "ENOTFOUND",
  "EAI_AGAIN",
  "ECONNREFUSED",
  "UND_ERR_CONNECT_TIMEOUT",
])

function errorCode(e: unknown): string | undefined {
  const cause = (e as { cause?: { code?: unknown } } | undefined)?.cause
  const code = cause?.code ?? (e as { code?: unknown } | undefined)?.code
  // DOMException (timeouts, aborts) carries a legacy numeric code; only the
  // string codes from Node's network stack mean anything here.
  return typeof code === "string" ? code : undefined
}

/** Conditions in which the money is held or has moved. */
const LIVE_CONDITIONS = new Set(["pending", "pendingsettlement", "complete"])

const MAX_ATTEMPTS = 3
const LOOKUP_DELAYS_MS = [0, 1500, 3000]

/**
 * Client over NMI's Payment API (transact.php) and Query API (query.php).
 *
 * The rule this class exists to enforce: a request whose response was lost is not
 * a failed request. NMI has no idempotency key, so when a response does not come
 * back (timeout, dropped connection, HTTP 5xx, response_code 420/421) the client
 * looks the transaction up before deciding anything:
 *
 *  - sale/auth: looked up by the `orderid` we sent (the Medusa payment session
 *    id). An approved transaction is returned as the result. None found means it
 *    was not processed. The sale is only re-sent when the Query API is not
 *    available at all, which is safe because the payment token is single-use: a
 *    second submission can never produce a second charge.
 *  - capture/void: looked up by transaction id. If the transaction is already in
 *    the target state the call succeeded; otherwise it is retried.
 *  - refund: never retried and never looked up. A refund creates a new
 *    transaction with no key of ours on it, so a lost response is reported as an
 *    unknown outcome for a person to check.
 *
 * A rate limit (HTTP 429, response_code 301) and every other definitive answer
 * is returned as is and never retried.
 */
export class NmiClient {
  private readonly base: string
  private readonly queryUrl: string
  private readonly timeoutMs: number
  private readonly queryTimeoutMs: number
  private readonly logger: NmiLogger
  private readonly sleep: (ms: number) => Promise<void>
  private warnedQueryUnavailable = false

  constructor(
    private readonly securityKey: string,
    sandbox?: boolean,
    options: NmiClientOptions = {}
  ) {
    const host = sandbox ? TRANSACT_HOSTS.sandbox : TRANSACT_HOSTS.prod
    this.base = host + "/api/transact.php"
    this.queryUrl = host + "/api/query.php"
    this.timeoutMs = options.timeoutMs ?? 60_000
    this.queryTimeoutMs = options.queryTimeoutMs ?? 15_000
    this.logger = options.logger ?? console
    this.sleep = options.sleep ?? delay
  }

  /** Run a transaction; throws NmiError unless approved. */
  async transact(input: Omit<ChargeParamsInput, "securityKey">): Promise<NmiTransactResult> {
    const params = buildChargeParams({ ...input, securityKey: this.securityKey })
    const isCharge = input.type === "sale" || input.type === "auth"
    const ref = input.sessionId ?? input.transactionId ?? "?"
    let sawAmbiguous = false
    let lastDetail = "no attempt made"

    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
      if (attempt > 0) await this.sleep(2 ** (attempt - 1) * 500)
      const outcome = await this.postOnce(params)

      if (outcome.kind === "result") {
        // Only reachable after an ambiguous charge when the Query API was not
        // available and the single-use token was re-sent. A gateway error on that
        // re-send most likely means the first submission consumed the token,
        // which means the first submission was processed.
        if (sawAmbiguous && isCharge && outcome.result.response === "3") {
          throw this.unknownOutcome(
            input.type,
            ref,
            `re-send was rejected (${outcome.result.responsetext ?? "no text"}) after ${lastDetail}`,
            outcome.result
          )
        }
        assertApproved(outcome.result)
        return outcome.result
      }

      lastDetail = outcome.detail
      if (outcome.kind === "not_sent") continue // NMI never saw it: safe to retry anything.

      sawAmbiguous = true
      this.logger.warn(
        `[nmi] ${input.type} ${ref}: no definitive response (${outcome.detail})`
      )

      // A lost refund response cannot be resolved or retried safely.
      if (input.type === "refund") break

      const resolved = await this.resolve(input)
      if (resolved.kind === "approved") {
        this.logger.warn(
          `[nmi] ${input.type} ${ref}: confirmed through the Query API as transaction ${resolved.result.transactionid}`
        )
        return resolved.result
      }
      if (resolved.kind === "failed") {
        throw new NmiError(
          `NMI transaction error: ${resolved.detail}`,
          resolved.result?.response ?? "3",
          resolved.result?.response_code ?? outcome.result?.response_code,
          resolved.result ?? outcome.result
        )
      }
      if (resolved.kind === "unknown") {
        throw this.unknownOutcome(input.type, ref, resolved.detail, outcome.result)
      }
      if (resolved.kind === "absent" && isCharge) {
        // Confirmed not processed. Fail cleanly; the buyer can try again.
        throw new NmiError(
          `NMI transaction error: no response from NMI (${outcome.detail}) and no transaction exists for ${ref}`,
          "3",
          outcome.result?.response_code,
          outcome.result
        )
      }
      if (resolved.kind === "unavailable" && !this.warnedQueryUnavailable) {
        this.warnedQueryUnavailable = true
        this.logger.error(
          `[nmi] The Query API lookup failed (${resolved.detail}). Lost responses cannot be ` +
            `reconciled automatically without it. Check that the security key has the Query API permission.`
        )
      }
      // absent (capture/void did not take effect) or unavailable: try again.
      // Re-sending a charge is safe here because the token is single-use.
    }

    if (sawAmbiguous) throw this.unknownOutcome(input.type, ref, lastDetail)
    throw new NmiError(`Network error calling NMI: ${lastDetail}`, "3")
  }

  /**
   * The current `condition` of a transaction, or null when it cannot be read
   * (no Query permission, network failure, transaction not found).
   */
  async condition(transactionId: string): Promise<string | null> {
    const found = await this.query({ transaction_id: transactionId })
    if (!found.ok) return null
    const txn = found.transactions.find((t) => t.transaction_id === transactionId)
    return txn?.condition ?? null
  }

  private unknownOutcome(
    type: string,
    ref: string,
    detail: string,
    raw?: NmiTransactResult
  ): NmiError {
    this.logger.error(
      `[nmi] OUTCOME UNKNOWN for ${type} ${ref}: ${detail}. NMI may have processed it. ` +
        `Check the transaction in the NMI portal before retrying.`
    )
    return new NmiError(
      `NMI ${type} outcome unknown: ${detail}. Check the NMI portal before retrying.`,
      "3",
      raw?.response_code,
      raw,
      true
    )
  }

  private async postOnce(params: URLSearchParams): Promise<Attempt> {
    let resp: Response
    try {
      resp = await fetch(this.base, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: params.toString(),
        signal: AbortSignal.timeout(this.timeoutMs),
      })
    } catch (e) {
      const code = errorCode(e)
      const err = e as Error | undefined
      const detail = `${err?.name ?? "Error"}${code ? ` ${code}` : ""}: ${err?.message ?? String(e)}`
      return code && NOT_SENT_CODES.has(code)
        ? { kind: "not_sent", detail }
        : { kind: "ambiguous", detail }
    }
    // Rate limited: rejected before processing. Definitive, and must not be retried.
    if (resp.status === 429) {
      return {
        kind: "result",
        result: { response: "3", responsetext: "Rate limit exceeded", response_code: "301" },
      }
    }
    if (resp.status >= 500) return { kind: "ambiguous", detail: `HTTP ${resp.status}` }
    let text: string
    try {
      text = await resp.text()
    } catch (e) {
      return { kind: "ambiguous", detail: `response body lost: ${String(e)}` }
    }
    // A transact.php answer always carries `response`. Anything else (a proxy
    // error page, an empty body) tells us nothing about what NMI did.
    if (!new URLSearchParams(text).has("response")) {
      return { kind: "ambiguous", detail: `unreadable response (HTTP ${resp.status})` }
    }
    const result = parseTransactResponse(text)
    if (isAmbiguousCode(result.response_code)) {
      return {
        kind: "ambiguous",
        detail: `response_code ${result.response_code} ${result.responsetext ?? ""}`.trim(),
        result,
      }
    }
    return { kind: "result", result }
  }

  /** Establish what actually happened to a request whose response was lost. */
  private async resolve(input: Omit<ChargeParamsInput, "securityKey">): Promise<Resolution> {
    if (input.type === "sale" || input.type === "auth") {
      if (!input.sessionId) return { kind: "unavailable", detail: "no order id to look up" }
      let last: Resolution = { kind: "absent" }
      // The transaction may take a moment to appear; poll briefly while absent.
      for (const wait of LOOKUP_DELAYS_MS) {
        if (wait) await this.sleep(wait)
        last = await this.resolveCharge(input.sessionId, input.type, input.amount)
        if (last.kind !== "absent") return last
      }
      return last
    }

    if (!input.transactionId) return { kind: "unavailable", detail: "no transaction id to look up" }
    const found = await this.query({ transaction_id: input.transactionId })
    if (!found.ok) return { kind: "unavailable", detail: found.detail }
    const txn = found.transactions.find((t) => t.transaction_id === input.transactionId)
    if (!txn) return { kind: "unavailable", detail: "transaction not returned by the Query API" }
    const done = {
      response: "1",
      response_code: "100",
      transactionid: input.transactionId,
      recovered: "query",
    }
    if (input.type === "void") {
      return txn.condition === "canceled"
        ? { kind: "approved", result: { ...done, responsetext: "Transaction Void Successful" } }
        : { kind: "absent" }
    }
    if (input.type === "capture") {
      if (txn.condition === "pendingsettlement" || txn.condition === "complete") {
        return { kind: "approved", result: { ...done, responsetext: "SUCCESS" } }
      }
      if (txn.condition === "canceled" || txn.condition === "failed") {
        return { kind: "failed", detail: `transaction is ${txn.condition} and cannot be captured` }
      }
      return { kind: "absent" }
    }
    return { kind: "unavailable", detail: `cannot resolve a ${input.type}` }
  }

  private async resolveCharge(
    orderId: string,
    type: "sale" | "auth",
    amount?: number
  ): Promise<Resolution> {
    const found = await this.query({ order_id: orderId })
    if (!found.ok) return { kind: "unavailable", detail: found.detail }
    // order_id is a filter on NMI's side; match exactly so nothing else is adopted.
    const mine = found.transactions.filter((t) => t.order_id === orderId)
    if (!mine.length) return { kind: "absent" }

    const chargeAction = (t: NmiQueryTransaction) =>
      t.actions.find((a) => a.action_type === "sale" || a.action_type === "auth")

    const live = mine.filter(
      (t) => LIVE_CONDITIONS.has(t.condition ?? "") && chargeAction(t)?.success === "1"
    )
    if (live.length) {
      const t = live[live.length - 1]
      const a = chargeAction(t)!
      const charged = Number(a.amount)
      if (amount != null && Number.isFinite(charged) && Math.abs(charged - amount) >= 0.005) {
        return {
          kind: "unknown",
          detail: `transaction ${t.transaction_id} exists for ${orderId} but for ${a.amount}, not ${amount.toFixed(2)}`,
        }
      }
      if (live.length > 1) {
        this.logger.error(
          `[nmi] ${live.length} live transactions share order id ${orderId} ` +
            `(${live.map((x) => x.transaction_id).join(", ")}). Using the latest; void the others in the NMI portal.`
        )
      }
      return {
        kind: "approved",
        result: {
          response: "1",
          responsetext: a.response_text ?? "SUCCESS",
          authcode: t.authorization_code,
          transactionid: t.transaction_id,
          avsresponse: t.avs_response,
          cvvresponse: t.csc_response,
          orderid: orderId,
          type,
          response_code: "100",
          recovered: "query",
        },
      }
    }
    const unsure = mine.find(
      (t) => !["failed", "canceled", "abandoned"].includes(t.condition ?? "")
    )
    if (unsure) {
      return {
        kind: "unknown",
        detail: `transaction ${unsure.transaction_id} is in condition "${unsure.condition}"`,
      }
    }
    // Everything for this order id is failed, voided or abandoned: nothing is held.
    const t = mine[mine.length - 1]
    const a = chargeAction(t)
    return {
      kind: "failed",
      detail: a?.response_text || `transaction ${t.transaction_id} is ${t.condition}`,
      result: {
        response: a?.response_code?.startsWith("2") ? "2" : "3",
        responsetext: a?.response_text,
        response_code: a?.response_code,
        transactionid: t.transaction_id,
      },
    }
  }

  private async query(
    filter: Record<string, string>
  ): Promise<
    { ok: true; transactions: NmiQueryTransaction[] } | { ok: false; detail: string }
  > {
    const body = new URLSearchParams({ security_key: this.securityKey, ...filter })
    try {
      const resp = await fetch(this.queryUrl, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: body.toString(),
        signal: AbortSignal.timeout(this.queryTimeoutMs),
      })
      if (!resp.ok) return { ok: false, detail: `Query API HTTP ${resp.status}` }
      const parsed = parseQueryResponse(await resp.text())
      if (!parsed) return { ok: false, detail: "Query API returned an unreadable response" }
      if (parsed.error) return { ok: false, detail: `Query API refused: ${parsed.error}` }
      return { ok: true, transactions: parsed.transactions }
    } catch (e) {
      return {
        ok: false,
        detail: `Query API unreachable: ${(e as Error)?.message ?? String(e)}`,
      }
    }
  }
}

const delay = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))
