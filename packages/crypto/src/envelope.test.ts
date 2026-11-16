import { describe, expect, it } from "vitest";
import {
  createUserKeys,
  unwrapPrivateKey,
  rewrapPrivateKey,
  generateKeypair,
  generateContextKey,
  sealContextKey,
  openSealedKey,
  encryptSecret,
  decryptSecret,
  parsePayload,
  serializePayload,
  parseWrappedKey,
  serializeWrappedKey,
  joinServerToken,
  splitServerToken,
  publicKeyFingerprint,
  deriveKek,
  createBackupEnvelope,
  parseBackup,
  serializeBackup,
  restoreValuesFromBackup,
  openBackupKeys,
  generateMachineIdentity,
  signAccessRequest,
  verifyAccessRequest,
  wipe,
} from "./index.js";

describe("user keys", { timeout: 30_000 }, () => {
  it("wraps and unwraps the private key with the Vault password", async () => {
    const { publicKey, privateKey, wrapped } = await createUserKeys("vault-pass");
    const opened = await unwrapPrivateKey("vault-pass", wrapped);
    expect(opened).toEqual(privateKey);
    expect(publicKey).toMatch(/^[A-Za-z0-9+/]+=*$/);
    expect(parseWrappedKey(serializeWrappedKey(wrapped))).toEqual(wrapped);
  });

  it("rejects a wrong password", async () => {
    const { wrapped } = await createUserKeys("correct");
    await expect(unwrapPrivateKey("wrong", wrapped)).rejects.toThrow();
  });

  it("changes the password without touching context keys", async () => {
    const { publicKey, wrapped } = await createUserKeys("old");
    const ck = generateContextKey();
    const sealed = sealContextKey(ck, publicKey, 7);
    const rewrapped = await rewrapPrivateKey("old", "new", wrapped);
    const priv = await unwrapPrivateKey("new", rewrapped);
    expect(openSealedKey(sealed, priv, 7)).toEqual(ck);
  });

  it("refuses weak or oversized KDF parameters", async () => {
    const { wrapped } = await createUserKeys("pw");
    const weak = { ...wrapped, kdfParams: { ...wrapped.kdfParams, memory: 8 } };
    await expect(unwrapPrivateKey("pw", weak)).rejects.toThrow("Unsupported key derivation");
    const huge = { ...wrapped, kdfParams: { ...wrapped.kdfParams, iterations: 1000 } };
    expect(() => parseWrappedKey(JSON.stringify(huge))).toThrow();
    await expect(
      deriveKek("pw", new Uint8Array(16), { memory: 64, iterations: 1, parallelism: 1, hashLength: 32 })
    ).rejects.toThrow();
  });
});

describe("sealed context keys", () => {
  it("opens only for the recipient and the same context id", () => {
    const alice = generateKeypair();
    const bob = generateKeypair();
    const ck = generateContextKey();
    const sealed = sealContextKey(ck, alice.publicKey, 42);
    expect(openSealedKey(sealed, alice.privateKey, 42)).toEqual(ck);
    expect(() => openSealedKey(sealed, bob.privateKey, 42)).toThrow();
    expect(() => openSealedKey(sealed, alice.privateKey, 43)).toThrow();
  });

  it("fails when the sealed key is changed", () => {
    const alice = generateKeypair();
    const sealed = sealContextKey(generateContextKey(), alice.publicKey, 1);
    const other = generateKeypair();
    expect(() =>
      openSealedKey({ ...sealed, ephemeralPublicKey: other.publicKey }, alice.privateKey, 1)
    ).toThrow();
  });
});

