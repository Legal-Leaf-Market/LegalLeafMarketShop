import { isIP } from "net"
import {
  AbstractPaymentProvider,
  BigNumber,
  MedusaError,
} from "@medusajs/framework/utils"
import {
  AuthorizePaymentInput, AuthorizePaymentOutput,
  CapturePaymentInput, CapturePaymentOutput,
  CancelPaymentInput, CancelPaymentOutput,
  DeletePaymentInput, DeletePaymentOutput,
  GetPaymentStatusInput, GetPaymentStatusOutput,
  InitiatePaymentInput, InitiatePaymentOutput,
  ProviderWebhookPayload, WebhookActionResult,
  RefundPaymentInput, RefundPaymentOutput,
  RetrievePaymentInput, RetrievePaymentOutput,
  UpdatePaymentInput, UpdatePaymentOutput,
  CreateAccountHolderInput, CreateAccountHolderOutput,
  UpdateAccountHolderInput, UpdateAccountHolderOutput,
  DeleteAccountHolderInput, DeleteAccountHolderOutput,
} from "@medusajs/framework/types"
import { NmiClient, NmiLogger } from "./nmi-client"
import { toNmiBilling } from "./billing"
import { NmiError, NmiTransactResult, buyerMessageFor } from "./errors"
import {
  verifySignature,
  extractSessionId,
  isMedusaSessionId,
  mapNmiEvent,
} from "./webhook"
import { NmiOptions } from "../types"

// The package root registers four variants with the same options; say it once.
let warnedNoWebhookSecret = false

/**
 * Coerce Medusa's BigNumberInput shapes (number | string | BigNumber class |
 * raw { value, precision }) to a plain number. `Number(bigNumberObject)` is
 * NaN, which NMI rejects as "Invalid amount" — refunds from the admin arrive
 * as BigNumber instances, so this must handle every shape.
 */
export function toAmountNumber(input: unknown): number {
  if (typeof input === "number") return input
  if (typeof input === "string") return Number(input)
  if (input && typeof input === "object") {
    const o = input as { numeric?: unknown; value?: unknown }
    if (typeof o.numeric === "number") return o.numeric
    if (typeof o.value === "string" || typeof o.value === "number") {
      return Number(o.value)
    }
  }
  return Number(input)
}

/**
 * Shared NMI lifecycle for every provider variant (unified, card, ach, wallet).
 * The browser tokenizes the chosen method (Collect.js hosted fields or the
 * NmiPayments element) into a single-use `payment_token`; providers charge it
 * server-side via transact.php. Subclasses set `static identifier` and implement
 * `authorizePayment` — everything else is method-agnostic.
 */
export abstract class NmiBaseProvider extends AbstractPaymentProvider<NmiOptions> {
  protected client: NmiClient
  protected options_: NmiOptions
  protected logger_: NmiLogger

  constructor(container: Record<string, unknown>, options: NmiOptions) {
    super(container, options)
    this.options_ = options
    this.logger_ = (container?.logger as NmiLogger | undefined) ?? console
    this.client = new NmiClient(options.securityKey, options.sandbox, {
      logger: this.logger_,
      timeoutMs: options.timeoutMs,
    })
    if (!options.webhookSecret && !warnedNoWebhookSecret) {
      warnedNoWebhookSecret = true
      this.logger_.warn(
        "[nmi] webhookSecret is not set. Card and wallet payments are unaffected. " +
          "ACH payments will be refused and inbound NMI webhooks ignored until it is set."
      )
    }
  }

  static validateOptions(options: Record<string, unknown>): void {
    // webhookSecret is deliberately not required here. The package root
    // registers every variant with one options block, so requiring it at boot
    // would stop a card-only store from starting over a key it has no use for.
    // ACH enforces it at the point of use instead: see authorizeAch.
    for (const key of ["securityKey", "tokenizationKey"]) {
      if (!options[key]) {
        throw new MedusaError(
          MedusaError.Types.INVALID_DATA,
          `NMI provider: required option \`${key}\` is missing`
        )
      }
    }
  }

