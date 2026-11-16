import type {
  BackupContext,
  BackupValue,
  EncryptedBackupEnvelope,
  WrappedPrivateKey,
} from "./types.js";
import { BACKUP_FORMAT_VERSION } from "./types.js";
import {
  decryptSecret,
  openSealedKey,
  parseSealedKey,
  parseWrappedKey,
  publicKeyFromPrivate,
  unwrapPrivateKey,
  wipe,
} from "./envelope.js";
import { looksLikeRecoveryCode, parseRecoveryCode, unwrapWithRecoveryCode } from "./recovery.js";

export function createBackupEnvelope(input: {
  projectName: string;
  publicKey: string;
  wrappedPrivateKey: WrappedPrivateKey;
  recoveryWrappedKey?: WrappedPrivateKey | null;
  contexts: BackupContext[];
  keys: string[];
  tags?: Record<string, string>;
  values: BackupValue[];
}): EncryptedBackupEnvelope {
  const hasTags = input.tags && Object.keys(input.tags).length > 0;
  return {
    format: "getmyenv-backup",
    version: BACKUP_FORMAT_VERSION,
    createdAt: new Date().toISOString(),
    projectName: input.projectName,
    publicKey: input.publicKey,
    wrappedPrivateKey: input.wrappedPrivateKey,
    recoveryWrappedKey: input.recoveryWrappedKey ?? null,
    contexts: input.contexts,
    keys: input.keys,
    ...(hasTags ? { tags: input.tags } : {}),
    values: input.values,
  };
}

export function serializeBackup(envelope: EncryptedBackupEnvelope): string {
  return JSON.stringify(envelope, null, 2);
}

export function parseBackup(raw: string): EncryptedBackupEnvelope {
  const parsed = JSON.parse(raw) as Record<string, unknown>;
  if (parsed.format !== "getmyenv-backup") {
    throw new Error("Not a getmyenv backup file");
  }
  if (parsed.version !== BACKUP_FORMAT_VERSION) {
    throw new Error(`Unsupported backup version: ${String(parsed.version)}`);
  }
  if (
    typeof parsed.projectName !== "string" ||
    typeof parsed.publicKey !== "string" ||
    !Array.isArray(parsed.contexts) ||
    !Array.isArray(parsed.keys) ||
    !Array.isArray(parsed.values)
  ) {
    throw new Error("Invalid backup file");
  }
  parseWrappedKey(JSON.stringify(parsed.wrappedPrivateKey));
  if (parsed.recoveryWrappedKey != null) {
    parseWrappedKey(JSON.stringify(parsed.recoveryWrappedKey));
  }
  for (const c of parsed.contexts as BackupContext[]) {
    if (!Number.isInteger(c.id) || typeof c.slug !== "string") {
      throw new Error("Invalid backup file");
    }
    if (c.sealedKey !== null) parseSealedKey(JSON.stringify(c.sealedKey));
  }
  return parsed as unknown as EncryptedBackupEnvelope;
}

function recoveryCodeOrNull(secret: string): string | null {
  if (!looksLikeRecoveryCode(secret)) return null;
  try {
    return parseRecoveryCode(secret);
  } catch {
    return null;
  }
}

/** The backup's private key, from the Vault password or the recovery code it was made with. */
async function openBackupPrivateKey(
  secret: string,
  envelope: EncryptedBackupEnvelope
): Promise<Uint8Array> {
  const code = recoveryCodeOrNull(secret);
  if (code && envelope.recoveryWrappedKey) {
    try {
      return await unwrapWithRecoveryCode(code, envelope.recoveryWrappedKey);
    } catch {
      throw new Error("That recovery code does not open this backup.");
    }
  }
  try {
    return await unwrapPrivateKey(secret, envelope.wrappedPrivateKey);
  } catch (err) {
    if (code) {
      throw new Error("This backup has no recovery code. Use the Vault password it was made with.");
    }
    throw err;
  }
}

/**
 * Open every context key in a backup with the Vault password or the recovery
 * code it was made with. Keyed by context slug. Caller wipes the returned keys.
 */
export async function openBackupKeys(
  secret: string,
  envelope: EncryptedBackupEnvelope
): Promise<Map<string, Uint8Array>> {
  const privateKey = await openBackupPrivateKey(secret, envelope);
  try {
    if (publicKeyFromPrivate(privateKey) !== envelope.publicKey) {
      throw new Error("Backup key mismatch");
    }
    const keys = new Map<string, Uint8Array>();
    for (const c of envelope.contexts) {
      if (c.sealedKey) keys.set(c.slug, openSealedKey(c.sealedKey, privateKey, c.id));
    }
    return keys;
  } finally {
    wipe(privateKey);
  }
}

/**
 * Decrypt every value in a backup with the Vault password or the recovery code.
 * Works without getmyenv being reachable.
 */
export async function restoreValuesFromBackup(
  secret: string,
  envelope: EncryptedBackupEnvelope
): Promise<{
  contexts: BackupContext[];
  keys: string[];
  values: Array<{
    key: string;
    context: string;
    value: string;
    expiresAt: string | null;
  }>;
}> {
  const contextKeys = await openBackupKeys(secret, envelope);
  try {
    return {
      contexts: envelope.contexts,
      keys: envelope.keys,
      values: envelope.values.map((v) => {
        const key = contextKeys.get(v.context);
        if (!key) throw new Error(`Backup has no key for context ${v.context}`);
        return {
          key: v.key,
          context: v.context,
          value: decryptSecret(key, v.key, v.payload),
          expiresAt: v.expiresAt,
        };
      }),
    };
  } finally {
    wipe(...contextKeys.values());
  }
}
