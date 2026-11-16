/** Production API default. Persist apiUrl on disk only when different. */
export const PRODUCTION_API = "https://getmyenv.com";

export function normalizeApiBase(url: string): string {
  return url.trim().replace(/\/$/, "");
}

/** True when url is the production default (nothing to persist on disk). */
export function isDefaultApiUrl(url: string | undefined | null): boolean {
  if (!url?.trim()) return true;
  return normalizeApiBase(url) === PRODUCTION_API;
}

/** Persist only when different from production. */
export function apiUrlForDisk(
  url: string | undefined | null
): string | undefined {
  if (!url?.trim() || isDefaultApiUrl(url)) return undefined;
  return normalizeApiBase(url);
}

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

export function isLocalHost(hostname: string): boolean {
  return LOCAL_HOSTS.has(hostname.toLowerCase());
}

/** https anywhere, http only for localhost. Returns the parsed URL or null. */
export function parseSafeUrl(raw: string): URL | null {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return null;
  }
  if (url.username || url.password) return null;
  if (url.protocol === "https:") return url;
  if (url.protocol === "http:" && isLocalHost(url.hostname)) return url;
  return null;
}

/** GETMYENV_PUSH_API_URL replaces the Vercel or Netlify API base, for tests. */
export function pushApiBase(fallback: string, env = process.env.GETMYENV_PUSH_API_URL): string {
  const raw = env?.trim();
  if (!raw) return fallback;
  if (!parseSafeUrl(raw)) {
    throw new Error(`Refusing GETMYENV_PUSH_API_URL ${raw}. Use https, or http://localhost for local tests.`);
  }
  return normalizeApiBase(raw);
}

/**
 * Pick the API base: --api-url, then GETMYENV_API_URL, then the gitignored
 * token.json, then production. project.json is committed, so it is never read.
 */
export function pickApiUrl(sources: {
  override?: string;
  env?: string;
  tokenFile?: string;
}): string {
  const raw =
    sources.override?.trim() || sources.env?.trim() || sources.tokenFile?.trim() || PRODUCTION_API;
  if (!parseSafeUrl(raw)) {
    throw new Error(`Refusing API URL ${raw}. Use https, or http://localhost for local development.`);
  }
  return normalizeApiBase(raw);
}