  /** No money moves; hand the storefront the public tokenization key. */
  async initiatePayment(input: InitiatePaymentInput): Promise<InitiatePaymentOutput> {
    return {
      id: `nmi_${input.data?.session_id ?? "init"}`,
      data: {
        session_id: input.data?.session_id,
        tokenizationKey: this.options_.tokenizationKey,
        // Lets the storefront load Collect.js from the matching gateway host.
        sandbox: !!this.options_.sandbox,
        amount: toAmountNumber(input.amount),
        currency_code: input.currency_code,
      },
    }
  }

  /**
   * A failed charge, as an error the buyer can be shown. Medusa's
   * authorizePaymentSessionStep rethrows only MedusaErrors and replaces anything
   * else with "Payment authorization failed", and the cart-completion route
   * returns a PAYMENT_AUTHORIZATION_ERROR to the storefront as
   * `{ type: "cart", error: { message } }`. The gateway's own text stays in the
   * log: it is not always fit to show the person holding the card.
   */
  protected chargeError(e: unknown, method: "card" | "ach", sessionId?: string): MedusaError {
    if (MedusaError.isMedusaError(e)) return e as MedusaError
    const code =
      e instanceof NmiError && e.responseCode ? ` (response_code ${e.responseCode})` : ""
    this.logger_.error(
      `[nmi] ${method} charge failed for session ${sessionId ?? "?"}: ${
        e instanceof Error ? e.message : String(e)
      }${code}`
    )
    const err = new MedusaError(
      MedusaError.Types.PAYMENT_AUTHORIZATION_ERROR,
      buyerMessageFor(e, method)
    )
    ;(err as { cause?: unknown }).cause = e
    return err
  }

  /**
   * A failed admin operation (capture, refund, void). The admin API masks a plain
   * Error as "An unknown error occurred"; a MedusaError carries NMI's reason to
   * the person who clicked the button.
   */
  protected operationError(op: string, e: unknown): MedusaError {
    if (MedusaError.isMedusaError(e)) return e as MedusaError
    const message = e instanceof Error ? e.message : String(e)
    this.logger_.error(`[nmi] ${op} failed: ${message}`)
    const err = new MedusaError(MedusaError.Types.NOT_ALLOWED, `NMI ${op} failed: ${message}`)
    ;(err as { cause?: unknown }).cause = e
    return err
  }

  /** The trusted inputs of a charge, read off the payment session. */
  private chargeInput(input: AuthorizePaymentInput) {
    // The payment module always passes the session id as the idempotency key;
    // data.session_id is the same value as stamped by initiatePayment.
    const sessionId =
      (input.context?.idempotency_key as string | undefined) ??
      (input.data?.session_id as string | undefined)
    const amount = toAmountNumber(input.data?.amount)
    if (!Number.isFinite(amount) || amount <= 0) {
      this.logger_.error(
        `[nmi] refusing to charge session ${sessionId ?? "?"}: invalid amount ${String(input.data?.amount)}`
      )
      throw new MedusaError(
        MedusaError.Types.PAYMENT_AUTHORIZATION_ERROR,
        "We could not process your payment. Please refresh the page and try again."
      )
    }
    const ip = input.data?.ip_address
    const description = input.data?.order_description
    return {
      sessionId,
      amount,
      // Cardholder billing address for AVS, threaded onto the session data by the
      // storefront from the trusted cart. NMI's portal-configured AVS rules act on
      // it; a hard reject comes back as a decline.
      billing: toNmiBilling(input.data?.billing),
      ipAddress: typeof ip === "string" && isIP(ip.trim()) ? ip.trim() : undefined,
      orderDescription:
        typeof description === "string" && description.trim() ? description.trim() : undefined,
    }
  }

  /** Card/wallet: synchronous auth or sale against the Collect.js token. */
  protected async authorizeCard(input: AuthorizePaymentInput): Promise<AuthorizePaymentOutput> {
    const paymentToken = input.data?.payment_token as string | undefined
    if (!paymentToken) {
      return { status: "pending", data: { ...input.data } }
    }
    const charge = this.chargeInput(input)
    const method = this.options_.captureMethod ?? "auth"
    let txn: NmiTransactResult
    try {
      txn = await this.client.transact({
        type: method === "sale" ? "sale" : "auth",
        paymentToken,
        ...charge,
      })
    } catch (e) {
      throw this.chargeError(e, "card", charge.sessionId)
    }
    return {
      status: method === "sale" ? "captured" : "authorized",
      data: {
        payment_method: "card",
        session_id: charge.sessionId,
        // Kept so capture can state the amount and a full refund can be told
        // from a partial one. The payment module replaces the session data with
        // this object, so anything not copied here is gone.
        amount: charge.amount,
        transactionid: txn.transactionid,
        authcode: txn.authcode,
        avs_response: txn.avsresponse,
        cvv_response: txn.cvvresponse,
        // Display metadata from tokenization (never the real number) — passed
        // through so receipts/admin can show "Visa •••• 1111".
        card_type: input.data?.card_type,
        card_last4: input.data?.card_last4,
        card_exp: input.data?.card_exp,
        raw: txn,
      },
    }
  }

