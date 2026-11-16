import { inCategory } from "./types.js";

const GOOGLE_CREDENTIALS = "https://console.cloud.google.com/apis/credentials";
const GITHUB_OAUTH = "https://github.com/settings/developers";
const CLERK_KEYS = "https://dashboard.clerk.com/last-active?path=api-keys";
const AUTHJS = "https://authjs.dev/getting-started/installation";
const AUTH0 = "https://auth0.com/docs/quickstart/webapp/nextjs";
const BETTER_AUTH = "https://www.better-auth.com/docs/installation";

export const AUTH_KEYS = inCategory("auth", [
  { name: "GOOGLE_CLIENT_ID", provider: "Google OAuth", description: "OAuth client id.", docsUrl: GOOGLE_CREDENTIALS, valueHint: "Ends with .apps.googleusercontent.com", valuePattern: /^[0-9]+-[a-z0-9]+\.apps\.googleusercontent\.com$/, pair: ["GOOGLE_CLIENT_SECRET"], source: "convention" },
  { name: "GOOGLE_CLIENT_SECRET", provider: "Google OAuth", description: "OAuth client secret.", docsUrl: GOOGLE_CREDENTIALS, valueHint: "Starts with GOCSPX-", valuePattern: /^GOCSPX-[A-Za-z0-9_-]{20,}$/, pair: ["GOOGLE_CLIENT_ID"], source: "convention" },
  { name: "AUTH_GOOGLE_ID", provider: "Auth.js", description: "Google OAuth client id, read by Auth.js.", docsUrl: AUTHJS, pair: ["AUTH_GOOGLE_SECRET"], source: "sdk" },
  { name: "AUTH_GOOGLE_SECRET", provider: "Auth.js", description: "Google OAuth client secret, read by Auth.js.", docsUrl: AUTHJS, pair: ["AUTH_GOOGLE_ID"], source: "sdk" },
  { name: "GITHUB_CLIENT_ID", provider: "GitHub OAuth", description: "OAuth app client id.", docsUrl: GITHUB_OAUTH, pair: ["GITHUB_CLIENT_SECRET"], source: "convention" },
  { name: "GITHUB_CLIENT_SECRET", provider: "GitHub OAuth", description: "OAuth app client secret.", docsUrl: GITHUB_OAUTH, pair: ["GITHUB_CLIENT_ID"], source: "convention" },
  { name: "AUTH_GITHUB_ID", provider: "Auth.js", description: "GitHub OAuth client id, read by Auth.js.", docsUrl: AUTHJS, pair: ["AUTH_GITHUB_SECRET"], source: "sdk" },
  { name: "AUTH_GITHUB_SECRET", provider: "Auth.js", description: "GitHub OAuth client secret, read by Auth.js.", docsUrl: AUTHJS, pair: ["AUTH_GITHUB_ID"], source: "sdk" },
  { name: "AUTH_SECRET", provider: "Auth.js", description: "Secret that signs Auth.js sessions.", docsUrl: AUTHJS, valueHint: "32 random bytes, base64", source: "sdk" },
  { name: "AUTH_URL", provider: "Auth.js", description: "The app's public URL, when Auth.js cannot infer it.", docsUrl: "https://authjs.dev/getting-started/deployment#auth_url", valueHint: "An https URL", source: "sdk" },
  { name: "NEXTAUTH_SECRET", provider: "NextAuth.js", description: "Secret that signs NextAuth.js v4 sessions.", docsUrl: "https://next-auth.js.org/configuration/options#secret", source: "sdk" },
  { name: "NEXTAUTH_URL", provider: "NextAuth.js", description: "The app's public URL for NextAuth.js v4.", docsUrl: "https://next-auth.js.org/configuration/options#nextauth_url", valueHint: "An https URL", source: "sdk" },
  { name: "CLERK_SECRET_KEY", provider: "Clerk", description: "Clerk secret key.", docsUrl: CLERK_KEYS, valueHint: "Starts with sk_live_ or sk_test_", valuePattern: /^sk_(live|test)_[A-Za-z0-9]{20,}$/, pair: ["NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY"], source: "sdk" },
  { name: "NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY", provider: "Clerk", description: "Clerk publishable key for Next.js.", docsUrl: CLERK_KEYS, valueHint: "Starts with pk_live_ or pk_test_", pair: ["CLERK_SECRET_KEY"], source: "sdk" },
  { name: "AUTH0_SECRET", provider: "Auth0", description: "Secret that encrypts the Auth0 session cookie.", docsUrl: AUTH0, valueHint: "32 random bytes, hex", pair: ["AUTH0_DOMAIN", "AUTH0_CLIENT_ID", "AUTH0_CLIENT_SECRET"], source: "sdk", iconSlug: "auth0" },
  { name: "AUTH0_DOMAIN", provider: "Auth0", description: "Auth0 tenant domain.", docsUrl: AUTH0, valueHint: "<tenant>.auth0.com", pair: ["AUTH0_CLIENT_ID"], source: "sdk", iconSlug: "auth0" },
  { name: "AUTH0_CLIENT_ID", provider: "Auth0", description: "Auth0 application client id.", docsUrl: AUTH0, pair: ["AUTH0_CLIENT_SECRET"], source: "sdk", iconSlug: "auth0" },
  { name: "AUTH0_CLIENT_SECRET", provider: "Auth0", description: "Auth0 application client secret.", docsUrl: AUTH0, pair: ["AUTH0_CLIENT_ID"], source: "sdk", iconSlug: "auth0" },
  { name: "BETTER_AUTH_SECRET", provider: "Better Auth", description: "Secret that signs Better Auth sessions.", docsUrl: BETTER_AUTH, valueHint: "32 random bytes or more", pair: ["BETTER_AUTH_URL"], source: "sdk" },
  { name: "BETTER_AUTH_URL", provider: "Better Auth", description: "The app's base URL for Better Auth.", docsUrl: BETTER_AUTH, valueHint: "An https URL", pair: ["BETTER_AUTH_SECRET"], source: "sdk" },
]);
