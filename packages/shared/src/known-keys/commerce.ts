import { inCategory } from "./types.js";

const SHOPIFY_APPS = "https://shopify.dev/docs/apps/build/authentication-authorization/client-secrets";

export const COMMERCE_KEYS = inCategory("commerce", [
  { name: "SHOPIFY_API_KEY", provider: "Shopify", description: "Shopify app client id.", docsUrl: SHOPIFY_APPS, pair: ["SHOPIFY_API_SECRET"], source: "convention" },
  { name: "SHOPIFY_API_SECRET", provider: "Shopify", description: "Shopify app client secret.", docsUrl: SHOPIFY_APPS, pair: ["SHOPIFY_API_KEY"], source: "convention" },
  { name: "SHOPIFY_ACCESS_TOKEN", provider: "Shopify", description: "Admin API access token for a custom app.", docsUrl: "https://shopify.dev/docs/apps/build/authentication-authorization/access-tokens/generate-app-access-tokens-admin", valueHint: "Starts with shpat_", valuePattern: /^shpat_[a-fA-F0-9]{32}$/, pair: ["SHOPIFY_STORE_DOMAIN"], source: "convention" },
  { name: "SHOPIFY_STOREFRONT_ACCESS_TOKEN", provider: "Shopify", description: "Storefront API access token.", docsUrl: "https://shopify.dev/docs/storefronts/headless/building-with-the-storefront-api/getting-started", pair: ["SHOPIFY_STORE_DOMAIN"], source: "convention" },
  { name: "SHOPIFY_STORE_DOMAIN", provider: "Shopify", description: "The store's myshopify.com domain.", docsUrl: "https://help.shopify.com/en/manual/domains", valueHint: "<store>.myshopify.com", valuePattern: /^[a-z0-9-]+\.myshopify\.com$/, source: "convention" },
  { name: "HUBSPOT_ACCESS_TOKEN", provider: "HubSpot", description: "HubSpot private app access token.", docsUrl: "https://developers.hubspot.com/docs/api/private-apps", valueHint: "Starts with pat-", valuePattern: /^pat-[a-z0-9]+-[a-f0-9-]{36}$/, source: "convention" },
]);
