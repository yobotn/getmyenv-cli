import { x25519 } from "@noble/curves/ed25519.js";
import { hkdf } from "@noble/hashes/hkdf.js";
import { sha256 } from "@noble/hashes/sha2.js";
import {
  ALGORITHM,
  CRYPTO_FORMAT_VERSION,
  DEFAULT_KDF_PARAMS,
  KDF,
  SEAL,
  type EncryptedSecretPayload,
  type SealedKey,
  type WrappedPrivateKey,
} from "./types.js";
import {
  base64ToBytes,
  base64UrlToBytes,
  bytesToBase64,
  bytesToBase64Url,
  utf8Decode,
  utf8Encode,
} from "./bytes.js";
import { assertKdfParams } from "./kdf.js";
import {
  aesGcmDecrypt,
  aesGcmEncrypt,
  assertKey,
  KEY_LENGTH,
  unwrapKeyWith,
  wipe,
  wrapKeyWith,
} from "./wrap.js";

export { wipe };

const AAD_USER_KEY = "getmyenv:v2:userkey";
const HKDF_INFO_SEAL = "getmyenv:v2:seal";

/** A fresh X25519 keypair. Used for server tokens and guest projects. */
export function generateKeypair(): { publicKey: string; privateKey: Uint8Array } {
  const privateKey = x25519.utils.randomSecretKey();
  return { publicKey: publicKeyFromPrivate(privateKey), privateKey };
}

export function publicKeyFromPrivate(privateKey: Uint8Array): string {
  assertKey(privateKey);
  return bytesToBase64(x25519.getPublicKey(privateKey));
}

/**
 * Short, comparable form of a public key: the first 10 bytes of its SHA-256,
 * as five groups of four hex digits. Two people compare it out of band.
 */
export function publicKeyFingerprint(publicKey: string): string {
  const bytes = base64ToBytes(publicKey);
  assertKey(bytes);
  const hex = Array.from(sha256(bytes).subarray(0, 10), (b) => b.toString(16).padStart(2, "0")).join("");
  return hex.toUpperCase().match(/.{4}/g)!.join(" ");
}

/** Wrap an X25519 private key with a key derived from a password. */
export async function wrapPrivateKey(
  password: string,
  privateKey: Uint8Array
): Promise<WrappedPrivateKey> {
  return wrapKeyWith(password, privateKey, AAD_USER_KEY, DEFAULT_KDF_PARAMS);
}

/** Throws when the password is wrong or the blob was changed. */
export async function unwrapPrivateKey(
  password: string,
  wrapped: WrappedPrivateKey
): Promise<Uint8Array> {
  return unwrapKeyWith(password, wrapped, AAD_USER_KEY);
}

/** New user keypair, wrapped with the Vault password. */
export async function createUserKeys(password: string): Promise<{
  publicKey: string;
  privateKey: Uint8Array;
  wrapped: WrappedPrivateKey;
}> {
  const { publicKey, privateKey } = generateKeypair();
  const wrapped = await wrapPrivateKey(password, privateKey);
  return { publicKey, privateKey, wrapped };
}

/** Change the Vault password. Context keys and values stay the same. */
export async function rewrapPrivateKey(
  oldPassword: string,
  newPassword: string,
  wrapped: WrappedPrivateKey
): Promise<WrappedPrivateKey> {
  const privateKey = await unwrapPrivateKey(oldPassword, wrapped);
  try {
    return await wrapPrivateKey(newPassword, privateKey);
  } finally {
    wipe(privateKey);
  }
}

function sealAad(contextId: number, recipientPublicKey: string): string {
  return `getmyenv:v2:ctxkey:${contextId}:${recipientPublicKey}`;
}

function sealKek(
  shared: Uint8Array,
  ephemeralPublicKey: Uint8Array,
  recipientPublicKey: Uint8Array
): Uint8Array {
  const salt = new Uint8Array(ephemeralPublicKey.length + recipientPublicKey.length);
  salt.set(ephemeralPublicKey, 0);
  salt.set(recipientPublicKey, ephemeralPublicKey.length);
  return hkdf(sha256, shared, salt, utf8Encode(HKDF_INFO_SEAL), KEY_LENGTH);
}

/** Seal a context key to one recipient. Bound to the context id and recipient key. */
export function sealContextKey(
  contextKey: Uint8Array,
  recipientPublicKey: string,
  contextId: number
): SealedKey {
  assertKey(contextKey);
  const recipient = base64ToBytes(recipientPublicKey);
  const ephemeralPrivate = x25519.utils.randomSecretKey();
  const ephemeralPublic = x25519.getPublicKey(ephemeralPrivate);
  const shared = x25519.getSharedSecret(ephemeralPrivate, recipient);
  const kek = sealKek(shared, ephemeralPublic, recipient);
  try {
    const { nonce, ciphertext } = aesGcmEncrypt(
      kek,
      contextKey,
      sealAad(contextId, recipientPublicKey)
    );
    return {
      version: CRYPTO_FORMAT_VERSION,
      algorithm: SEAL,
      ephemeralPublicKey: bytesToBase64(ephemeralPublic),
      nonce: bytesToBase64(nonce),
      ciphertext: bytesToBase64(ciphertext),
    };
  } finally {
    wipe(ephemeralPrivate, shared, kek);
  }
}

