import { pcErr as pc } from "./colors.js";
import {
  createUserKeys,
  generateContextKey,
  openSealedKey,
  sealContextKey,
  splitServerToken,
  unwrapPrivateKey,
  wipe,
  type SealedKey,
  type WrappedPrivateKey,
} from "@getmyenv/crypto";
import { VAULT_UNLOCK_DURATION } from "@getmyenv/shared";
import { ApiError, type Protection } from "./api.js";
import type { Linked } from "./bootstrap.js";
import { resolveVaultPassword } from "./guest-key.js";
import {
  keychainAccount,
  keychainEnabled,
  readCachedContextKey,
  storeCachedContextKeys,
} from "./keychain.js";
import { createAccountKeys } from "./recovery-code.js";

/**
 * Context keys for the CLI.
 *
 * Folder and guest tokens: the account (or guest) private key is wrapped with
 * the Vault password (or the guest passphrase in claim.json). It is unwrapped
 * here, opens the sealed context keys, and is wiped. Open context keys may
 * stay in the OS keychain for VAULT_UNLOCK_HOURS. The private key is never stored.
 *
 * Server tokens: GETMYENV_TOKEN holds the token's own private key. It opens
 * the one context key sealed to that token. No Vault password.
 */

export type VaultContext = {
  id: number;
  slug: string;
  protection: Protection;
  hasKey: boolean;
  sealedKey: SealedKey | null;
  /** Version of the key in sealedKey. Sent back with every write. */
  keyVersion: number;
};

export type VaultInfo = {
  holder: "user" | "guest" | "token";
  publicKey: string | null;
  wrappedPrivateKey: WrappedPrivateKey | null;
  contexts: VaultContext[];
  claim: {
    publicKey: string;
    wrappedPrivateKey: WrappedPrivateKey;
    shares: Array<{ contextId: number; sealedKey: SealedKey }>;
  } | null;
};

export type KeyTarget = {
  id: number;
  slug: string;
  protection: Protection;
  /** Sealed key already sent by the server, so no extra request is needed. */
  sealedKey?: SealedKey | null;
};

export type KeyOpts = {
  /** Make the Vault password and the context key when they do not exist yet. */
  create?: boolean;
};

/** One unlock per process: several contexts in one command prompt once. */
const memo = new Map<number, Uint8Array>();
/** Key version of each memo entry opened from the vault response. Keys from the keychain have none. */
const versions = new Map<number, number>();

export function fetchVault(linked: Linked): Promise<VaultInfo> {
  return linked.client.request<VaultInfo>("GET", "/api/cli/vault");
}

/**
 * The context key and its version, for a write. The server refuses ciphertext
 * written with a key that was replaced since, so the version comes from the
 * same vault response as the sealed key.
 */
export async function writeKey(
  linked: Linked,
  target: KeyTarget
): Promise<{ key: Uint8Array; keyVersion: number }> {
  if (!versions.has(target.id)) memo.delete(target.id);
  const cached = await cachedWriteKey(linked, target);
  if (cached) return cached;
  const key = await contextKey(linked, { ...target, sealedKey: undefined }, { create: true });
  const keyVersion = versions.get(target.id);
  if (keyVersion === undefined) throw new Error(`No key version for ${target.slug}. Run the command again.`);
  return { key, keyVersion };
}

/** An open context key from the keychain, with the version from a fresh vault response. No password. */
async function cachedWriteKey(
  linked: Linked,
  target: KeyTarget
): Promise<{ key: Uint8Array; keyVersion: number } | null> {
  if (memo.has(target.id) || linked.who.token.kind === "server" || target.protection !== "open") return null;
  const account = keychainFor(linked);
  if (!account) return null;
  const ctx = (await fetchVault(linked)).contexts.find((c) => c.id === target.id);
  if (!ctx || ctx.protection !== "open" || !ctx.hasKey || !ctx.sealedKey) return null;
  const key = await readCachedContextKey(account, ctx.id, JSON.stringify(ctx.sealedKey));
  if (!key) return null;
  memo.set(ctx.id, key);
  versions.set(ctx.id, ctx.keyVersion);
  return { key, keyVersion: ctx.keyVersion };
}

/** The context key, unlocking with the Vault password when needed. */
export async function contextKey(
  linked: Linked,
  target: KeyTarget,
  opts: KeyOpts = {}
): Promise<Uint8Array> {
  const cached = memo.get(target.id);
  if (cached) return cached;

  if (linked.who.token.kind === "server") return serverContextKey(linked, target);

  const account = keychainFor(linked);
  if (account && target.protection === "open" && target.sealedKey) {
    const key = await readCachedContextKey(account, target.id, JSON.stringify(target.sealedKey));
    if (key) {
      memo.set(target.id, key);
      return key;
    }
  }

  let vault = await fetchVault(linked);
  const privateKey = await holderPrivateKey(linked, vault, opts);
  try {
    let ctx = vault.contexts.find((c) => c.id === target.id);
    if (!ctx) throw new Error(`This token cannot read ${target.slug}.`);
    const member = linked.who.token.member === true;
    if (!ctx.hasKey) {
      if (member) throw new Error(`${target.slug} has no values yet. The project owner sets the first one.`);
      if (!opts.create || ctx.protection !== "open") {
        throw new Error(`${target.slug} has no values yet.`);
      }
      vault = await initContextKey(linked, vault, ctx);
      ctx = vault.contexts.find((c) => c.id === target.id)!;
    }
    const opened = openAll(vault, privateKey);
    const key = opened.get(target.id);
    if (!key) {
      throw new Error(
        member
          ? `Waiting for the owner to send the key for ${target.slug}. It arrives the next time they unlock the vault in the dashboard.`
          : `This account has no key for ${target.slug}. If you reset your vault, reset ${target.slug} in the dashboard to set new values.`
      );
    }
    for (const [id, k] of opened) memo.set(id, k);
    for (const c of vault.contexts) {
      if (opened.has(c.id)) versions.set(c.id, c.keyVersion);
    }
    if (account) await remember(account, vault, opened);
    return key;
  } finally {
    wipe(privateKey);
  }
}

