import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  clearAllCachedKeys,
  clearCachedKeys,
  KEYCHAIN_TTL_MS,
  keychainAccount,
  keychainEnabled,
  readCachedContextKey,
  setKeyringForTests,
  storeCachedContextKeys,
  type KeyringFactory,
} from "./keychain.js";

function memoryKeyring(): { factory: KeyringFactory; store: Map<string, string> } {
  const store = new Map<string, string>();
  const factory: KeyringFactory = (service, account) => {
    const id = `${service}/${account}`;
    return {
      getPassword: () => store.get(id) ?? null,
      setPassword: (p) => void store.set(id, p),
      deletePassword: () => store.delete(id),
    };
  };
  return { factory, store };
}

const ACCOUNT = keychainAccount("https://getmyenv.com/api", "42");
const SEALED = JSON.stringify({ version: 2, ciphertext: "abc" });
const KEY = new Uint8Array(32).fill(7);
const OTHER = new Uint8Array(32).fill(9);

describe("keychain cache", () => {
  let mem: ReturnType<typeof memoryKeyring>;
  beforeEach(() => {
    mem = memoryKeyring();
    setKeyringForTests(mem.factory);
  });
  afterEach(() => setKeyringForTests(undefined));

  it("keys entries by API origin and project", () => {
    expect(ACCOUNT).toBe("https://getmyenv.com|project:42");
  });

  it("stores context keys by context id and reads them back", async () => {
    expect(
      await storeCachedContextKeys(ACCOUNT, [
        { contextId: 1, sealedRaw: SEALED, key: KEY },
        { contextId: 2, sealedRaw: SEALED, key: OTHER },
      ])
    ).toBe(true);
    const raw = [...mem.store.values()][0]!;
    expect(raw).not.toContain(SEALED);
    expect(await readCachedContextKey(ACCOUNT, 1, SEALED)).toEqual(KEY);
    expect(await readCachedContextKey(ACCOUNT, 2, SEALED)).toEqual(OTHER);
    expect(await readCachedContextKey(ACCOUNT, 3, SEALED)).toBeNull();
  });

  it("ignores and removes the entry after 8 hours", async () => {
    const now = 1_000_000;
    await storeCachedContextKeys(ACCOUNT, [{ contextId: 1, sealedRaw: SEALED, key: KEY }], now);
    expect(await readCachedContextKey(ACCOUNT, 1, SEALED, now + KEYCHAIN_TTL_MS - 1)).toEqual(KEY);
    expect(await readCachedContextKey(ACCOUNT, 1, SEALED, now + KEYCHAIN_TTL_MS)).toBeNull();
    expect(mem.store.size).toBe(0);
  });

  it("misses when the server's sealed key changed (rotation)", async () => {
    await storeCachedContextKeys(ACCOUNT, [{ contextId: 1, sealedRaw: SEALED, key: KEY }]);
    expect(await readCachedContextKey(ACCOUNT, 1, JSON.stringify({ version: 2, ciphertext: "new" }))).toBeNull();
  });

  it("drops entries in an old format", async () => {
    mem.store.set(`getmyenv/${ACCOUNT}`, JSON.stringify({ pek: "AQID", wrappedHash: "x", expiresAt: Date.now() + 1000 }));
    expect(await readCachedContextKey(ACCOUNT, 1, SEALED)).toBeNull();
    expect(mem.store.size).toBe(0);
  });

  it("lock clears the entry", async () => {
    await storeCachedContextKeys(ACCOUNT, [{ contextId: 1, sealedRaw: SEALED, key: KEY }]);
    expect(await clearCachedKeys(ACCOUNT)).toBe(true);
    expect(await readCachedContextKey(ACCOUNT, 1, SEALED)).toBeNull();
    expect(await clearCachedKeys(ACCOUNT)).toBe(false);
  });

  it("lock clears every project and server", async () => {
    const other = keychainAccount("http://localhost:3000/api", "7");
    setKeyringForTests(mem.factory, (service) =>
      [...mem.store.keys()].filter((id) => id.startsWith(`${service}/`)).map((id) => id.slice(service.length + 1))
    );
    await storeCachedContextKeys(ACCOUNT, [{ contextId: 1, sealedRaw: SEALED, key: KEY }]);
    await storeCachedContextKeys(other, [{ contextId: 2, sealedRaw: SEALED, key: OTHER }]);
    expect(await clearAllCachedKeys()).toBe(2);
    expect(mem.store.size).toBe(0);
    expect(await clearAllCachedKeys()).toBe(0);
  });

  it("lock falls back to the linked project when the keychain cannot list", async () => {
    await storeCachedContextKeys(ACCOUNT, [{ contextId: 1, sealedRaw: SEALED, key: KEY }]);
    expect(await clearAllCachedKeys([ACCOUNT])).toBe(1);
    expect(mem.store.size).toBe(0);
  });

  it("does nothing without a keyring", async () => {
    setKeyringForTests(null);
    expect(await storeCachedContextKeys(ACCOUNT, [{ contextId: 1, sealedRaw: SEALED, key: KEY }])).toBe(false);
    expect(await readCachedContextKey(ACCOUNT, 1, SEALED)).toBeNull();
  });
});

describe("keychainEnabled", () => {
  it("is off in CI and when GETMYENV_KEYCHAIN=0", () => {
    expect(keychainEnabled({})).toBe(true);
    expect(keychainEnabled({ CI: "true" })).toBe(false);
    expect(keychainEnabled({ CI: "1" })).toBe(false);
    expect(keychainEnabled({ CI: "false" })).toBe(true);
    expect(keychainEnabled({ GETMYENV_KEYCHAIN: "0" })).toBe(false);
  });
});