  /** ACH: asynchronous — submit the sale now; the settlement webhook captures it. */
  protected async authorizeAch(input: AuthorizePaymentInput): Promise<AuthorizePaymentOutput> {
    // An ACH debit is only finished by its settlement webhook, and a webhook is
    // only trusted if it can be verified. Without the signing key the payment
    // would sit in "authorized" forever, so refuse it before any money is asked for.
    if (!this.options_.webhookSecret) {
      this.logger_.error(
        "[nmi] ACH payment refused: webhookSecret is not set, so the settlement webhook could not be verified."
      )
      throw new MedusaError(
        MedusaError.Types.PAYMENT_AUTHORIZATION_ERROR,
        "Bank payments are not available right now. Please use another payment method."
      )
    }
    const paymentToken = input.data?.payment_token as string | undefined
    if (!paymentToken) {
      return { status: "pending", data: { ...input.data } }
    }
    const charge = this.chargeInput(input)
    let txn: NmiTransactResult
    try {
      txn = await this.client.transact({
        type: "sale",
        paymentToken,
        ...charge,
        ach: {
          secCode: this.options_.secCode ?? "WEB",
          accountType: input.data?.account_type as "checking" | "savings" | undefined,
          accountHolderType: input.data?.account_holder_type as "personal" | "business" | undefined,
        },
      })
    } catch (e) {
      throw this.chargeError(e, "ach", charge.sessionId)
    }
    // Accepted, not yet settled — settlement webhook drives "captured".
    return {
      status: "authorized",
      data: {
        payment_method: "ach",
        session_id: charge.sessionId,
        amount: charge.amount,
        transactionid: txn.transactionid,
        avs_response: txn.avsresponse,
        cvv_response: txn.cvvresponse,
        raw: txn,
      },
    }
  }

  abstract authorizePayment(input: AuthorizePaymentInput): Promise<AuthorizePaymentOutput>

  /** The NMI transaction a payment refers to, or a clear error if it has none. */
  private transactionIdOf(data: Record<string, unknown> | undefined, op: string): string {
    const id = data?.transactionid
    if (typeof id !== "string" && typeof id !== "number") {
      throw new MedusaError(
        MedusaError.Types.NOT_ALLOWED,
        `NMI ${op} failed: this payment has no NMI transaction id`
      )
    }
    return String(id)
  }

  async capturePayment(input: CapturePaymentInput): Promise<CapturePaymentOutput> {
    // ACH settles asynchronously, so there is nothing to send: the debit went out at
    // authorization and the network decides the rest. This stays a no-op rather than
    // throwing on a premature admin click, because the settlement webhook captures
    // through this same method and Medusa passes no way to tell the two callers apart
    // (payment-provider.js forwards only `data` and an idempotency key — `captured_by`
    // never reaches a provider). Throwing here would break settlement.
    //
    // The consequence: clicking Capture on an unsettled ACH payment still stamps
    // `captured_at` in Medusa while the money is in flight. Gate fulfillment on the ACH
    // lifecycle instead of on payment status — see the README.
    if (input.data?.payment_method === "ach") return { data: input.data ?? {} }
    const transactionId = this.transactionIdOf(input.data, "capture")
    // Medusa does not pass a capture amount to providers, so this always captures
    // the full authorization. The amount is stated when we have it; payments
    // authorized before 0.5.0 did not record it and capture without one.
    const authorized = toAmountNumber(input.data?.amount)
    try {
      const txn = await this.client.transact({
        type: "capture",
        transactionId,
        ...(Number.isFinite(authorized) && authorized > 0 ? { amount: authorized } : {}),
      })
      return { data: { ...input.data, captured: true, raw: txn } }
    } catch (e) {
      throw this.operationError("capture", e)
    }
  }

