import { ModuleProvider, Modules } from "@medusajs/framework/utils"
import {
  AuthorizePaymentInput,
  AuthorizePaymentOutput,
} from "@medusajs/framework/types"
import { NmiBaseProvider } from "../../lib/base-provider"

/**
 * Unified NMI payment provider — card, ACH, and Apple/Google Pay through one
 * checkout option (the all-in-one `NmiPayments` storefront element). The
 * storefront stamps `payment_method` ("ach" vs "card") onto the session so we
 * know which lifecycle to run. Prefer the split `nmi-card` / `nmi-ach` /
 * `nmi-wallet` providers when you want each method as its own checkout option.
 */
class NmiProviderService extends NmiBaseProvider {
  static identifier = "nmi"

  async authorizePayment(input: AuthorizePaymentInput): Promise<AuthorizePaymentOutput> {
    const paymentMethod = (input.data?.payment_method as string | undefined) ?? "card"
    return paymentMethod === "ach"
      ? this.authorizeAch(input)
      : this.authorizeCard(input)
  }
}

export { NmiProviderService }

export default ModuleProvider(Modules.PAYMENT, {
  services: [NmiProviderService],
})
