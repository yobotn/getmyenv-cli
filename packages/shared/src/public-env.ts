import { KNOWN_KEYS } from "./known-keys.js";

/**
 * Name prefixes that frameworks inline into the browser bundle at build time.
 * getmyenv does not decide what is safe to expose. Push uses this to pick the
 * platform's variable type, and the hints below use it to catch mistakes.
 */
export const PUBLIC_ENV_PREFIXES = [
  "NEXT_PUBLIC_",
  "VITE_",
  "PUBLIC_",
  "NUXT_PUBLIC_",
  "REACT_APP_",
  "EXPO_PUBLIC_",
  "GATSBY_",
] as const;

export function isPublicEnvName(name: string): boolean {
  const upper = name.toUpperCase();
  return PUBLIC_ENV_PREFIXES.some((p) => upper.startsWith(p));
}

const SECRET_NAME_WORDS = /(SECRET|PRIVATE|PASSWORD)/;
const SECRET_KEY_NAMES = /(SECRET|TOKEN|PRIVATE|PASSWORD|API_KEY|SERVICE_ROLE|ACCESS_KEY)/;
/** A URL with a password in it, like postgres://user:pass@host/db. */
const URL_WITH_PASSWORD = /^[a-z][a-z0-9+.-]*:\/\/[^/\s:@]+:[^@\s]+@/i;
const MAX_CHECKED_VALUE = 512;

/** Bundled patterns only. Known keys from the database never feed this check. */
const SECRET_PATTERNS: RegExp[] = KNOWN_KEYS.filter(
  (k) => k.valuePattern && !isPublicEnvName(k.name) && SECRET_KEY_NAMES.test(k.name)
).map((k) => k.valuePattern as RegExp);

function looksSecret(value: string): boolean {
  const v = value.trim();
  if (v.length < 8 || v.length > MAX_CHECKED_VALUE) return false;
  return URL_WITH_PASSWORD.test(v) || SECRET_PATTERNS.some((p) => p.test(v));
}

/**
 * A hint for a public-prefix name that holds what looks like a secret.
 * Never blocks. Values are checked on the device only.
 */
export function publicSecretWarning(name: string, value?: string): string | null {
  if (!isPublicEnvName(name)) return null;
  const exposed = `${name} is exposed to the browser because its name uses a public prefix.`;
  if (value !== undefined && looksSecret(value)) return `${exposed} Its value also looks like a secret.`;
  if (SECRET_NAME_WORDS.test(name.toUpperCase())) return `${exposed} Its name says it is a secret.`;
  return null;
}