async function serverContextKey(linked: Linked, target: KeyTarget): Promise<Uint8Array> {
  const { privateKey } = splitServerToken(process.env.GETMYENV_TOKEN?.trim() ?? "");
  if (!privateKey) {
    throw new Error("This server token has no key. Create a new server token in Project settings, Tokens.");
  }
  try {
    let sealed = target.sealedKey;
    if (sealed === undefined) {
      sealed = (await fetchVault(linked)).contexts.find((c) => c.id === target.id)?.sealedKey ?? null;
    }
    if (!sealed) {
      throw new Error(`This server token has no key for ${target.slug}. Create a new server token in Project settings, Tokens.`);
    }
    const key = openSealedKey(sealed, privateKey, target.id);
    memo.set(target.id, key);
    return key;
  } finally {
    wipe(privateKey);
  }
}

/** Open contexts on a signed-in account, with a password typed at a terminal. */
function keychainFor(linked: Linked): string | null {
  if (linked.who.isGuest || !keychainEnabled()) return null;
  return keychainAccount(linked.apiUrl, linked.who.project.id);
}

async function remember(
  account: string,
  vault: VaultInfo,
  opened: Map<number, Uint8Array>
): Promise<void> {
  if (process.stdin.isTTY !== true) return;
  const entries = vault.contexts
    .filter((c) => c.protection === "open" && c.sealedKey && opened.has(c.id))
    .map((c) => ({ contextId: c.id, sealedRaw: JSON.stringify(c.sealedKey), key: opened.get(c.id)! }));
  if (entries.length === 0) return;
  if (await storeCachedContextKeys(account, entries)) {
    console.error(
      pc.dim(
        `Unlocked on this machine for ${VAULT_UNLOCK_DURATION} (OS keychain). Forget it with: npx getmyenv lock\n`
      )
    );
  }
}

function openAll(vault: VaultInfo, privateKey: Uint8Array): Map<number, Uint8Array> {
  const out = new Map<number, Uint8Array>();
  for (const c of vault.contexts) {
    if (c.sealedKey) out.set(c.id, openSealedKey(c.sealedKey, privateKey, c.id));
  }
  return out;
}

/** First key of an open context. Another client may win the race: then use theirs. */
async function initContextKey(linked: Linked, vault: VaultInfo, ctx: VaultContext): Promise<VaultInfo> {
  const key = generateContextKey();
  try {
    await linked.client.request("POST", "/api/cli/vault", {
      publicKey: vault.publicKey,
      shares: [{ contextId: ctx.id, sealedKey: sealContextKey(key, vault.publicKey!, ctx.id) }],
    });
  } catch (err) {
    if (!(err instanceof ApiError && err.status === 409)) throw err;
  } finally {
    wipe(key);
  }
  return fetchVault(linked);
}

/**
 * The holder's private key. Creates the keys on first use when allowed:
 * a new Vault password for an account, the claim.json passphrase for a guest.
 */
async function holderPrivateKey(
  linked: Linked,
  vault: VaultInfo,
  opts: KeyOpts
): Promise<Uint8Array> {
  const isGuest = vault.holder === "guest";
  if (!vault.publicKey || !vault.wrappedPrivateKey) {
    if (!opts.create) {
      throw new Error("No Vault password yet. Set it in the dashboard, or set a value: npx getmyenv set KEY");
    }
    const created = isGuest ? await createGuestKeys() : await createAccountKeys();
    try {
      await linked.client.request("POST", "/api/cli/vault", { keys: created.keys });
    } catch (err) {
      wipe(created.privateKey);
      throw err;
    }
    vault.publicKey = created.publicKey;
    vault.wrappedPrivateKey = created.keys.wrappedPrivateKey;
    return created.privateKey;
  }

  const interactive = process.stdin.isTTY && !isGuest;
  const maxAttempts = interactive ? 3 : 1;
  for (let attempt = 1; ; attempt++) {
    const password = await resolveVaultPassword({ isGuest });
    try {
      return await unwrapPrivateKey(password, vault.wrappedPrivateKey);
    } catch {
      if (isGuest) {
        throw new Error("Could not unlock with the claim.json passphrase. Check .getmyenv/claim.json against the passphrase shown at creation.");
      }
      if (attempt < maxAttempts) {
        console.error(pc.red("Wrong Vault password. Try again.\n"));
        continue;
      }
      throw new Error(
        "Could not unlock. Check your Vault password. Forgot it? Use your recovery code in the dashboard, Settings."
      );
    }
  }
}

/** Guest keys wrap with the claim.json passphrase. No recovery code. */
async function createGuestKeys(): Promise<{
  publicKey: string;
  privateKey: Uint8Array;
  keys: { publicKey: string; wrappedPrivateKey: WrappedPrivateKey };
}> {
  const created = await createUserKeys(await resolveVaultPassword({ isGuest: true, create: true }));
  return {
    publicKey: created.publicKey,
    privateKey: created.privateKey,
    keys: { publicKey: created.publicKey, wrappedPrivateKey: created.wrapped },
  };
}

/** Unlock with the Vault password and return the private key. Caller wipes it. */
export async function unlockPrivateKey(
  linked: Linked,
  opts: KeyOpts = {}
): Promise<{ vault: VaultInfo; privateKey: Uint8Array }> {
  const vault = await fetchVault(linked);
  return { vault, privateKey: await holderPrivateKey(linked, vault, opts) };
}
