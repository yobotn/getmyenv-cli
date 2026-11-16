import { describe, expect, it } from "vitest";
import {
  createBackupEnvelope,
  createRecoveryWrap,
  createUserKeys,
  decryptSecret,
  encryptSecret,
  generateContextKey,
  openBackupKeys,
  openSealedKey,
  parseBackup,
  restoreValuesFromBackup,
  rewrapPrivateKey,
  sealContextKey,
  serializeBackup,
  unwrapWithRecoveryCode,
  wrapPrivateKey,
  type EncryptedBackupEnvelope,
  type WrappedPrivateKey,
} from "./index.js";

/**
 * A backup holds the private key wrapped as it was when the backup was made.
 * These tests change the vault after a backup and check what still opens it.
 */

type Vault = {
  password: string;
  publicKey: string;
  privateKey: Uint8Array;
  passwordWrap: WrappedPrivateKey;
  code: string | null;
  recoveryWrap: WrappedPrivateKey | null;
};

const CONTEXT_ID = 1;
const VALUE = "sk_live_backup_value";

async function newVault(password: string, withCode: boolean): Promise<Vault> {
  const { publicKey, privateKey, wrapped } = await createUserKeys(password);
  const recovery = withCode ? await createRecoveryWrap(privateKey) : null;
  return {
    password,
    publicKey,
    privateKey,
    passwordWrap: wrapped,
    code: recovery?.code ?? null,
    recoveryWrap: recovery?.wrapped ?? null,
  };
}

function backupOf(vault: Vault, contextKey: Uint8Array): EncryptedBackupEnvelope {
  const envelope = createBackupEnvelope({
    projectName: "my-app",
    publicKey: vault.publicKey,
    wrappedPrivateKey: vault.passwordWrap,
    recoveryWrappedKey: vault.recoveryWrap,
    contexts: [
      {
        id: CONTEXT_ID,
        slug: "production",
        name: "Production",
        protection: "locked",
        sealedKey: sealContextKey(contextKey, vault.publicKey, CONTEXT_ID),
      },
    ],
    keys: ["API_KEY"],
    values: [{ key: "API_KEY", context: "production", expiresAt: null, payload: encryptSecret(contextKey, "API_KEY", VALUE) }],
  });
  return parseBackup(serializeBackup(envelope));
}

async function opens(secret: string, backup: EncryptedBackupEnvelope): Promise<boolean> {
  try {
    const { values } = await restoreValuesFromBackup(secret, backup);
    return values[0]?.value === VALUE;
  } catch {
    return false;
  }
}

describe("backups after the vault changes", { timeout: 180_000 }, () => {
  it("a backup made before recovery codes opens with its Vault password only", async () => {
    const vault = await newVault("pass-1", false);
    const backup = backupOf(vault, generateContextKey());
    const later = await createRecoveryWrap(vault.privateKey);

    expect(await opens("pass-1", backup)).toBe(true);
    expect(await opens(later.code, backup)).toBe(false);
    await expect(openBackupKeys(later.code, backup)).rejects.toThrow(
      "This backup has no recovery code. Use the Vault password it was made with."
    );
  });

  it("a backup made with a recovery code opens with that code or that Vault password", async () => {
    const vault = await newVault("pass-1", true);
    const backup = backupOf(vault, generateContextKey());
    expect(await opens("pass-1", backup)).toBe(true);
    expect(await opens(vault.code!, backup)).toBe(true);
  });

  it("a new recovery code does not open an older backup", async () => {
    const vault = await newVault("pass-1", true);
    const backup = backupOf(vault, generateContextKey());
    const replaced = await createRecoveryWrap(vault.privateKey);

    expect(await opens(replaced.code, backup)).toBe(false);
    await expect(openBackupKeys(replaced.code, backup)).rejects.toThrow("That recovery code does not open this backup.");
    expect(await opens(vault.code!, backup)).toBe(true);
    expect(await opens("pass-1", backup)).toBe(true);
  });

  it("a new Vault password does not open an older backup", async () => {
    const vault = await newVault("pass-1", true);
    const contextKey = generateContextKey();
    const backup = backupOf(vault, contextKey);
    const changed: Vault = { ...vault, password: "pass-2", passwordWrap: await rewrapPrivateKey("pass-1", "pass-2", vault.passwordWrap) };

    expect(await opens("pass-2", backup)).toBe(false);
    expect(await opens("pass-1", backup)).toBe(true);
    expect(await opens(vault.code!, backup)).toBe(true);
    expect(await opens("pass-2", backupOf(changed, contextKey))).toBe(true);
  });

  it("after recovery, older backups open with the old password or code, not the new ones", async () => {
    const vault = await newVault("pass-1", true);
    const contextKey = generateContextKey();
    const sealed = sealContextKey(contextKey, vault.publicKey, CONTEXT_ID);
    const backup = backupOf(vault, contextKey);

    const recoveredKey = await unwrapWithRecoveryCode(vault.code!, vault.recoveryWrap!);
    const newPasswordWrap = await wrapPrivateKey("pass-2", recoveredKey);
    const newCode = await createRecoveryWrap(recoveredKey);

    expect(openSealedKey(sealed, recoveredKey, CONTEXT_ID)).toEqual(contextKey);
    expect(newPasswordWrap).not.toEqual(vault.passwordWrap);
    expect(await opens("pass-2", backup)).toBe(false);
    expect(await opens(newCode.code, backup)).toBe(false);
    expect(await opens("pass-1", backup)).toBe(true);
    expect(await opens(vault.code!, backup)).toBe(true);
  });

  it("after a vault reset, the new key opens nothing old; an old backup still opens and restores under the new keys", async () => {
    const vault = await newVault("pass-1", true);
    const oldContextKey = generateContextKey();
    const oldSealed = sealContextKey(oldContextKey, vault.publicKey, CONTEXT_ID);
    const backup = backupOf(vault, oldContextKey);

    const reset = await newVault("pass-2", true);
    expect(reset.publicKey).not.toBe(vault.publicKey);
    expect(() => openSealedKey(oldSealed, reset.privateKey, CONTEXT_ID)).toThrow();
    expect(await opens("pass-2", backup)).toBe(false);
    expect(await opens(reset.code!, backup)).toBe(false);

    expect(await opens("pass-1", backup)).toBe(true);
    expect(await opens(vault.code!, backup)).toBe(true);

    const { values } = await restoreValuesFromBackup("pass-1", backup);
    const newContextKey = generateContextKey();
    const newSealed = sealContextKey(newContextKey, reset.publicKey, CONTEXT_ID);
    const payload = encryptSecret(newContextKey, "API_KEY", values[0]!.value);
    const opened = openSealedKey(newSealed, reset.privateKey, CONTEXT_ID);
    expect(decryptSecret(opened, "API_KEY", payload)).toBe(VALUE);
  });
});
