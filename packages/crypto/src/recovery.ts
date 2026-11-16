import { sha256 } from "@noble/hashes/sha2.js";
import type { KdfParams, WrappedPrivateKey } from "./types.js";
import { getRandomBytes } from "./bytes.js";
import { publicKeyFromPrivate } from "./envelope.js";
import { unwrapKeyWith, wipe, wrapKeyWith } from "./wrap.js";

/**
 * Recovery code: 16 random bytes and 1 checksum byte, in Crockford base32,
 * shown as 7 groups of 4. It wraps the same private key as the Vault password,
 * so either one opens the vault.
 */

const ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
const SECRET_BYTES = 16;
const CODE_CHARS = 28;
const AAD_RECOVERY_KEY = "getmyenv:v2:recoverykey";

/** The code carries 128 bits of entropy, so the lowest accepted Argon2id cost is enough. */
export const RECOVERY_KDF_PARAMS: KdfParams = {
  memory: 19_456,
  iterations: 2,
  parallelism: 1,
  hashLength: 32,
};

function checksum(secret: Uint8Array): number {
  return sha256(secret)[0]!;
}

function encode(bytes: Uint8Array): string {
  let out = "";
  let buffer = 0;
  let bits = 0;
  for (const b of bytes) {
    buffer = (buffer << 8) | b;
    bits += 8;
    while (bits >= 5) {
      out += ALPHABET[(buffer >>> (bits - 5)) & 31];
      bits -= 5;
    }
    buffer &= (1 << bits) - 1;
  }
  if (bits > 0) out += ALPHABET[(buffer << (5 - bits)) & 31];
  return out;
}

function decode(chars: string): Uint8Array | null {
  const out: number[] = [];
  let buffer = 0;
  let bits = 0;
  for (const c of chars) {
    const v = ALPHABET.indexOf(c);
    if (v < 0) return null;
    buffer = (buffer << 5) | v;
    bits += 5;
    if (bits >= 8) {
      out.push((buffer >>> (bits - 8)) & 255);
      bits -= 8;
    }
    buffer &= (1 << bits) - 1;
  }
  if (buffer !== 0) return null;
  return new Uint8Array(out);
}

function normalize(input: string): string {
  return input
    .toUpperCase()
    .replace(/[\s-]/g, "")
    .replace(/O/g, "0")
    .replace(/[IL]/g, "1");
}

/** XXXX-XXXX-... from the canonical form. */
export function formatRecoveryCode(code: string): string {
  return normalize(code).match(/.{1,4}/g)!.join("-");
}

/** A new random recovery code, formatted for display. */
export function generateRecoveryCode(): string {
  const secret = getRandomBytes(SECRET_BYTES);
  const bytes = new Uint8Array(SECRET_BYTES + 1);
  bytes.set(secret, 0);
  bytes[SECRET_BYTES] = checksum(secret);
  wipe(secret);
  const code = formatRecoveryCode(encode(bytes));
  wipe(bytes);
  return code;
}

/** True when the input has the shape of a recovery code, whether or not its checksum is right. */
export function looksLikeRecoveryCode(input: string): boolean {
  const n = normalize(input);
  return n.length === CODE_CHARS && [...n].every((c) => ALPHABET.includes(c));
}

/**
 * The canonical form (28 characters, no dashes) used as the KDF input.
 * Formatting never changes the key. Throws on a typo.
 */
export function parseRecoveryCode(input: string): string {
  const n = normalize(input);
  if (n.length !== CODE_CHARS) throw new Error(`A recovery code has ${CODE_CHARS} characters.`);
  const bytes = decode(n);
  if (!bytes || bytes.length !== SECRET_BYTES + 1) throw new Error("That recovery code has a typo.");
  const ok = checksum(bytes.subarray(0, SECRET_BYTES)) === bytes[SECRET_BYTES];
  wipe(bytes);
  if (!ok) throw new Error("That recovery code has a typo.");
  return n;
}

/** Same code, ignoring case, spaces and dashes. False when either one is not a valid code. */
export function recoveryCodesMatch(a: string, b: string): boolean {
  try {
    return parseRecoveryCode(a) === parseRecoveryCode(b);
  } catch {
    return false;
  }
}

export async function wrapWithRecoveryCode(
  code: string,
  privateKey: Uint8Array
): Promise<WrappedPrivateKey> {
  return wrapKeyWith(parseRecoveryCode(code), privateKey, AAD_RECOVERY_KEY, RECOVERY_KDF_PARAMS);
}

/** Throws "That recovery code does not open this vault." when the code is wrong. */
export async function unwrapWithRecoveryCode(
  code: string,
  wrapped: WrappedPrivateKey
): Promise<Uint8Array> {
  const canonical = parseRecoveryCode(code);
  try {
    return await unwrapKeyWith(canonical, wrapped, AAD_RECOVERY_KEY);
  } catch {
    throw new Error("That recovery code does not open this vault.");
  }
}

/** A new recovery code and the private key wrapped with it. */
export async function createRecoveryWrap(
  privateKey: Uint8Array
): Promise<{ code: string; wrapped: WrappedPrivateKey }> {
  const code = generateRecoveryCode();
  return { code, wrapped: await wrapWithRecoveryCode(code, privateKey) };
}

/**
 * Check a recovery wrap before upload: it must open with the code and hold the
 * private key of this public key. The server cannot check this.
 */
export async function assertRecoveryWrap(
  code: string,
  wrapped: WrappedPrivateKey,
  publicKey: string
): Promise<void> {
  const key = await unwrapWithRecoveryCode(code, wrapped);
  try {
    if (publicKeyFromPrivate(key) !== publicKey) {
      throw new Error("The recovery code does not match this vault key.");
    }
  } finally {
    wipe(key);
  }
}
