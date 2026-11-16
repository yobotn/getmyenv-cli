import { gcm } from "@noble/ciphers/aes.js";
import { CRYPTO_FORMAT_VERSION, KDF, type KdfParams, type WrappedPrivateKey } from "./types.js";
import { base64ToBytes, bytesToBase64, getRandomBytes, utf8Encode } from "./bytes.js";
import { assertKdfParams, deriveKek, generateSalt } from "./kdf.js";

/** Internal. Not exported from the package index. */

export const NONCE_LENGTH = 12;
export const KEY_LENGTH = 32;

/** Overwrite key material in place. */
export function wipe(...buffers: Array<Uint8Array | null | undefined>): void {
  for (const b of buffers) b?.fill(0);
}

export function assertKey(key: Uint8Array): void {
  if (key.length !== KEY_LENGTH) throw new Error("Invalid key length");
}

export function aesGcmEncrypt(
  key: Uint8Array,
  plaintext: Uint8Array,
  aad: string
): { nonce: Uint8Array; ciphertext: Uint8Array } {
  const nonce = getRandomBytes(NONCE_LENGTH);
  const ciphertext = gcm(key, nonce, utf8Encode(aad)).encrypt(plaintext);
  return { nonce, ciphertext };
}

export function aesGcmDecrypt(
  key: Uint8Array,
  nonce: Uint8Array,
  ciphertext: Uint8Array,
  aad: string
): Uint8Array {
  return gcm(key, nonce, utf8Encode(aad)).decrypt(ciphertext);
}

/** Wrap a private key with a key derived from a secret. The AAD says which kind of secret. */
export async function wrapKeyWith(
  secret: string,
  privateKey: Uint8Array,
  aad: string,
  params: KdfParams
): Promise<WrappedPrivateKey> {
  assertKey(privateKey);
  const salt = generateSalt();
  const kek = await deriveKek(secret, salt, params);
  try {
    const { nonce, ciphertext } = aesGcmEncrypt(kek, privateKey, aad);
    return {
      version: CRYPTO_FORMAT_VERSION,
      kdf: KDF,
      kdfParams: { ...params },
      salt: bytesToBase64(salt),
      nonce: bytesToBase64(nonce),
      ciphertext: bytesToBase64(ciphertext),
    };
  } finally {
    wipe(kek);
  }
}

/** Throws when the secret is wrong, the AAD differs, or the blob was changed. */
export async function unwrapKeyWith(
  secret: string,
  wrapped: WrappedPrivateKey,
  aad: string
): Promise<Uint8Array> {
  if (wrapped.version !== CRYPTO_FORMAT_VERSION || wrapped.kdf !== KDF) {
    throw new Error("Unsupported wrapped key");
  }
  assertKdfParams(wrapped.kdfParams);
  const kek = await deriveKek(secret, base64ToBytes(wrapped.salt), wrapped.kdfParams);
  try {
    const key = aesGcmDecrypt(kek, base64ToBytes(wrapped.nonce), base64ToBytes(wrapped.ciphertext), aad);
    assertKey(key);
    return key;
  } finally {
    wipe(kek);
  }
}
