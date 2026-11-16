import { inCategory } from "./types.js";

const STRIPE_KEYS = "https://dashboard.stripe.com/apikeys";
const LEMON = "https://app.lemonsqueezy.com/settings/api";

export const PAYMENTS_KEYS = inCategory("payments", [
  { name: "STRIPE_SECRET_KEY", provider: "Stripe", description: "Stripe secret key.", docsUrl: STRIPE_KEYS, valueHint: "Starts with sk_live_, sk_test_ or rk_", valuePattern: /^(sk|rk)_(live|test)_[A-Za-z0-9]{20,}$/, pair: ["STRIPE_PUBLISHABLE_KEY"], source: "convention" },
  { name: "STRIPE_PUBLISHABLE_KEY", provider: "Stripe", description: "Stripe publishable key for the browser.", docsUrl: STRIPE_KEYS, valueHint: "Starts with pk_live_ or pk_test_", valuePattern: /^pk_(live|test)_[A-Za-z0-9]{20,}$/, pair: ["STRIPE_SECRET_KEY"], source: "convention" },
  { name: "NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY", provider: "Stripe", description: "Stripe publishable key for Next.js.", docsUrl: STRIPE_KEYS, valueHint: "Starts with pk_live_ or pk_test_", pair: ["STRIPE_SECRET_KEY"], source: "convention" },
  { name: "STRIPE_WEBHOOK_SECRET", provider: "Stripe", description: "Signing secret for a Stripe webhook endpoint.", docsUrl: "https://dashboard.stripe.com/webhooks", valueHint: "Starts with whsec_", valuePattern: /^whsec_[A-Za-z0-9]{20,}$/, source: "convention" },
  { name: "LEMONSQUEEZY_API_KEY", provider: "Lemon Squeezy", description: "Lemon Squeezy API key.", docsUrl: LEMON, pair: ["LEMONSQUEEZY_WEBHOOK_SECRET"], source: "convention", iconSlug: "lemonsqueezy" },
  { name: "LEMONSQUEEZY_WEBHOOK_SECRET", provider: "Lemon Squeezy", description: "Signing secret for Lemon Squeezy webhooks.", docsUrl: "https://app.lemonsqueezy.com/settings/webhooks", pair: ["LEMONSQUEEZY_API_KEY"], source: "convention", iconSlug: "lemonsqueezy" },
  { name: "PADDLE_API_KEY", provider: "Paddle", description: "Paddle API key.", docsUrl: "https://vendors.paddle.com/authentication-v2", source: "convention", iconSlug: "paddle" },
]);
