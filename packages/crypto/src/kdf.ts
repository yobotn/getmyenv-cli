import { argon2id } from "hash-wasm";
import { DEFAULT_KDF_PARAMS, KDF_BOUNDS, type KdfParams } from "./types.js";
import { getRandomBytes } from "./bytes.js";

/** Throw when Argon2id parameters are outside KDF_BOUNDS. */
export function assertKdfParams(params: KdfParams): void {
  const inRange = (v: number, r: { min: number; max: number }) =>
    Number.isInteger(v) && v >= r.min && v <= r.max;
  if (
    !inRange(params.memory, KDF_BOUNDS.memory) ||
    !inRange(params.iterations, KDF_BOUNDS.iterations) ||
    !inRange(params.parallelism, KDF_BOUNDS.parallelism) ||
    params.hashLength !== KDF_BOUNDS.hashLength
  ) {
    throw new Error("Unsupported key derivation parameters");
  }
}

/**
 * Derive a Key Encryption Key (KEK) from a Vault password using Argon2id.
 */
export async function deriveKek(
  password: string,
  salt: Uint8Array,
  params: KdfParams = DEFAULT_KDF_PARAMS
): Promise<Uint8Array> {
  assertKdfParams(params);
  const hash = await argon2id({
    password,
    salt,
    parallelism: params.parallelism,
    iterations: params.iterations,
    memorySize: params.memory,
    hashLength: params.hashLength,
    outputType: "binary",
  });
  return hash instanceof Uint8Array ? hash : new Uint8Array(hash);
}

export function generateSalt(length = 16): Uint8Array {
  return getRandomBytes(length);
}

/** A random 32-byte key for one context. */
export function generateContextKey(): Uint8Array {
  return getRandomBytes(32);
}
