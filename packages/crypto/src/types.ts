/** Versioned getmyenv crypto protocol, shared by browser and CLI. */
export const CRYPTO_FORMAT_VERSION = 2 as const;
export const ALGORITHM = "AES-256-GCM" as const;
export const KDF = "argon2id" as const;
export const SEAL = "X25519-HKDF-SHA256-AES-256-GCM" as const;

/** Argon2id parameters (balanced for browser + CLI). */
export const DEFAULT_KDF_PARAMS = {
  memory: 64 * 1024, // KiB
  iterations: 3,
  parallelism: 1,
  hashLength: 32,
} as const;

/** Accepted Argon2id bounds. Weaker or client-crashing parameters are refused. */
export const KDF_BOUNDS = {
  memory: { min: 19_456, max: 1_048_576 },
  iterations: { min: 2, max: 10 },
  parallelism: { min: 1, max: 4 },
  hashLength: 32,
} as const;

export type KdfParams = {
  memory: number;
  iterations: number;
  parallelism: number;
  hashLength: number;
};

/**
 * A user's X25519 private key wrapped with a key derived from the Vault password.
 * Stored on the server, useless without the password.
 */
export type WrappedPrivateKey = {
  version: typeof CRYPTO_FORMAT_VERSION;
  kdf: typeof KDF;
  kdfParams: KdfParams;
  salt: string; // base64
  nonce: string; // base64
  ciphertext: string; // base64 AES-GCM(KEK, privateKey)
};

/** A context key sealed to one recipient's X25519 public key. */
export type SealedKey = {
  version: typeof CRYPTO_FORMAT_VERSION;
  algorithm: typeof SEAL;
  ephemeralPublicKey: string; // base64
  nonce: string; // base64
  ciphertext: string; // base64
};

/** Encrypted secret value payload. */
export type EncryptedSecretPayload = {
  version: typeof CRYPTO_FORMAT_VERSION;
  algorithm: typeof ALGORITHM;
  nonce: string; // base64
  ciphertext: string; // base64 (includes auth tag for GCM)
};

export const BACKUP_FORMAT_VERSION = 4 as const;

export type BackupContext = {
  /** Context id when the backup was made. Part of the sealed key's binding. */
  id: number;
  slug: string;
  name: string;
  protection: "open" | "locked";
  /** Context key sealed to the backup's public key. Null when the context had no key yet. */
  sealedKey: SealedKey | null;
};

export type BackupValue = {
  key: string;
  /** Context slug. */
  context: string;
  expiresAt: string | null;
  payload: EncryptedSecretPayload;
};

/**
 * Portable encrypted backup. Opens with the Vault password that was set when
 * it was made, or with the recovery code of that time: it carries both wraps
 * of the private key and the context keys sealed to it.
 */
export type EncryptedBackupEnvelope = {
  format: "getmyenv-backup";
  version: typeof BACKUP_FORMAT_VERSION;
  createdAt: string;
  projectName: string;
  publicKey: string;
  wrappedPrivateKey: WrappedPrivateKey;
  /** The private key wrapped with the recovery code. Null for guests and vaults without a code. */
  recoveryWrappedKey?: WrappedPrivateKey | null;
  contexts: BackupContext[];
  /** Every variable name in the project, including ones with no values. */
  keys: string[];
  /** Key name -> tag, for tagged keys only. Absent when nothing is tagged. */
  tags?: Record<string, string>;
  values: BackupValue[];
};
