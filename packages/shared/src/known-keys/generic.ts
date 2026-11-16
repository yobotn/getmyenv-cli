import { inCategory } from "./types.js";

const VARIABLES = "https://getmyenv.com/docs/variables";

export const GENERIC_KEYS = inCategory("generic", [
  { name: "API_KEY", provider: "Generic", description: "An API key for your own service.", docsUrl: VARIABLES, source: "convention" },
  { name: "JWT_SECRET", provider: "Generic", description: "Secret that signs JSON Web Tokens.", docsUrl: VARIABLES, valueHint: "32 random bytes or more", source: "convention" },
  { name: "SESSION_SECRET", provider: "Generic", description: "Secret that signs session cookies.", docsUrl: VARIABLES, valueHint: "32 random bytes or more", source: "convention" },
  { name: "ENCRYPTION_KEY", provider: "Generic", description: "Key your app uses to encrypt data.", docsUrl: VARIABLES, valueHint: "32 random bytes or more", source: "convention" },
  { name: "WEBHOOK_SECRET", provider: "Generic", description: "Secret that verifies incoming webhooks.", docsUrl: VARIABLES, source: "convention" },
  { name: "CRON_SECRET", provider: "Generic", description: "Secret that protects scheduled job endpoints.", docsUrl: "https://vercel.com/docs/cron-jobs/manage-cron-jobs#securing-cron-jobs", valueHint: "16 random characters or more", source: "convention" },
  { name: "APP_URL", provider: "Generic", description: "The app's public URL.", docsUrl: VARIABLES, valueHint: "An https URL", source: "convention" },
  { name: "NEXT_PUBLIC_APP_URL", provider: "Generic", description: "The app's public URL for the Next.js browser bundle.", docsUrl: VARIABLES, valueHint: "An https URL", source: "convention" },
  { name: "PORT", provider: "Generic", description: "Port the server listens on.", docsUrl: VARIABLES, valueHint: "A number, for example 3000", valuePattern: /^\d{2,5}$/, source: "convention" },
  { name: "NODE_ENV", provider: "Generic", description: "Node.js mode: development, production or test.", docsUrl: "https://nodejs.org/en/learn/getting-started/nodejs-the-difference-between-development-and-production", valueHint: "development, production or test", source: "convention" },
]);
