import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Linked } from "./bootstrap.js";
import { keychainAccount, setKeyringForTests, storeCachedContextKeys, type KeyringFactory } from "./keychain.js";
import type { VaultContext, VaultInfo } from "./vault.js";

const resolveVaultPassword = vi.fn(async (..._args: unknown[]): Promise<string> => {
  throw new Error("PASSWORD_PROMPT");
});
vi.mock("./guest-key.js", () => ({ resolveVaultPassword }));

const { writeKey } = await import("./vault.js");

const API_URL = "https://getmyenv.com";
const PROJECT_ID = "42";
const ACCOUNT = keychainAccount(API_URL, PROJECT_ID);
const KEY = new Uint8Array(32).fill(7);

function memoryKeyring(): KeyringFactory {
  const store = new Map<string, string>();
  return (service, account) => {
    const id = `${service}/${account}`;
    return {
      getPassword: () => store.get(id) ?? null,
      setPassword: (p) => void store.set(id, p),
      deletePassword: () => store.delete(id),
    };
  };
}

function sealed(tag: string): VaultContext["sealedKey"] {
  return { tag } as unknown as VaultContext["sealedKey"];
}

function vaultWith(ctx: Partial<VaultContext> & { id: number }, holder: VaultInfo["holder"] = "user"): VaultInfo {
  return {
    holder,
    publicKey: "pk",
    wrappedPrivateKey: { stub: true } as unknown as VaultInfo["wrappedPrivateKey"],
    contexts: [
      { slug: "development", protection: "open", hasKey: true, sealedKey: sealed("a"), keyVersion: 3, ...ctx },
    ],
    claim: null,
  };
}

function linkedFor(vault: VaultInfo, opts: { isGuest?: boolean } = {}) {
  const request = vi.fn(async (_method: string, _path: string) => vault);
  const linked = {
    who: { isGuest: opts.isGuest ?? false, token: { kind: opts.isGuest ? "guest" : "folder" }, project: { id: PROJECT_ID } },
    apiUrl: API_URL,
    token: "t",
    client: { request },
    meta: null,
  } as unknown as Linked;
  return { linked, request };
}

const savedEnv = { CI: process.env.CI, GETMYENV_KEYCHAIN: process.env.GETMYENV_KEYCHAIN };

beforeEach(() => {
  delete process.env.CI;
  delete process.env.GETMYENV_KEYCHAIN;
  setKeyringForTests(memoryKeyring());
  resolveVaultPassword.mockClear();
});

afterEach(() => {
  setKeyringForTests(undefined);
  for (const [k, v] of Object.entries(savedEnv)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
});

describe("writeKey and the keychain cache", () => {
  it("uses the cached key of an open context, with the version from the vault, without the Vault password", async () => {
    const id = 101;
    await storeCachedContextKeys(ACCOUNT, [{ contextId: id, sealedRaw: JSON.stringify(sealed("a")), key: KEY }]);
    const { linked, request } = linkedFor(vaultWith({ id, keyVersion: 5 }));

    const out = await writeKey(linked, { id, slug: "development", protection: "open" });

    expect(Array.from(out.key)).toEqual(Array.from(KEY));
    expect(out.keyVersion).toBe(5);
    expect(resolveVaultPassword).not.toHaveBeenCalled();
    expect(request).toHaveBeenCalledWith("GET", "/api/cli/vault");
  });

  it("asks for the Vault password when the sealed key changed (rotation)", async () => {
    const id = 102;
    await storeCachedContextKeys(ACCOUNT, [{ contextId: id, sealedRaw: JSON.stringify(sealed("old")), key: KEY }]);
    const { linked } = linkedFor(vaultWith({ id, sealedKey: sealed("new") }));

    await expect(writeKey(linked, { id, slug: "development", protection: "open" })).rejects.toThrow("PASSWORD_PROMPT");
    expect(resolveVaultPassword).toHaveBeenCalled();
  });

  it("never reads the cache for a Read-only context", async () => {
    const id = 103;
    await storeCachedContextKeys(ACCOUNT, [{ contextId: id, sealedRaw: JSON.stringify(sealed("a")), key: KEY }]);
    const { linked } = linkedFor(vaultWith({ id, slug: "production", protection: "locked" }));

    await expect(writeKey(linked, { id, slug: "production", protection: "locked" })).rejects.toThrow("PASSWORD_PROMPT");
    expect(resolveVaultPassword).toHaveBeenCalled();
  });

  it("never reads the cache for a guest project", async () => {
    const id = 104;
    await storeCachedContextKeys(ACCOUNT, [{ contextId: id, sealedRaw: JSON.stringify(sealed("a")), key: KEY }]);
    const { linked } = linkedFor(vaultWith({ id }, "guest"), { isGuest: true });

    await expect(writeKey(linked, { id, slug: "development", protection: "open" })).rejects.toThrow("PASSWORD_PROMPT");
    expect(resolveVaultPassword).toHaveBeenCalledWith(expect.objectContaining({ isGuest: true }));
  });

  it("never reads the cache with GETMYENV_KEYCHAIN=0", async () => {
    const id = 105;
    await storeCachedContextKeys(ACCOUNT, [{ contextId: id, sealedRaw: JSON.stringify(sealed("a")), key: KEY }]);
    process.env.GETMYENV_KEYCHAIN = "0";
    const { linked } = linkedFor(vaultWith({ id }));

    await expect(writeKey(linked, { id, slug: "development", protection: "open" })).rejects.toThrow("PASSWORD_PROMPT");
    expect(resolveVaultPassword).toHaveBeenCalled();
  });
});
