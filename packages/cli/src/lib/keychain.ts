import { createHash } from "node:crypto";
import { VAULT_UNLOCK_MS } from "@getmyenv/shared";

/**
 * Unlocked open context keys, remembered in the OS keychain (macOS Keychain,
 * Windows Credential Manager, Linux Secret Service) for a few hours so `run`,
 * `set` and `import` on an open context do not ask for the Vault password every time.
 * Never the Vault password or the private key.
 */
const SERVICE = "getmyenv";
export const KEYCHAIN_TTL_MS = VAULT_UNLOCK_MS;

type KeyringEntry = {
  getPassword(): string | null;
  setPassword(password: string): void;
  deletePassword(): boolean;
};
export type KeyringFactory = (service: string, account: string) => KeyringEntry;

type Stored = {
  version: 2;
  expiresAt: number;
  keys: Record<string, { key: string; sealedHash: string }>;
};

export type KeyringAccounts = (service: string) => string[];

let factoryOverride: KeyringFactory | null | undefined;
let accountsOverride: KeyringAccounts | undefined;

/** Tests swap in an in-memory keyring. `null` means no keyring available. */
export function setKeyringForTests(
  factory: KeyringFactory | null | undefined,
  accounts?: KeyringAccounts
): void {
  factoryOverride = factory;
  accountsOverride = accounts;
}

async function loadFactory(): Promise<KeyringFactory | null> {
  if (factoryOverride !== undefined) return factoryOverride;
  try {
    const { Entry } = await import("@napi-rs/keyring");
    return (service, account) => new Entry(service, account);
  } catch {
    return null;
  }
}

async function loadAccounts(): Promise<KeyringAccounts | null> {
  if (factoryOverride !== undefined) return accountsOverride ?? null;
  try {
    const { findCredentials } = await import("@napi-rs/keyring");
    return (service) => findCredentials(service).map((c) => c.account);
  } catch {
    return null;
  }
}

/** Off with `GETMYENV_KEYCHAIN=0` or in CI (`CI` set to anything but `false` or `0`). */
export function keychainEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  if (env.GETMYENV_KEYCHAIN === "0") return false;
  const ci = env.CI?.trim().toLowerCase();
  if (ci && ci !== "false" && ci !== "0") return false;
  return true;
}

/** One keychain entry per server origin and project, so staging and production keys never mix. */
export function keychainAccount(apiUrl: string, projectId: string): string {
  let origin = apiUrl;
  try {
    origin = new URL(apiUrl).origin;
  } catch {
    /* keep as given */
  }
  return `${origin}|project:${projectId}`;
}

function hashSealed(sealedRaw: string): string {
  return createHash("sha256").update(sealedRaw).digest("hex");
}

async function entryFor(account: string): Promise<KeyringEntry | null> {
  const factory = await loadFactory();
  if (!factory) return null;
  try {
    return factory(SERVICE, account);
  } catch {
    return null;
  }
}

function readStored(entry: KeyringEntry, now: number): Stored | null {
  let raw: string | null;
  try {
    raw = entry.getPassword();
  } catch {
    return null;
  }
  if (!raw) return null;
  let stored: Stored;
  try {
    stored = JSON.parse(raw) as Stored;
  } catch {
    safeDelete(entry);
    return null;
  }
  if (
    stored.version !== 2 ||
    typeof stored.expiresAt !== "number" ||
    stored.expiresAt <= now ||
    !stored.keys ||
    typeof stored.keys !== "object"
  ) {
    safeDelete(entry);
    return null;
  }
  return stored;
}

/**
 * The cached key of one context, only if it has not expired and matches the
 * sealed key the server holds now. A new sealed key (rotation) misses.
 */
export async function readCachedContextKey(
  account: string,
  contextId: number,
  sealedRaw: string,
  now = Date.now()
): Promise<Uint8Array | null> {
  const entry = await entryFor(account);
  if (!entry) return null;
  const stored = readStored(entry, now);
  const hit = stored?.keys[String(contextId)];
  if (!hit || typeof hit.key !== "string" || hit.sealedHash !== hashSealed(sealedRaw)) return null;
  const key = new Uint8Array(Buffer.from(hit.key, "base64"));
  return key.length === 32 ? key : null;
}

/** Returns false when no keychain is available; the CLI then keeps asking. */
export async function storeCachedContextKeys(
  account: string,
  entries: Array<{ contextId: number; sealedRaw: string; key: Uint8Array }>,
  now = Date.now()
): Promise<boolean> {
  const entry = await entryFor(account);
  if (!entry) return false;
  const stored: Stored = {
    version: 2,
    expiresAt: now + KEYCHAIN_TTL_MS,
    keys: Object.fromEntries(
      entries.map((e) => [
        String(e.contextId),
        { key: Buffer.from(e.key).toString("base64"), sealedHash: hashSealed(e.sealedRaw) },
      ])
    ),
  };
  try {
    entry.setPassword(JSON.stringify(stored));
    return true;
  } catch {
    return false;
  }
}

/** True when an entry was removed. False when there was none or no keychain is available. */
export async function clearCachedKeys(account: string): Promise<boolean> {
  const entry = await entryFor(account);
  if (!entry) return false;
  return safeDelete(entry);
}

/**
 * Removes every getmyenv entry on this machine, for all servers and projects.
 * `fallback` accounts are cleared too, for keychains that cannot list entries.
 * Returns how many entries were removed.
 */
export async function clearAllCachedKeys(fallback: string[] = []): Promise<number> {
  let accounts: string[] = [];
  const list = await loadAccounts();
  if (list) {
    try {
      accounts = list(SERVICE);
    } catch {
      accounts = [];
    }
  }
  let removed = 0;
  for (const account of new Set([...accounts, ...fallback])) {
    if (await clearCachedKeys(account)) removed++;
  }
  return removed;
}

function safeDelete(entry: KeyringEntry): boolean {
  try {
    return entry.deletePassword();
  } catch {
    return false;
  }
}
