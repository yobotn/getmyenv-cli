import { describe, expect, it } from "vitest";
import {
  assertRecoveryWrap,
  createBackupEnvelope,
  createRecoveryWrap,
  createUserKeys,
  encryptSecret,
  formatRecoveryCode,
  generateContextKey,
  generateKeypair,
  generateRecoveryCode,
  looksLikeRecoveryCode,
  openBackupKeys,
  parseBackup,
  parseRecoveryCode,
  recoveryCodesMatch,
  restoreValuesFromBackup,
  sealContextKey,
  serializeBackup,
  unwrapPrivateKey,
  unwrapWithRecoveryCode,
  wrapPrivateKey,
} from "./index.js";

const ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

/** Change one character to another valid one, so only the checksum can catch it. */
function typo(code: string, at: number): string {
  const chars = code.replace(/-/g, "").split("");
  const i = ALPHABET.indexOf(chars[at]!);
  chars[at] = ALPHABET[(i + 1) % ALPHABET.length]!;
  return chars.join("");
}

describe("recovery code format", () => {
  it("is 7 groups of 4 Crockford base32 characters", () => {
    const code = generateRecoveryCode();
    expect(code).toMatch(/^[0-9A-HJKMNP-TV-Z]{4}(-[0-9A-HJKMNP-TV-Z]{4}){6}$/);
    expect(looksLikeRecoveryCode(code)).toBe(true);
    expect(parseRecoveryCode(code)).toBe(code.replace(/-/g, ""));
  });

  it("is different every time", () => {
    const codes = new Set(Array.from({ length: 50 }, () => generateRecoveryCode()));
    expect(codes.size).toBe(50);
  });

  it("accepts lowercase, spaces, missing dashes and look-alike letters", () => {
    const code = generateRecoveryCode();
    const canonical = parseRecoveryCode(code);
    expect(parseRecoveryCode(code.toLowerCase())).toBe(canonical);
    expect(parseRecoveryCode(code.replace(/-/g, " "))).toBe(canonical);
    expect(parseRecoveryCode(code.replace(/-/g, ""))).toBe(canonical);
    const lookalike = canonical.replace(/0/g, "O").replace(/1/g, "l");
    expect(parseRecoveryCode(lookalike)).toBe(canonical);
    expect(formatRecoveryCode(canonical)).toBe(code);
  });

  it("catches typos with the checksum", () => {
    const code = generateRecoveryCode();
    let caught = 0;
    for (let at = 0; at < 26; at++) {
      try {
        parseRecoveryCode(typo(code, at));
      } catch (err) {
        expect((err as Error).message).toBe("That recovery code has a typo.");
        caught++;
      }
    }
    expect(caught).toBeGreaterThanOrEqual(24);
  });

  it("refuses the wrong length and invalid characters", () => {
    expect(() => parseRecoveryCode("ABCD-EFGH")).toThrow("A recovery code has 28 characters.");
    expect(() => parseRecoveryCode("U".repeat(28))).toThrow("That recovery code has a typo.");
    expect(looksLikeRecoveryCode("correct horse battery staple")).toBe(false);
  });

  it("matches the same code in any formatting", () => {
    const code = generateRecoveryCode();
    expect(recoveryCodesMatch(code, code.toLowerCase().replace(/-/g, ""))).toBe(true);
    expect(recoveryCodesMatch(code, generateRecoveryCode())).toBe(false);
    expect(recoveryCodesMatch(code, "nope")).toBe(false);
  });
});

