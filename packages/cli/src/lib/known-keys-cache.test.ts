import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { knownKeys, refreshKnownKeys, resetKnownKeysForTests } from "./known-keys-cache.js";

const API = "http://localhost:3000";
const entry = {
  name: "ACME_API_KEY",
  provider: "Acme",
  category: "ai",
  description: "Acme key.",
  docsUrl: "https://acme.example/keys",
  valueHint: null,
  valuePattern: null,
  pair: [],
  source: "convention",
  iconSlug: null,
};

let dir: string;
const cacheFile = () => path.join(dir, "known-keys.json");

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "gme-kk-"));
  vi.stubEnv("GETMYENV_CONFIG_DIR", dir);
  resetKnownKeysForTests();
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("known keys cache", () => {
  it("uses the bundled list with no cache", () => {
    expect(knownKeys().get("OPENAI_API_KEY")).toBeDefined();
    expect(knownKeys().get("ACME_API_KEY")).toBeUndefined();
  });

  it("caches the server list and merges it", async () => {
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ entries: [entry] }), { status: 200, headers: { ETag: '"abc"' } })
    );
    vi.stubGlobal("fetch", fetchMock);
    await refreshKnownKeys(API);
    expect(knownKeys().get("ACME_API_KEY")?.provider).toBe("Acme");
    const cached = JSON.parse(fs.readFileSync(cacheFile(), "utf8"));
    expect(cached).toMatchObject({ apiUrl: API, etag: '"abc"' });

    await refreshKnownKeys(API);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("sends If-None-Match when stale and keeps entries on 304", async () => {
    fs.writeFileSync(
      cacheFile(),
      JSON.stringify({ apiUrl: API, etag: '"abc"', checkedAt: "2000-01-01T00:00:00.000Z", entries: [entry], disabled: [] })
    );
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      expect((init?.headers as Record<string, string>)["If-None-Match"]).toBe('"abc"');
      return new Response(null, { status: 304 });
    });
    vi.stubGlobal("fetch", fetchMock);
    await refreshKnownKeys(API);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(knownKeys().get("ACME_API_KEY")).toBeDefined();
    expect(JSON.parse(fs.readFileSync(cacheFile(), "utf8")).checkedAt).not.toBe("2000-01-01T00:00:00.000Z");
  });

  it("falls back silently when the server fails", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Promise.reject(new Error("offline"))));
    await expect(refreshKnownKeys(API)).resolves.toBeUndefined();
    expect(knownKeys().get("OPENAI_API_KEY")).toBeDefined();
    expect(fs.existsSync(cacheFile())).toBe(false);
  });

  it("drops invalid entries from the server", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ entries: [{ ...entry, valuePattern: "/^(a+)+$/" }] })))
    );
    await refreshKnownKeys(API);
    expect(knownKeys().get("ACME_API_KEY")).toBeUndefined();
  });

  it("drops defaults the server turned off, and ignores caches without that list", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ entries: [], disabled: ["OPENAI_API_KEY"] })))
    );
    await refreshKnownKeys(API);
    expect(knownKeys().get("OPENAI_API_KEY")).toBeUndefined();
    expect(knownKeys().get("STRIPE_SECRET_KEY")).toBeDefined();

    // A cache in an older format has entries only: ignored, bundled list used.
    fs.writeFileSync(
      cacheFile(),
      JSON.stringify({ apiUrl: API, etag: null, checkedAt: new Date().toISOString(), entries: [entry] })
    );
    resetKnownKeysForTests();
    expect(knownKeys().get("ACME_API_KEY")).toBeUndefined();
    expect(knownKeys().get("OPENAI_API_KEY")).toBeDefined();
  });
});
