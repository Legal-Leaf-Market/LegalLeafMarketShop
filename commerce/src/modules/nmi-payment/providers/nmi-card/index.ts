import { ModuleProvider, Modules } from "@medusajs/framework/utils"
import {
  AuthorizePaymentInput,
  AuthorizePaymentOutput,
} from "@medusajs/framework/types"
import { NmiBaseProvider } from "../../lib/base-provider"

/**
 * Card-only NMI provider ("Credit card" as its own checkout option).
 * Synchronous: charges the Collect.js card token as an auth or sale per
 * `captureMethod`; the result is known immediately. Pair with the
 * `NmiCardFields` storefront component (Collect.js inline hosted fields).
 */
class NmiCardProviderService extends NmiBaseProvider {
  static identifier = "nmi-card"

  async authorizePayment(input: AuthorizePaymentInput): Promise<AuthorizePaymentOutput> {
    return this.authorizeCard(input)
  }
}

export { NmiCardProviderService }

export default ModuleProvider(Modules.PAYMENT, {
  services: [NmiCardProviderService],
})
