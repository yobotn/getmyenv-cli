import { z } from "zod";
import { NEW_MACHINE_POLICIES, PROTECTIONS } from "./constants.js";
import { MAX_CIPHERTEXT_CHARS, MAX_VALUES_PER_REQUEST } from "./facts.js";
import {
  CONTEXT_NAME_HELP,
  CONTEXT_NAME_MAX,
  CONTEXT_NAME_RE,
  CONTEXT_SLUG_RE,
  KEY_TAG_HELP,
  KEY_TAG_MAX,
  KEY_TAG_RE,
  VARIABLE_NAME_HELP,
  VARIABLE_NAME_RE,
} from "./slug.js";

export const emailSchema = z.string().email().max(320);

/** A variable name is a valid environment variable name. */
export const variableNameSchema = z
  .string()
  .min(1)
  .max(256)
  .regex(VARIABLE_NAME_RE, VARIABLE_NAME_HELP);

export const otpCodeSchema = z.string().regex(/^\d{6}$/);

export const PROJECT_DESCRIPTION_MAX = 200;

/** Empty clears the description. */
export const projectDescriptionSchema = z.string().trim().max(PROJECT_DESCRIPTION_MAX);

export const updateProjectSchema = z.object({
  name: z.string().min(1).max(120).optional(),
  description: projectDescriptionSchema.optional(),
});

/** New context order: every context id of the project, once. */
export const contextOrderSchema = z.object({
  ids: z.array(z.number().int().positive()).min(1).max(100),
});

export const newMachinePolicySchema = z.enum(NEW_MACHINE_POLICIES);

/** Numeric ID from the DB, accepted as number or numeric string. */
export const idSchema = z.coerce.number().int().positive();

export const protectionSchema = z.enum(PROTECTIONS);

export const contextNameSchema = z
  .string()
  .trim()
  .min(1, "Name is required")
  .max(CONTEXT_NAME_MAX)
  .regex(CONTEXT_NAME_RE, CONTEXT_NAME_HELP);

export const keyTagSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(1)
  .max(KEY_TAG_MAX)
  .regex(KEY_TAG_RE, KEY_TAG_HELP);

export const contextSlugSchema = z
  .string()
  .trim()
  .regex(
    CONTEXT_SLUG_RE,
    "Slug must be lowercase letters, numbers and hyphens (max 40), starting with a letter or number"
  );

export const createContextSchema = z.object({
  name: contextNameSchema,
  slug: contextSlugSchema.optional(),
  protection: protectionSchema.optional(),
});

export const updateContextSchema = z.object({
  name: contextNameSchema.optional(),
  slug: contextSlugSchema.optional(),
  protection: protectionSchema.optional(),
});

const ciphertextSchema = z.string().min(1).max(MAX_CIPHERTEXT_CHARS);

export const encryptedValueSchema = z.object({
  name: variableNameSchema,
  ciphertext: ciphertextSchema,
  /** ISO-8601 with Z/offset, or null to clear. Omit to leave unchanged. */
  expiresAt: z.string().datetime({ offset: true }).nullable().optional(),
});

/**
 * Version of the context key the client encrypted with. Every ciphertext
 * write carries it. The server refuses a stale one with code `key_changed`.
 */
export const keyVersionSchema = z.number().int().min(0);

export const setValuesSchema = z.object({
  values: z.array(encryptedValueSchema).min(1).max(MAX_VALUES_PER_REQUEST),
  keyVersion: keyVersionSchema,
});

export const declareKeysSchema = z.object({
  names: z.array(variableNameSchema).min(1).max(MAX_VALUES_PER_REQUEST),
  /** Omit to leave tags unchanged. null clears. */
  tag: keyTagSchema.nullable().optional(),
});

/** One optional tag per key, shared by every context. null clears it. */
export const setKeyTagSchema = z.object({
  names: z.array(variableNameSchema).min(1).max(MAX_VALUES_PER_REQUEST),
  tag: keyTagSchema.nullable(),
});

/**
 * Rename a key. Values are bound to the name, so the client re-encrypts every
 * value under the new name and sends one ciphertext per context that has one.
 */
export const renameKeySchema = z.object({
  from: variableNameSchema,
  to: variableNameSchema,
  values: z
    .array(
      z.object({
        contextId: idSchema,
        ciphertext: ciphertextSchema,
        keyVersion: keyVersionSchema,
      })
    )
    .max(100),
});

/** Key name -> tag, as carried in backups. */
export const keyTagsSchema = z.record(variableNameSchema, keyTagSchema).optional();

