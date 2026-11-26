import { ModuleProvider, Modules } from "@medusajs/framework/utils"
import { NmiCardProviderService } from "./providers/nmi-card"
import { NmiWalletProviderService } from "./providers/nmi-wallet"

/**
 * NMI card + Apple Pay / Google Pay providers for Medusa.
 *
 * Vendored from medusa-payment-nmi v0.6.1 (MIT, Kael Broersma,
 * https://github.com/Kaelbroersma/medusa-payment-nmi, commit cadb887) because
 * that release is not on the npm registry yet. Only lib/, providers/ and
 * types.ts are copied, unchanged; the admin widget is left out. ACH is not
 * registered: the store takes cards only.
 *
 * To upgrade, re-copy those files from a newer tag, or switch to the npm
 * package once it is published and delete this folder.
 */
export default ModuleProvider(Modules.PAYMENT, {
  services: [NmiCardProviderService, NmiWalletProviderService],
})
