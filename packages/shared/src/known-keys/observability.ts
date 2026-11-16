import { inCategory } from "./types.js";

export const OBSERVABILITY_KEYS = inCategory("observability", [
  { name: "SENTRY_DSN", provider: "Sentry", description: "Where the Sentry SDK sends events.", docsUrl: "https://docs.sentry.io/concepts/key-terms/dsn-explainer/", valueHint: "https://<key>@<org>.ingest.sentry.io/<project>", valuePattern: /^https:\/\/[a-f0-9]+@[a-z0-9.-]*sentry\.io\/\d+$/, source: "sdk" },
  { name: "NEXT_PUBLIC_SENTRY_DSN", provider: "Sentry", description: "Sentry DSN for the browser bundle.", docsUrl: "https://docs.sentry.io/platforms/javascript/guides/nextjs/", source: "convention" },
  { name: "SENTRY_AUTH_TOKEN", provider: "Sentry", description: "Token for source map uploads, read by sentry-cli.", docsUrl: "https://sentry.io/settings/auth-tokens/", valueHint: "Starts with sntrys_", valuePattern: /^sntry[su]_[A-Za-z0-9_=+/-]{20,}$/, pair: ["SENTRY_ORG", "SENTRY_PROJECT"], source: "sdk" },
  { name: "SENTRY_ORG", provider: "Sentry", description: "Sentry organization slug, read by sentry-cli.", docsUrl: "https://docs.sentry.io/cli/configuration/", pair: ["SENTRY_PROJECT"], source: "sdk" },
  { name: "SENTRY_PROJECT", provider: "Sentry", description: "Sentry project slug, read by sentry-cli.", docsUrl: "https://docs.sentry.io/cli/configuration/", pair: ["SENTRY_ORG"], source: "sdk" },
  { name: "NEXT_PUBLIC_POSTHOG_KEY", provider: "PostHog", description: "PostHog project API key for the browser.", docsUrl: "https://us.posthog.com/settings/project", valueHint: "Starts with phc_", valuePattern: /^phc_[A-Za-z0-9]{20,}$/, pair: ["NEXT_PUBLIC_POSTHOG_HOST"], source: "convention" },
  { name: "NEXT_PUBLIC_POSTHOG_HOST", provider: "PostHog", description: "PostHog host, for example https://us.i.posthog.com.", docsUrl: "https://posthog.com/docs/libraries/next-js", pair: ["NEXT_PUBLIC_POSTHOG_KEY"], source: "convention" },
  { name: "DD_API_KEY", provider: "Datadog", description: "Datadog API key, read by the Datadog Agent and libraries.", docsUrl: "https://docs.datadoghq.com/account_management/api-app-keys/", source: "sdk", iconSlug: "datadog" },
  { name: "NEW_RELIC_LICENSE_KEY", provider: "New Relic", description: "New Relic license key, read by the New Relic agents.", docsUrl: "https://docs.newrelic.com/docs/apis/intro-apis/new-relic-api-keys/", source: "sdk", iconSlug: "newrelic" },
  { name: "AXIOM_TOKEN", provider: "Axiom", description: "Axiom API token.", docsUrl: "https://axiom.co/docs/reference/tokens", valueHint: "Starts with xaat-", valuePattern: /^xaat-[a-f0-9-]{36}$/, source: "convention" },
  { name: "NEXT_PUBLIC_GA_MEASUREMENT_ID", provider: "Google Analytics", description: "Google Analytics 4 measurement id.", docsUrl: "https://support.google.com/analytics/answer/12270356", valueHint: "Starts with G-", valuePattern: /^G-[A-Z0-9]{6,12}$/, source: "convention", iconSlug: "googleanalytics" },
]);