/**
 * Machine proof sent with every value read. The signature covers
 * machineProofMessage(projectId, contextSlug, publicKey, timestamp).
 */
export const machineProofSchema = z.object({
  publicKey: z.string().min(32).max(200),
  label: z.string().min(1).max(120),
  signature: z.string().min(1).max(400),
  timestamp: z.string().regex(/^\d+$/),
});

export type MachineProof = z.infer<typeof machineProofSchema>;

export function machineProofMessage(
  projectId: number | string,
  contextSlug: string,
  publicKey: string,
  timestamp: string
): string {
  return ["getmyenv", projectId, contextSlug, publicKey, timestamp].join(":");
}

/** CLI value read: context by slug, plus the machine proof. */
export const resolveValuesSchema = z.object({
  context: contextSlugSchema,
  machine: machineProofSchema,
  purpose: z.enum(["run", "export", "push"]).optional(),
});

export const loginEmailSchema = z.object({
  email: emailSchema,
});

export const verifyOtpSchema = z.object({
  email: emailSchema,
  code: otpCodeSchema,
  trustDevice: z.boolean().optional(),
});

const base64 = (min: number, max: number) =>
  z
    .string()
    .min(min)
    .max(max)
    .regex(/^[A-Za-z0-9+/]+={0,2}$/, "Must be base64");

/** X25519 public key, base64 of 32 bytes. */
export const publicKeySchema = z.string().regex(/^[A-Za-z0-9+/]{43}=$/, "Invalid public key");

export const kdfParamsSchema = z
  .object({
    memory: z.number().int().min(19_456).max(1_048_576),
    iterations: z.number().int().min(2).max(10),
    parallelism: z.number().int().min(1).max(4),
    hashLength: z.literal(32),
  })
  .strict();

export const wrappedPrivateKeySchema = z
  .object({
    version: z.literal(2),
    kdf: z.literal("argon2id"),
    kdfParams: kdfParamsSchema,
    salt: base64(16, 64),
    nonce: base64(16, 16),
    ciphertext: base64(64, 64),
  })
  .strict();

export const sealedKeySchema = z
  .object({
    version: z.literal(2),
    algorithm: z.literal("X25519-HKDF-SHA256-AES-256-GCM"),
    ephemeralPublicKey: publicKeySchema,
    nonce: base64(16, 16),
    ciphertext: base64(64, 64),
  })
  .strict();

export const encryptedSecretPayloadSchema = z
  .object({
    version: z.literal(2),
    algorithm: z.literal("AES-256-GCM"),
    nonce: base64(16, 16),
    ciphertext: base64(24, MAX_CIPHERTEXT_CHARS),
  })
  .strict();

/** A user's or guest's keypair as stored on the server. */
export const userKeysSchema = z
  .object({
    publicKey: publicKeySchema,
    wrappedPrivateKey: wrappedPrivateKeySchema,
  })
  .strict();

/** A new account vault: the keypair and the same private key wrapped with the recovery code. */
export const vaultSetupSchema = userKeysSchema
  .extend({ recoveryWrappedKey: wrappedPrivateKeySchema })
  .strict();

/**
 * First keys from the CLI: a guest sends the keypair, an account also sends
 * the recovery wrap. The server refuses an account without it.
 */
export const holderKeysSchema = userKeysSchema
  .extend({ recoveryWrappedKey: wrappedPrivateKeySchema.optional() })
  .strict();

export const vaultVersionSchema = z.number().int().min(0);

/** Change the Vault password. Same public key, new wrapped private key. */
export const vaultRewrapSchema = userKeysSchema.extend({ vaultVersion: vaultVersionSchema }).strict();

/** Recover with the recovery code, or reset: both wraps, sent with the version they replace. */
export const vaultRecoverSchema = vaultSetupSchema.extend({ vaultVersion: vaultVersionSchema }).strict();

/** Make or replace the recovery code. */
export const recoveryRotateSchema = z
  .object({
    publicKey: publicKeySchema,
    vaultVersion: vaultVersionSchema,
    recoveryWrappedKey: wrappedPrivateKeySchema,
  })
  .strict();

/** One sealed context key, by context id. */
export const contextKeyShareSchema = z
  .object({
    contextId: idSchema,
    sealedKey: sealedKeySchema,
  })
  .strict();

export const contextKeySharesSchema = z.object({
  shares: z.array(contextKeyShareSchema).min(1).max(100),
  /** The public key the shares are sealed to. Refused when it is no longer the account's. */
  publicKey: publicKeySchema,
});
