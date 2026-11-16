import { inCategory } from "./types.js";

const SANITY = "https://www.sanity.io/docs/environment-variables";
const CONTENTFUL = "https://www.contentful.com/developers/docs/references/authentication/";
const ALGOLIA = "https://dashboard.algolia.com/account/api-keys";

export const CONTENT_KEYS = inCategory("content", [
  { name: "SANITY_API_TOKEN", provider: "Sanity", description: "Sanity API token.", docsUrl: "https://www.sanity.io/docs/http-auth", pair: ["NEXT_PUBLIC_SANITY_PROJECT_ID"], source: "convention", iconSlug: "sanity" },
  { name: "NEXT_PUBLIC_SANITY_PROJECT_ID", provider: "Sanity", description: "Sanity project id.", docsUrl: SANITY, pair: ["NEXT_PUBLIC_SANITY_DATASET"], source: "convention", iconSlug: "sanity" },
  { name: "NEXT_PUBLIC_SANITY_DATASET", provider: "Sanity", description: "Sanity dataset name, often production.", docsUrl: SANITY, pair: ["NEXT_PUBLIC_SANITY_PROJECT_ID"], source: "convention", iconSlug: "sanity" },
  { name: "CONTENTFUL_SPACE_ID", provider: "Contentful", description: "Contentful space id.", docsUrl: CONTENTFUL, pair: ["CONTENTFUL_ACCESS_TOKEN"], source: "convention", iconSlug: "contentful" },
  { name: "CONTENTFUL_ACCESS_TOKEN", provider: "Contentful", description: "Contentful Delivery API token.", docsUrl: CONTENTFUL, pair: ["CONTENTFUL_SPACE_ID"], source: "convention", iconSlug: "contentful" },
  { name: "ALGOLIA_APP_ID", provider: "Algolia", description: "Algolia application id.", docsUrl: ALGOLIA, pair: ["ALGOLIA_API_KEY"], source: "convention", iconSlug: "algolia" },
  { name: "ALGOLIA_API_KEY", provider: "Algolia", description: "Algolia API key. Use a search-only key in the browser.", docsUrl: ALGOLIA, pair: ["ALGOLIA_APP_ID"], source: "convention", iconSlug: "algolia" },
  { name: "GOOGLE_MAPS_API_KEY", provider: "Google Maps", description: "Google Maps Platform API key.", docsUrl: "https://developers.google.com/maps/documentation/javascript/get-api-key", valueHint: "Starts with AIza", source: "convention", iconSlug: "googlemaps" },
  { name: "NEXT_PUBLIC_MAPBOX_TOKEN", provider: "Mapbox", description: "Mapbox public access token for the browser.", docsUrl: "https://console.mapbox.com/account/access-tokens/", valueHint: "Starts with pk.", valuePattern: /^pk\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/, source: "convention", iconSlug: "mapbox" },
  { name: "NOTION_TOKEN", provider: "Notion", description: "Notion integration secret.", docsUrl: "https://www.notion.so/profile/integrations", valueHint: "Starts with ntn_ or secret_", valuePattern: /^(ntn_|secret_)[A-Za-z0-9]{30,}$/, source: "convention", iconSlug: "notion" },
]);
