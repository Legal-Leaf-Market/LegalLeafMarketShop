import { ModuleProvider, Modules } from "@medusajs/framework/utils"
import {
  AuthorizePaymentInput,
  AuthorizePaymentOutput,
} from "@medusajs/framework/types"
import { NmiBaseProvider } from "../../lib/base-provider"

/**
 * ACH/eCheck-only NMI provider ("Bank account" as its own checkout option).
 * Asynchronous: the debit is submitted at checkout (accepted → "authorized");
 * the settlement webhook captures it and an ACH return fails it. Point the NMI
 * Merchant Portal webhook at /hooks/payment/nmi-ach. Pair with the
 * `NmiAchFields` storefront component (Collect.js inline hosted fields).
 */
class NmiAchProviderService extends NmiBaseProvider {
  static identifier = "nmi-ach"

  async authorizePayment(input: AuthorizePaymentInput): Promise<AuthorizePaymentOutput> {
    return this.authorizeAch(input)
  }
}

export { NmiAchProviderService }

export default ModuleProvider(Modules.PAYMENT, {
  services: [NmiAchProviderService],
})