describe("recovery wrap", { timeout: 30_000 }, () => {
  it("opens the same private key as the Vault password", async () => {
    const { publicKey, privateKey, wrapped } = await createUserKeys("vault-pass");
    const recovery = await createRecoveryWrap(privateKey);
    const opened = await unwrapWithRecoveryCode(recovery.code.toLowerCase(), recovery.wrapped);
    expect(opened).toEqual(await unwrapPrivateKey("vault-pass", wrapped));
    await expect(assertRecoveryWrap(recovery.code, recovery.wrapped, publicKey)).resolves.toBeUndefined();
  });

  it("uses the lowest accepted Argon2id cost", async () => {
    const { privateKey } = generateKeypair();
    const { wrapped } = await createRecoveryWrap(privateKey);
    expect(wrapped.kdfParams).toEqual({ memory: 19_456, iterations: 2, parallelism: 1, hashLength: 32 });
  });

  it("refuses a wrong code", async () => {
    const { privateKey } = generateKeypair();
    const { wrapped } = await createRecoveryWrap(privateKey);
    await expect(unwrapWithRecoveryCode(generateRecoveryCode(), wrapped)).rejects.toThrow(
      "That recovery code does not open this vault."
    );
  });

  it("never swaps with a password wrap (separate AAD)", async () => {
    const { privateKey } = generateKeypair();
    const code = generateRecoveryCode();
    const canonical = parseRecoveryCode(code);
    const passwordWrap = await wrapPrivateKey(canonical, privateKey);
    await expect(unwrapWithRecoveryCode(code, passwordWrap)).rejects.toThrow();
    const recoveryWrap = (await createRecoveryWrap(privateKey)).wrapped;
    await expect(unwrapPrivateKey(canonical, recoveryWrap)).rejects.toThrow();
  });

  it("assertRecoveryWrap refuses a wrap of another key", async () => {
    const a = generateKeypair();
    const b = generateKeypair();
    const recovery = await createRecoveryWrap(b.privateKey);
    await expect(assertRecoveryWrap(recovery.code, recovery.wrapped, a.publicKey)).rejects.toThrow(
      "The recovery code does not match this private key."
    );
  });
});

describe("backup with a recovery code", { timeout: 60_000 }, () => {
  async function makeBackup(withRecovery: boolean) {
    const { publicKey, privateKey, wrapped } = await createUserKeys("backup-pass");
    const recovery = withRecovery ? await createRecoveryWrap(privateKey) : null;
    const dev = generateContextKey();
    const envelope = createBackupEnvelope({
      projectName: "my-app",
      publicKey,
      wrappedPrivateKey: wrapped,
      recoveryWrappedKey: recovery?.wrapped ?? null,
      contexts: [
        { id: 1, slug: "development", name: "Development", protection: "open", sealedKey: sealContextKey(dev, publicKey, 1) },
      ],
      keys: ["API_KEY"],
      values: [{ key: "API_KEY", context: "development", expiresAt: null, payload: encryptSecret(dev, "API_KEY", "secret-value") }],
    });
    return { envelope: parseBackup(serializeBackup(envelope)), code: recovery?.code ?? null, dev };
  }

  it("writes v4 and opens with the Vault password or the recovery code", async () => {
    const { envelope, code, dev } = await makeBackup(true);
    expect(envelope.version).toBe(4);
    expect((await restoreValuesFromBackup("backup-pass", envelope)).values[0]?.value).toBe("secret-value");
    expect((await restoreValuesFromBackup(code!, envelope)).values[0]?.value).toBe("secret-value");
    expect((await openBackupKeys(code!.toLowerCase(), envelope)).get("development")).toEqual(dev);
  });

  it("refuses another recovery code", async () => {
    const { envelope } = await makeBackup(true);
    await expect(openBackupKeys(generateRecoveryCode(), envelope)).rejects.toThrow(
      "That recovery code does not open this backup."
    );
  });

  it("a backup without a code opens with the password and explains a code", async () => {
    const { envelope, code } = await makeBackup(false);
    expect(code).toBeNull();
    expect(envelope.recoveryWrappedKey).toBeNull();
    expect((await restoreValuesFromBackup("backup-pass", envelope)).values).toHaveLength(1);
    await expect(openBackupKeys(generateRecoveryCode(), envelope)).rejects.toThrow(
      "This backup has no recovery code. Use the Vault password it was made with."
    );
  });

  it("refuses a v3 backup", async () => {
    const { envelope } = await makeBackup(false);
    const { recoveryWrappedKey: _, ...rest } = envelope;
    expect(() => parseBackup(JSON.stringify({ ...rest, version: 3 }))).toThrow("Unsupported backup version: 3");
  });
});