  async refundPayment(input: RefundPaymentInput): Promise<RefundPaymentOutput> {
    const transactionId = this.transactionIdOf(input.data, "refund")
    const amount = toAmountNumber(input.amount)
    if (!Number.isFinite(amount) || amount <= 0) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        `NMI refund failed: invalid amount ${String(input.amount)}`
      )
    }
    // A void or refund of an ACH transaction must say so, or NMI looks for a card
    // transaction.
    const ach = input.data?.payment_method === "ach" ? { ach: {} } : {}

    // A refund of the whole payment, with nothing refunded before it, is tried
    // as a void first. Before settlement a void simply removes the charge; a
    // refund there lets both the sale and a credit settle, so the buyer sees a
    // charge followed by a credit and the merchant pays processing on the sale.
    // Medusa's admin only offers Refund once a payment is captured, so this is
    // the only place the choice can be made. A void is all or nothing, so
    // partial refunds, and anything after a first refund, stay refunds.
    //
    // `amount` is on payment.data from 0.5.0; older payments have none and are
    // refunded directly.
    const original = toAmountNumber(input.data?.amount)
    const isFirstFullRefund =
      Number.isFinite(original) &&
      Math.abs(amount - original) < 0.005 &&
      !input.data?.refundId &&
      !input.data?.voided

    if (isFirstFullRefund) {
      try {
        const txn = await this.client.transact({ type: "void", transactionId, ...ach })
        return {
          data: { ...input.data, refundId: txn.transactionid, voided: true, raw: txn },
        }
      } catch (voidError) {
        // A definite refusal (settled, already voided, not voidable) falls
        // through to the refund. A void whose response was lost is different:
        // if it did land, a refund on top would return the money twice. The
        // client has already tried to resolve it through the Query API; look
        // once more, and only refund when NMI shows the transaction settled,
        // which is the one state a void can no longer reach.
        if (voidError instanceof NmiError && voidError.outcomeUnknown) {
          const condition = await this.client.condition(transactionId)
          if (condition === "canceled") {
            return {
              data: { ...input.data, refundId: transactionId, voided: true },
            }
          }
          if (condition !== "complete") throw this.operationError("refund", voidError)
        }
      }
    }

    try {
      const txn = await this.client.transact({
        type: "refund", transactionId, amount, ...ach,
      })
      return { data: { ...input.data, refundId: txn.transactionid, raw: txn } }
    } catch (refundError) {
      throw this.operationError("refund", refundError)
    }
  }

  async cancelPayment(input: CancelPaymentInput): Promise<CancelPaymentOutput> {
    // Nothing was ever charged at NMI, so there is nothing to void.
    if (input.data?.transactionid == null) {
      return { data: { ...input.data, canceled: true } }
    }
    const transactionId = String(input.data.transactionid)
    const isAch = input.data?.payment_method === "ach"
    // Pre-settlement reversal = void. (Post-settlement use refund.)
    try {
      const txn = await this.client.transact({
        type: "void",
        transactionId,
        ...(isAch ? { ach: {} } : {}),
      })
      return { data: { ...input.data, canceled: true, raw: txn } }
    } catch (voidError) {
      // Ask NMI what state the transaction is really in before deciding what a
      // failed void means. null = could not be read (no Query permission).
      const condition = await this.client.condition(transactionId)
      const void_error = voidError instanceof Error ? voidError.message : String(voidError)
      // Already voided: the cancellation is, in fact, done.
      if (condition === "canceled") {
        return { data: { ...input.data, canceled: true, already_voided: true } }
      }
      // A returned ACH debit cannot be voided — the money already came back on its own.
      // Cancelling the order is exactly the right response to a return, so refusing to
      // cancel would strand the order (and its inventory reservation) over a reversal
      // that has, in substance, already happened. Record why the void failed instead of
      // blocking the cancellation.
      //
      // That tolerance only holds while the debit is not live. If NMI says it is still
      // pending settlement or has settled, cancelling would leave the buyer charged for
      // a cancelled order, so that case is refused. Card payments are always strict: a
      // failed void there means the authorization may still be live.
      const live =
        condition === "pending" || condition === "pendingsettlement" || condition === "complete"
      if (!isAch || live) {
        throw this.operationError(
          "void",
          live
            ? new Error(
                `${void_error}. The transaction is still live at NMI (${condition})` +
                  (condition === "complete" ? "; it has settled, so refund it instead." : ".")
              )
            : voidError
        )
      }
      if (condition === null) {
        this.logger_.error(
          `[nmi] ACH void of ${transactionId} failed (${void_error}) and its state could not be read ` +
            `from the Query API. The cancellation was allowed on the assumption the debit was returned. ` +
            `Confirm in the NMI portal that it is not still pending.`
        )
      }
      return {
        data: {
          ...input.data,
          canceled: true,
          void_failed: true,
          void_error,
          ...(condition ? { nmi_condition: condition } : {}),
        },
      }
    }
  }

  async getPaymentStatus(input: GetPaymentStatusInput): Promise<GetPaymentStatusOutput> {
    const d = input.data ?? {}
    if (d.canceled || d.voided) return { status: "canceled", data: d }
    if (d.settled || d.captured || d.refundId) return { status: "captured", data: d }
    if (d.transactionid) return { status: "authorized", data: d }
    return { status: "pending", data: d }
  }

  async retrievePayment(input: RetrievePaymentInput): Promise<RetrievePaymentOutput> {
    return { data: input.data ?? {} }
  }

  async updatePayment(input: UpdatePaymentInput): Promise<UpdatePaymentOutput> {
    return { data: { ...input.data, amount: toAmountNumber(input.amount) } }
  }

  async deletePayment(input: DeletePaymentInput): Promise<DeletePaymentOutput> {
    return { data: input.data ?? {} }
  }

  /** Vault out of scope: satisfy the account-holder step with a synthetic id. */
  async createAccountHolder(input: CreateAccountHolderInput): Promise<CreateAccountHolderOutput> {
    return { id: `nmi_novault_${input.context.customer.id}`, data: { novault: true } }
  }

  async updateAccountHolder(input: UpdateAccountHolderInput): Promise<UpdateAccountHolderOutput> {
    // Nothing stored at NMI while vaulting is out of scope.
    return { data: input.data ?? {} }
  }

  async deleteAccountHolder(_input: DeleteAccountHolderInput): Promise<DeleteAccountHolderOutput> {
    return { data: {} }
  }

  async getWebhookActionAndData(
    payload: ProviderWebhookPayload["payload"]
  ): Promise<WebhookActionResult> {
    const ignore: WebhookActionResult = { action: "not_supported" }
    // No signing key, no webhooks: an event that cannot be verified is never acted on.
    const secret = this.options_.webhookSecret
    if (!secret) return ignore

    const rawData = payload?.rawData as unknown
    let rawBody: string
    if (typeof rawData === "string") rawBody = rawData
    else if (rawData instanceof Uint8Array) rawBody = Buffer.from(rawData).toString("utf8")
    else return ignore

    const headers = (payload.headers ?? {}) as Record<string, unknown>
    const headerValue = headers["webhook-signature"] ?? headers["Webhook-Signature"]
    const sigHeader = Array.isArray(headerValue) ? headerValue[0] : headerValue
    if (!verifySignature(secret, rawBody, sigHeader as string | undefined)) {
      this.logger_.warn(
        "[nmi] webhook ignored: signature did not verify. Check webhookSecret against the NMI portal."
      )
      return ignore
    }

    // Read the event from the bytes that were verified, not from a separately
    // parsed copy of the request.
    let body: Record<string, any>
    try {
      body = JSON.parse(rawBody)
    } catch {
      return ignore
    }
    const eventBody = (body?.event_body ?? {}) as Record<string, any>
    const action = mapNmiEvent(String(body?.event_type ?? ""), eventBody)
    if (!action) return ignore
    const sessionId = extractSessionId(eventBody)
    if (!isMedusaSessionId(sessionId)) return ignore

    // ACH settles all or nothing. When the event states a usable amount pass it
    // on; otherwise leave it out so Medusa captures the full payment amount.
    const stated = Math.abs(Number(eventBody.action?.amount ?? eventBody.requested_amount))
    return {
      action,
      data: {
        session_id: sessionId,
        amount: (Number.isFinite(stated) && stated > 0 ? new BigNumber(stated) : undefined) as any,
      },
    }
  }
}
