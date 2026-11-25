import { ExecArgs } from "@medusajs/framework/types"
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"
import {
  createApiKeysWorkflow,
  createRegionsWorkflow,
  createSalesChannelsWorkflow,
  createShippingOptionsWorkflow,
  createShippingProfilesWorkflow,
  createStockLocationsWorkflow,
  createTaxRegionsWorkflow,
  linkSalesChannelsToApiKeyWorkflow,
  linkSalesChannelsToStockLocationWorkflow,
  updateRegionsWorkflow,
  updateStoresWorkflow,
} from "@medusajs/medusa/core-flows"

/**
 * One-time store setup for Legal-Leaf Market. Safe to run again: every step
 * looks for what it would create first.
 *
 *   npx medusa exec ./src/scripts/setup-store.ts
 *
 * What it makes:
 *   - USD store, one "United States" region
 *   - Indiana sales tax (7%) under a US tax region
 *   - a "Columbus, IN" stock location with free local delivery inside Indiana
 *   - two sales channels: "Web" (legalleafmarket.shop) and "Kiosk" (tablets in
 *     partner shops), each with its own publishable key so kiosk orders can be
 *     told apart for commission
 */
const STORE_NAME = "Legal-Leaf Market"
const CHANNELS = [
  { name: "Web", description: "legalleafmarket.shop" },
  { name: "Kiosk", description: "Tablets in partner shops" },
]
const LOCATION_NAME = "Columbus, IN"
const DELIVERY_SET_NAME = "Columbus local delivery"
const DELIVERY_OPTION_NAME = "Free local delivery (Columbus, IN)"

