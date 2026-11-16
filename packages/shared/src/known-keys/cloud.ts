import { inCategory } from "./types.js";

const AWS_KEYS = "https://console.aws.amazon.com/iam/home#/security_credentials";

export const CLOUD_KEYS = inCategory("cloud", [
  { name: "AWS_ACCESS_KEY_ID", provider: "AWS", description: "AWS access key id.", docsUrl: AWS_KEYS, valueHint: "Starts with AKIA or ASIA", valuePattern: /^(AKIA|ASIA)[A-Z0-9]{16}$/, pair: ["AWS_SECRET_ACCESS_KEY"], source: "sdk" },
  { name: "AWS_SECRET_ACCESS_KEY", provider: "AWS", description: "AWS secret access key.", docsUrl: AWS_KEYS, pair: ["AWS_ACCESS_KEY_ID"], source: "sdk" },
  { name: "AWS_REGION", provider: "AWS", description: "Default AWS region.", docsUrl: "https://docs.aws.amazon.com/general/latest/gr/rande.html", valueHint: "For example us-east-1", source: "sdk" },
  { name: "AWS_SESSION_TOKEN", provider: "AWS", description: "Session token for temporary AWS credentials.", docsUrl: AWS_KEYS, source: "sdk" },
  { name: "GOOGLE_APPLICATION_CREDENTIALS", provider: "Google Cloud", description: "Path to a service account JSON file, read by Google Cloud client libraries.", docsUrl: "https://cloud.google.com/docs/authentication/application-default-credentials", valueHint: "A file path", source: "sdk", iconSlug: "googlecloud" },
  { name: "CLOUDFLARE_API_TOKEN", provider: "Cloudflare", description: "Cloudflare API token, read by the SDK and Wrangler.", docsUrl: "https://dash.cloudflare.com/profile/api-tokens", pair: ["CLOUDFLARE_ACCOUNT_ID"], source: "sdk" },
  { name: "CLOUDFLARE_ACCOUNT_ID", provider: "Cloudflare", description: "Cloudflare account id, read by Wrangler.", docsUrl: "https://developers.cloudflare.com/fundamentals/account/find-account-and-zone-ids/", valuePattern: /^[a-f0-9]{32}$/, pair: ["CLOUDFLARE_API_TOKEN"], source: "sdk" },
  { name: "GITHUB_TOKEN", provider: "GitHub", description: "Personal access token for the GitHub API.", docsUrl: "https://github.com/settings/tokens", valueHint: "Starts with ghp_ or github_pat_", valuePattern: /^(ghp_[A-Za-z0-9]{36}|github_pat_[A-Za-z0-9_]{40,})$/, source: "sdk" },
  { name: "NPM_TOKEN", provider: "npm", description: "npm access token for publishing or private packages.", docsUrl: "https://docs.npmjs.com/creating-and-viewing-access-tokens", valueHint: "Starts with npm_", valuePattern: /^npm_[A-Za-z0-9]{36}$/, source: "convention", iconSlug: "npm" },
  { name: "VERCEL_TOKEN", provider: "Vercel", description: "Vercel access token for the API and CLI.", docsUrl: "https://vercel.com/account/settings/tokens", source: "convention" },
  { name: "NETLIFY_AUTH_TOKEN", provider: "Netlify", description: "Netlify personal access token, read by the Netlify CLI.", docsUrl: "https://app.netlify.com/user/applications#personal-access-tokens", source: "sdk" },
  { name: "FLY_API_TOKEN", provider: "Fly.io", description: "Fly.io API token, read by flyctl.", docsUrl: "https://fly.io/docs/security/tokens/", source: "sdk" },
  { name: "RAILWAY_TOKEN", provider: "Railway", description: "Railway project token, read by the Railway CLI.", docsUrl: "https://docs.railway.com/guides/cli#tokens", source: "sdk", iconSlug: "railway" },
  { name: "RENDER_API_KEY", provider: "Render", description: "Render API key.", docsUrl: "https://dashboard.render.com/u/settings#api-keys", valueHint: "Starts with rnd_", valuePattern: /^rnd_[A-Za-z0-9]{20,}$/, source: "convention", iconSlug: "render" },
  { name: "DIGITALOCEAN_ACCESS_TOKEN", provider: "DigitalOcean", description: "DigitalOcean API token, read by doctl.", docsUrl: "https://cloud.digitalocean.com/account/api/tokens", valueHint: "Starts with dop_v1_", valuePattern: /^dop_v1_[a-f0-9]{64}$/, source: "sdk", iconSlug: "digitalocean" },
]);
