import { describe, expect, it } from "vitest";
import {
  base64ToBytes,
  bytesToBase64,
  decryptSecret,
  openSealedKey,
  publicKeyFingerprint,
  publicKeyFromPrivate,
  unwrapPrivateKey,
  verifyAccessRequest,
  type EncryptedSecretPayload,
  type SealedKey,
  type WrappedPrivateKey,
} from "./index.js";

/**
 * Made with @noble/curves 1.9.7. Stored data must keep opening after any
 * dependency upgrade: a change here means existing vaults stop decrypting.
 */
const V = {
  privateKey: "AQIDBAUGBwgJCgsMDQ4PEBESExQVFhcYGRobHB0eHyA=",
  recipientPublicKey: "B6N8vBQgk8i3VdwbEOhstCY3StFqqFPtC9/AsrhtHHw=",
  fingerprint: "AAA8 FFF7 03B5 0B22 97F4",
  contextKey: "//79/Pv6+fj39vX08/Lx8O/u7ezr6uno5+bl5OPi4eA=",
  sealed: {
    version: 2,
    algorithm: "X25519-HKDF-SHA256-AES-256-GCM",
    ephemeralPublicKey: "+JjeeBstuQzePvi9B2YHJCneFPvQ4XT0FlQOu0xdHg4=",
    nonce: "dd3cGSE44mbf22qB",
    ciphertext: "KelVDERyDHM/tz//R/rOSIjdYoYZKOXg0QITZ33UqLvEhImuZ8dHn5jTtnJXbsqD",
  } as SealedKey,
  payload: {
    version: 2,
    algorithm: "AES-256-GCM",
    nonce: "js495SVLoaf8s2tQ",
    ciphertext: "dEWl9Oz4CuLBxeqjjI9SacwGDhENB9A6j2OJvEY=",
  } as EncryptedSecretPayload,
  wrapped: {
    version: 2,
    kdf: "argon2id",
    kdfParams: { memory: 65536, iterations: 3, parallelism: 1, hashLength: 32 },
    salt: "S94c5UCHnA1dP23AjIJ5dw==",
    nonce: "LVQCjZevEUNydz6q",
    ciphertext: "+NeAfBBMEFwMsgrhnsYomTXV/b+YVj3EnaAx/9ngfTgnxZhm4SW+fr767EeHUrJ9",
  } as WrappedPrivateKey,
  machinePub: "mjNgWWvCFxLAM0Wp1OnxhMCSBhns1HlbBj1PCYfPhj8=",
  signature: "ZE1OyTob09QOBlgp/bK2dibKDkYUPqlxsJJ718v71K7bFrxUTHuiFJluYPFFkMlSwWZpsFGkX0JFViozSjeFCg==",
};

describe("stored data from earlier versions", () => {
  it("derives the same X25519 public key and fingerprint", () => {
    expect(publicKeyFromPrivate(base64ToBytes(V.privateKey))).toBe(V.recipientPublicKey);
    expect(publicKeyFingerprint(V.recipientPublicKey)).toBe(V.fingerprint);
  });

  it("opens a sealed context key", () => {
    const key = openSealedKey(V.sealed, base64ToBytes(V.privateKey), 42);
    expect(bytesToBase64(key)).toBe(V.contextKey);
  });

  it("decrypts a value", () => {
    expect(decryptSecret(base64ToBytes(V.contextKey), "API_KEY", V.payload)).toBe("sk-compat-123");
  });

  it("unwraps a private key with the Vault password", async () => {
    const key = await unwrapPrivateKey("Compat-vault-pass-1", V.wrapped);
    expect(bytesToBase64(key)).toBe(V.privateKey);
  });

  it("verifies an ed25519 access request signature", () => {
    expect(verifyAccessRequest(V.machinePub, "access:42", V.signature)).toBe(true);
    expect(verifyAccessRequest(V.machinePub, "access:43", V.signature)).toBe(false);
  });
});