export default async function setupStore({ container }: ExecArgs) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER)
  const link = container.resolve(ContainerRegistrationKeys.LINK)
  const query = container.resolve(ContainerRegistrationKeys.QUERY)
  const storeService = container.resolve(Modules.STORE)
  const salesChannelService = container.resolve(Modules.SALES_CHANNEL)
  const regionService = container.resolve(Modules.REGION)
  const taxService = container.resolve(Modules.TAX)
  const stockLocationService = container.resolve(Modules.STOCK_LOCATION)
  const fulfillmentService = container.resolve(Modules.FULFILLMENT)
  const paymentService = container.resolve(Modules.PAYMENT)
  const production = process.env.NODE_ENV === "production"

  // ---- sales channels ------------------------------------------------------
  const channels: Record<string, string> = {}
  for (const c of CHANNELS) {
    const [found] = await salesChannelService.listSalesChannels({ name: c.name })
    if (found) {
      channels[c.name] = found.id
      continue
    }
    const { result } = await createSalesChannelsWorkflow(container).run({
      input: { salesChannelsData: [c] },
    })
    channels[c.name] = result[0].id
    logger.info(`Created sales channel ${c.name}`)
  }

  // ---- store ---------------------------------------------------------------
  const [store] = await storeService.listStores()
  await updateStoresWorkflow(container).run({
    input: {
      selector: { id: store.id },
      update: {
        name: STORE_NAME,
        supported_currencies: [{ currency_code: "usd", is_default: true }],
        default_sales_channel_id: channels.Web,
      },
    },
  })

  // ---- payment providers ---------------------------------------------------
  // NMI registers once its keys are set (medusa-config.ts). The system provider
  // takes no money; it is kept off the region in production.
  const providers = await paymentService.listPaymentProviders({})
  const nmi = providers.map((p) => p.id).filter((id) => id.startsWith("pp_nmi"))
  const paymentProviders = [...nmi]
  if (!production || !nmi.length) paymentProviders.push("pp_system_default")
  if (!nmi.length) {
    logger.warn(
      "NMI keys are not set, so the region only has the test payment provider. " +
        "Run this script again after adding NMI_SECURITY_KEY and NMI_TOKENIZATION_KEY."
    )
  }

  // ---- region --------------------------------------------------------------
  let [region] = await regionService.listRegions({ name: "United States" })
  if (!region) {
    const { result } = await createRegionsWorkflow(container).run({
      input: {
        regions: [
          {
            name: "United States",
            currency_code: "usd",
            countries: ["us"],
            payment_providers: paymentProviders,
            automatic_taxes: true,
          },
        ],
      },
    })
    region = result[0]
    logger.info("Created region United States")
  } else {
    await updateRegionsWorkflow(container).run({
      input: {
        selector: { id: region.id },
        update: { payment_providers: paymentProviders },
      },
    })
  }

  // ---- tax -----------------------------------------------------------------
  const usTaxRegions = await taxService.listTaxRegions({ country_code: "us" })
  let usTax = usTaxRegions.find((t) => !t.province_code)
  if (!usTax) {
    const { result } = await createTaxRegionsWorkflow(container).run({
      input: [{ country_code: "us", provider_id: "tp_system" }],
    })
    usTax = result[0]
  }
  const inTax = usTaxRegions.find((t) => t.province_code === "us-in")
  if (!inTax) {
    await createTaxRegionsWorkflow(container).run({
      input: [
        {
          country_code: "us",
          province_code: "us-in",
          parent_id: usTax.id,
          provider_id: "tp_system",
          default_tax_rate: { rate: 7, code: "IN-SALES", name: "Indiana sales tax" },
        },
      ],
    })
    logger.info("Created Indiana 7% sales tax")
  }

  // ---- stock location ------------------------------------------------------
  let [location] = await stockLocationService.listStockLocations({
    name: LOCATION_NAME,
  })
  if (!location) {
    const { result } = await createStockLocationsWorkflow(container).run({
      input: {
        locations: [
          {
            name: LOCATION_NAME,
            address: {
              city: "Columbus",
              province: "IN",
              country_code: "US",
              address_1: "",
            },
          },
        ],
      },
    })
    location = result[0]
    await link.create({
      [Modules.STOCK_LOCATION]: { stock_location_id: location.id },
      [Modules.FULFILLMENT]: { fulfillment_provider_id: "manual_manual" },
    })
    logger.info(`Created stock location ${LOCATION_NAME}`)
  }
  await updateStoresWorkflow(container).run({
    input: { selector: { id: store.id }, update: { default_location_id: location.id } },
  })
  await linkSalesChannelsToStockLocationWorkflow(container).run({
    input: { id: location.id, add: Object.values(channels) },
  })

  // ---- delivery ------------------------------------------------------------
  let [profile] = await fulfillmentService.listShippingProfiles({ type: "default" })
  if (!profile) {
    const { result } = await createShippingProfilesWorkflow(container).run({
      input: { data: [{ name: "Default Shipping Profile", type: "default" }] },
    })
    profile = result[0]
  }

  let [deliverySet] = await fulfillmentService.listFulfillmentSets(
    { name: DELIVERY_SET_NAME },
    { relations: ["service_zones"] }
  )
  if (!deliverySet) {
    deliverySet = await fulfillmentService.createFulfillmentSets({
      name: DELIVERY_SET_NAME,
      type: "shipping",
      service_zones: [
        {
          name: "Indiana",
          geo_zones: [{ type: "province", country_code: "us", province_code: "us-in" }],
        },
      ],
    })
    await link.create({
      [Modules.STOCK_LOCATION]: { stock_location_id: location.id },
      [Modules.FULFILLMENT]: { fulfillment_set_id: deliverySet.id },
    })
    logger.info("Created Indiana delivery zone")
  }

  const { data: existingOptions } = await query.graph({
    entity: "shipping_option",
    fields: ["id", "name"],
    filters: { name: DELIVERY_OPTION_NAME },
  })
  if (!existingOptions.length) {
    await createShippingOptionsWorkflow(container).run({
      input: [
        {
          name: DELIVERY_OPTION_NAME,
          price_type: "flat",
          provider_id: "manual_manual",
          service_zone_id: deliverySet.service_zones[0].id,
          shipping_profile_id: profile.id,
          type: {
            label: "Local delivery",
            description:
              "Hand-delivered in Columbus, IN. 21+ photo ID checked at the door.",
            code: "local-delivery",
          },
          prices: [
            { currency_code: "usd", amount: 0 },
            { region_id: region.id, amount: 0 },
          ],
          rules: [
            { attribute: "enabled_in_store", value: "true", operator: "eq" },
            { attribute: "is_return", value: "false", operator: "eq" },
          ],
        },
      ],
    })
    logger.info(`Created shipping option ${DELIVERY_OPTION_NAME}`)
  }

  // ---- publishable keys (one per channel) ----------------------------------
  for (const [name, channelId] of Object.entries(channels)) {
    const title = `${name} storefront`
    const { data: keys } = await query.graph({
      entity: "api_key",
      fields: ["id", "token", "title"],
      filters: { type: "publishable", title },
    })
    let key: { id: string; token: string } | undefined = keys[0]
    if (!key) {
      const { result } = await createApiKeysWorkflow(container).run({
        input: { api_keys: [{ title, type: "publishable", created_by: "" }] },
      })
      key = result[0]
    }
    await linkSalesChannelsToApiKeyWorkflow(container).run({
      input: { id: key.id, add: [channelId] },
    })
    logger.info(`Publishable key for ${name}: ${key.token}`)
  }

  logger.info("Store setup finished.")
}