describe("secrets", () => {
  it("encrypts with the context key and binds to the name", () => {
    const ck = generateContextKey();
    const payload = encryptSecret(ck, "API_KEY", "sk-live-example");
    expect(payload.version).toBe(2);
    const roundTrip = parsePayload(serializePayload(payload));
    expect(decryptSecret(ck, "API_KEY", roundTrip)).toBe("sk-live-example");
    expect(() => decryptSecret(ck, "OTHER_KEY", payload)).toThrow();
    expect(() => decryptSecret(generateContextKey(), "API_KEY", payload)).toThrow();
  });

  it("uses a fresh nonce every time", () => {
    const ck = generateContextKey();
    const a = encryptSecret(ck, "K", "same");
    const b = encryptSecret(ck, "K", "same");
    expect(a.nonce).not.toBe(b.nonce);
    expect(a.ciphertext).not.toBe(b.ciphertext);
  });

  it("fails when ciphertext, nonce or tag are changed", () => {
    const ck = generateContextKey();
    const p = encryptSecret(ck, "K", "value");
    const flip = (b64: string, at: number) => {
      const bytes = Buffer.from(b64, "base64");
      bytes[at] = bytes[at]! ^ 1;
      return bytes.toString("base64");
    };
    expect(() => decryptSecret(ck, "K", { ...p, ciphertext: flip(p.ciphertext, 0) })).toThrow();
    expect(() => decryptSecret(ck, "K", { ...p, nonce: flip(p.nonce, 0) })).toThrow();
    const tagAt = Buffer.from(p.ciphertext, "base64").length - 1;
    expect(() => decryptSecret(ck, "K", { ...p, ciphertext: flip(p.ciphertext, tagAt) })).toThrow();
  });

  it("fails when a ciphertext is moved to another context", () => {
    const dev = generateContextKey();
    const prod = generateContextKey();
    const p = encryptSecret(dev, "K", "value");
    expect(() => decryptSecret(prod, "K", p)).toThrow();
  });

  it("rejects a bad version or algorithm", () => {
    const ck = generateContextKey();
    const p = encryptSecret(ck, "K", "v");
    expect(() => decryptSecret(ck, "K", { ...p, version: 1 as 2 })).toThrow();
    expect(() => decryptSecret(ck, "K", { ...p, algorithm: "AES-128-CBC" as "AES-256-GCM" })).toThrow();
  });

  it("rejects malformed payloads", () => {
    expect(() => parsePayload("not json")).toThrow();
    expect(() => parsePayload(JSON.stringify({ version: 1, nonce: "a", ciphertext: "b" }))).toThrow();
  });
});

describe("server tokens", () => {
  it("carries the private key after the dot", () => {
    const { privateKey } = generateKeypair();
    const token = joinServerToken("authPartXYZ", privateKey);
    const { authPart, privateKey: back } = splitServerToken(token);
    expect(authPart).toBe("authPartXYZ");
    expect(back).toEqual(privateKey);
    expect(splitServerToken("plain").privateKey).toBeNull();
  });
});

describe("public key fingerprint", () => {
  it("is stable, short and differs per key", () => {
    const a = generateKeypair().publicKey;
    const b = generateKeypair().publicKey;
    expect(publicKeyFingerprint(a)).toMatch(/^[0-9A-F]{4}( [0-9A-F]{4}){4}$/);
    expect(publicKeyFingerprint(a)).toBe(publicKeyFingerprint(a));
    expect(publicKeyFingerprint(a)).not.toBe(publicKeyFingerprint(b));
  });
});

describe("wipe", () => {
  it("zeroes buffers", () => {
    const b = new Uint8Array([1, 2, 3]);
    wipe(b, null);
    expect([...b]).toEqual([0, 0, 0]);
  });
});

describe("backup", { timeout: 30_000 }, () => {
  it("creates a portable encrypted backup and restores", async () => {
    const { publicKey, wrapped } = await createUserKeys("backup-pass");
    const dev = generateContextKey();
    const acme = generateContextKey();
    const payload = encryptSecret(dev, "API_KEY", "secret-value");
    const envelope = createBackupEnvelope({
      projectName: "my-app",
      publicKey,
      wrappedPrivateKey: wrapped,
      contexts: [
        { id: 1, slug: "development", name: "Development", protection: "open", sealedKey: sealContextKey(dev, publicKey, 1) },
        { id: 2, slug: "customer-acme", name: "Customer Acme", protection: "locked", sealedKey: sealContextKey(acme, publicKey, 2) },
      ],
      keys: ["API_KEY", "PENDING_KEY"],
      values: [{ key: "API_KEY", context: "development", expiresAt: null, payload }],
    });
    const raw = serializeBackup(envelope);
    const parsed = parseBackup(raw);
    const restored = await restoreValuesFromBackup("backup-pass", parsed);
    expect(restored.values[0]?.value).toBe("secret-value");
    expect(restored.keys).toContain("PENDING_KEY");
    expect(restored.contexts[1]?.protection).toBe("locked");
    expect(raw).not.toContain("secret-value");
    const keys = await openBackupKeys("backup-pass", parsed);
    expect(keys.get("customer-acme")).toEqual(acme);
  });

  it("rejects other backup versions", () => {
    const old = { format: "getmyenv-backup", version: 2, secrets: [] };
    expect(() => parseBackup(JSON.stringify(old))).toThrow("Unsupported backup version: 2");
    const future = { format: "getmyenv-backup", version: 5, secrets: [] };
    expect(() => parseBackup(JSON.stringify(future))).toThrow("Unsupported backup version: 5");
  });
});

describe("machine identity", () => {
  it("signs and verifies access requests", () => {
    const id = generateMachineIdentity();
    const msg = "request:abc:project:env";
    const sig = signAccessRequest(id.privateKey, msg);
    expect(verifyAccessRequest(id.publicKey, msg, sig)).toBe(true);
    expect(verifyAccessRequest(id.publicKey, "tampered", sig)).toBe(false);
  });
});
