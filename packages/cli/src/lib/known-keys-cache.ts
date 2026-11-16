/**
 * Staff additions to the known keys list, and the defaults staff turned off,
 * cached in the config dir and refreshed once a day. Any failure keeps the
 * bundled list.
 */

import fs from "node:fs";
import path from "node:path";
import { BUNDLED_KNOWN_KEYS, createKnownKeyIndex, KNOWN_KEYS, type KnownKeyIndex } from "@getmyenv/shared";
import { getConfigDir } from "./fs.js";

const CACHE_FILE = "known-keys.json";
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const FETCH_TIMEOUT_MS = 2000;
const MAX_BODY_CHARS = 2 * 1024 * 1024;

type CacheFile = {
  apiUrl: string;
  etag: string | null;
  checkedAt: string;
  entries: unknown[];
  disabled: unknown[];
};

let index: KnownKeyIndex | null = null;

function cachePath(): string {
  return path.join(getConfigDir(), CACHE_FILE);
}

function readCache(): CacheFile | null {
  try {
    const data = JSON.parse(fs.readFileSync(cachePath(), "utf8")) as Partial<CacheFile>;
    if (
      typeof data.apiUrl !== "string" ||
      typeof data.checkedAt !== "string" ||
      !Array.isArray(data.entries) ||
      !Array.isArray(data.disabled)
    ) {
      return null;
    }
    return {
      apiUrl: data.apiUrl,
      etag: typeof data.etag === "string" ? data.etag : null,
      checkedAt: data.checkedAt,
      entries: data.entries,
      disabled: data.disabled,
    };
  } catch {
    return null;
  }
}

function writeCache(data: CacheFile): void {
  try {
    fs.writeFileSync(cachePath(), JSON.stringify(data), { mode: 0o600 });
  } catch {
    /* keep going without a cache */
  }
}

/** The bundled list plus the cached additions. No network. */
export function knownKeys(): KnownKeyIndex {
  if (index) return index;
  const cached = readCache();
  index =
    cached && (cached.entries.length || cached.disabled.length)
      ? createKnownKeyIndex(KNOWN_KEYS, cached.entries, cached.disabled)
      : BUNDLED_KNOWN_KEYS;
  return index;
}

/**
 * Refresh the cache when it is older than a day or from another server.
 * Waits at most 2 seconds. Never throws.
 */
export async function refreshKnownKeys(apiUrl: string): Promise<void> {
  if (!apiUrl) return;
  const cached = readCache();
  const same = cached && cached.apiUrl === apiUrl ? cached : null;
  if (same && Date.now() - new Date(same.checkedAt).getTime() < CACHE_TTL_MS) return;
  try {
    const res = await fetch(`${apiUrl}/api/known-keys`, {
      headers: same?.etag ? { "If-None-Match": same.etag } : {},
      redirect: "error",
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    const checkedAt = new Date().toISOString();
    if (res.status === 304 && same) {
      writeCache({ ...same, checkedAt });
      return;
    }
    if (!res.ok) return;
    const text = await res.text();
    if (text.length > MAX_BODY_CHARS) return;
    const data = JSON.parse(text) as { entries?: unknown; disabled?: unknown };
    if (!Array.isArray(data.entries)) return;
    writeCache({
      apiUrl,
      etag: res.headers.get("etag"),
      checkedAt,
      entries: data.entries,
      disabled: Array.isArray(data.disabled) ? data.disabled : [],
    });
    index = null;
  } catch {
    /* fail open: bundled or stale cache */
  }
}

/** Tests only. */
export function resetKnownKeysForTests(): void {
  index = null;
}
