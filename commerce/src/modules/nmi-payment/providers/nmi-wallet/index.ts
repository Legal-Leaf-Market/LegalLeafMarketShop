import { ModuleProvider, Modules } from "@medusajs/framework/utils"
import { NmiCardProviderService } from "../nmi-card"

/**
 * Wallet NMI provider (Apple Pay / Google Pay as one checkout option that
 * adapts to the shopper's device). Wallet tokens charge exactly like card
 * tokens, so the lifecycle is the card provider's. Requires wallet enablement
 * (and Apple Pay domain registration) in the NMI Merchant Portal.
 */
class NmiWalletProviderService extends NmiCardProviderService {
  static identifier = "nmi-wallet"
}

export { NmiWalletProviderService }

export default ModuleProvider(Modules.PAYMENT, {
  services: [NmiWalletProviderService],
})