/** Open a sealed context key with the recipient's private key. */
export function openSealedKey(
  sealed: SealedKey,
  privateKey: Uint8Array,
  contextId: number
): Uint8Array {
  if (sealed.version !== CRYPTO_FORMAT_VERSION || sealed.algorithm !== SEAL) {
    throw new Error("Unsupported sealed key");
  }
  const recipientPublicKey = publicKeyFromPrivate(privateKey);
  const recipient = base64ToBytes(recipientPublicKey);
  const ephemeralPublic = base64ToBytes(sealed.ephemeralPublicKey);
  const shared = x25519.getSharedSecret(privateKey, ephemeralPublic);
  const kek = sealKek(shared, ephemeralPublic, recipient);
  try {
    const key = aesGcmDecrypt(
      kek,
      base64ToBytes(sealed.nonce),
      base64ToBytes(sealed.ciphertext),
      sealAad(contextId, recipientPublicKey)
    );
    assertKey(key);
    return key;
  } finally {
    wipe(shared, kek);
  }
}

function secretAad(name: string): string {
  return `getmyenv:v2:secret:${name}`;
}

/** Encrypt a value with its context key. Bound to the variable name. */
export function encryptSecret(
  contextKey: Uint8Array,
  name: string,
  plaintext: string
): EncryptedSecretPayload {
  assertKey(contextKey);
  const { nonce, ciphertext } = aesGcmEncrypt(
    contextKey,
    utf8Encode(plaintext),
    secretAad(name)
  );
  return {
    version: CRYPTO_FORMAT_VERSION,
    algorithm: ALGORITHM,
    nonce: bytesToBase64(nonce),
    ciphertext: bytesToBase64(ciphertext),
  };
}

/** Throws when the key is wrong, the name differs, or the payload was changed. */
export function decryptSecret(
  contextKey: Uint8Array,
  name: string,
  payload: EncryptedSecretPayload
): string {
  if (payload.version !== CRYPTO_FORMAT_VERSION || payload.algorithm !== ALGORITHM) {
    throw new Error("Unsupported secret payload");
  }
  return utf8Decode(
    aesGcmDecrypt(
      contextKey,
      base64ToBytes(payload.nonce),
      base64ToBytes(payload.ciphertext),
      secretAad(name)
    )
  );
}

function parseJsonObject(raw: string, what: string): Record<string, unknown> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(`Invalid ${what}`);
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`Invalid ${what}`);
  }
  return parsed as Record<string, unknown>;
}

function hasStrings(o: Record<string, unknown>, keys: string[]): boolean {
  return keys.every((k) => typeof o[k] === "string" && (o[k] as string).length > 0);
}

export function serializePayload(payload: EncryptedSecretPayload): string {
  return JSON.stringify(payload);
}

export function parsePayload(raw: string): EncryptedSecretPayload {
  const o = parseJsonObject(raw, "encrypted secret payload");
  if (
    o.version !== CRYPTO_FORMAT_VERSION ||
    o.algorithm !== ALGORITHM ||
    !hasStrings(o, ["nonce", "ciphertext"])
  ) {
    throw new Error("Invalid encrypted secret payload");
  }
  return o as unknown as EncryptedSecretPayload;
}

export function serializeWrappedKey(wrapped: WrappedPrivateKey): string {
  return JSON.stringify(wrapped);
}

export function parseWrappedKey(raw: string): WrappedPrivateKey {
  const o = parseJsonObject(raw, "wrapped key");
  if (
    o.version !== CRYPTO_FORMAT_VERSION ||
    o.kdf !== KDF ||
    !hasStrings(o, ["salt", "nonce", "ciphertext"]) ||
    !o.kdfParams ||
    typeof o.kdfParams !== "object"
  ) {
    throw new Error("Invalid wrapped key");
  }
  assertKdfParams(o.kdfParams as WrappedPrivateKey["kdfParams"]);
  return o as unknown as WrappedPrivateKey;
}

export function serializeSealedKey(sealed: SealedKey): string {
  return JSON.stringify(sealed);
}

export function parseSealedKey(raw: string): SealedKey {
  const o = parseJsonObject(raw, "sealed key");
  if (
    o.version !== CRYPTO_FORMAT_VERSION ||
    o.algorithm !== SEAL ||
    !hasStrings(o, ["ephemeralPublicKey", "nonce", "ciphertext"])
  ) {
    throw new Error("Invalid sealed key");
  }
  return o as unknown as SealedKey;
}

/**
 * Server tokens carry their own private key after the dot. Only the part
 * before the dot is sent to the server.
 */
export function joinServerToken(authPart: string, privateKey: Uint8Array): string {
  return `${authPart}.${bytesToBase64Url(privateKey)}`;
}

export function splitServerToken(token: string): {
  authPart: string;
  privateKey: Uint8Array | null;
} {
  const dot = token.indexOf(".");
  if (dot < 0) return { authPart: token, privateKey: null };
  const privateKey = base64UrlToBytes(token.slice(dot + 1));
  assertKey(privateKey);
  return { authPart: token.slice(0, dot), privateKey };
}
