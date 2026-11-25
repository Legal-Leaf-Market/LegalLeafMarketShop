import { loadEnv, defineConfig } from "@medusajs/framework/utils"

loadEnv(process.env.NODE_ENV || "development", process.cwd())

// Legal-Leaf Market commerce backend (Medusa v2).
//
// Payments: the NMI gateway, which is what PaymentCloud / Soar issue for a
// high-risk (vape / smoke-shop) merchant account. The provider is only
// registered once the keys exist, so the store boots and can be tested before
// the merchant account is approved. Until then the only provider is Medusa's
// built-in "system" one, which never charges a card and is for testing only:
// setup-store.ts leaves it off the region in production.
const nmiConfigured = Boolean(
  process.env.NMI_SECURITY_KEY && process.env.NMI_TOKENIZATION_KEY
)

const paymentProviders = nmiConfigured
  ? [
      {
        resolve: "medusa-payment-nmi",
        options: {
          securityKey: process.env.NMI_SECURITY_KEY,
          tokenizationKey: process.env.NMI_TOKENIZATION_KEY,
          webhookSecret: process.env.NMI_WEBHOOK_SECRET,
          // Authorize at checkout, capture when the order is handed over.
          // Special orders can take days to arrive; capturing on delivery
          // keeps refunds and chargebacks down.
          captureMethod: "auth",
          sandbox: process.env.NMI_SANDBOX !== "false",
        },
      },
    ]
  : []

// Redis is optional. Without REDIS_URL Medusa uses in-memory events, cache and
// workflow storage, which is fine for one small server.
const redisUrl = process.env.REDIS_URL

module.exports = defineConfig({
  projectConfig: {
    databaseUrl: process.env.DATABASE_URL,
    ...(redisUrl ? { redisUrl } : {}),
    http: {
      storeCors: process.env.STORE_CORS!,
      adminCors: process.env.ADMIN_CORS!,
      authCors: process.env.AUTH_CORS!,
      jwtSecret: process.env.JWT_SECRET || "supersecret",
      cookieSecret: process.env.COOKIE_SECRET || "supersecret",
    },
  },
  admin: {
    disable: process.env.DISABLE_MEDUSA_ADMIN === "true",
    backendUrl: process.env.MEDUSA_BACKEND_URL,
  },
  modules: paymentProviders.length
    ? [
        {
          resolve: "@medusajs/medusa/payment",
          options: { providers: paymentProviders },
        },
      ]
    : [],
})
