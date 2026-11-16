export type KnownKeySource = "sdk" | "convention";

export const KNOWN_KEY_CATEGORIES = [
  "ai",
  "auth",
  "email",
  "payments",
  "data",
  "cloud",
  "observability",
  "messaging",
  "automation",
  "commerce",
  "content",
  "generic",
] as const;
export type KnownKeyCategory = (typeof KNOWN_KEY_CATEGORIES)[number];

export const KNOWN_KEY_CATEGORY_LABELS: Record<KnownKeyCategory, string> = {
  ai: "AI",
  auth: "Sign-in",
  email: "Email",
  payments: "Payments",
  data: "Databases and storage",
  cloud: "Cloud and deploy",
  observability: "Monitoring and analytics",
  messaging: "Chat and messaging",
  automation: "Automation and webhooks",
  commerce: "Commerce and CRM",
  content: "Content, search and maps",
  generic: "Generic",
};

export type KnownKey = {
  name: string;
  provider: string;
  category: KnownKeyCategory;
  description: string;
  /** Where to get the value. */
  docsUrl: string;
  /** Human hint about the value's shape, for example "Starts with sk-ant-". */
  valueHint?: string;
  /** Matches a pasted value. Used to suggest this name. */
  valuePattern?: RegExp;
  /** Names that usually come together, like a client id and secret. */
  pair?: string[];
  /** "sdk": the official SDK or CLI reads this name. "convention": common usage. */
  source: KnownKeySource;
  /** Simple Icons slug, when the provider name has no bundled icon. */
  iconSlug?: string;
};

export function inCategory(category: KnownKeyCategory, keys: Array<Omit<KnownKey, "category">>): KnownKey[] {
  return keys.map((k) => ({ ...k, category }));
}

/**
 * What `GET /api/known-keys` returns and the CLI caches. No timestamps or
 * editor ids. `valuePattern` is `/source/` or `/source/i`, compiled with the
 * hint pattern limits.
 */
export type KnownKeyEntry = {
  name: string;
  provider: string;
  category: KnownKeyCategory;
  description: string;
  docsUrl: string;
  valueHint: string | null;
  valuePattern: string | null;
  pair: string[];
  source: KnownKeySource;
  iconSlug: string | null;
};
