import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const uploadValues = vi.fn(async (opts: { pairs: Record<string, string> }) => ({
  set: Object.keys(opts.pairs),
  declared: [] as string[],
  pruned: [] as string[],
}));

vi.mock("../lib/bootstrap.js", () => ({
  ensureTokenAndLink: vi.fn(async () => ({
    who: {
      isGuest: true,
      project: { id: "p1", name: "Acme" },
      token: { kind: "guest" },
      contexts: [{ id: 1, slug: "development", name: "Development", protection: "open" }],
      keys: [],
    },
    meta: {},
    apiUrl: "http://127.0.0.1:9",
    client: { request: vi.fn() },
  })),
}));
vi.mock("../lib/known-keys-cache.js", () => ({ refreshKnownKeys: vi.fn(async () => undefined) }));
vi.mock("../lib/known-keys.js", () => ({ printDidYouMean: vi.fn(), printPublicSecretWarnings: vi.fn() }));
vi.mock("../lib/template-file.js", () => ({ syncFromLinked: vi.fn() }));
vi.mock("../lib/upload.js", () => ({ uploadValues }));

const { importCommand } = await import("./import.js");

const prev = process.cwd();
let dir = "";
let errors: string[] = [];

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "getmyenv-import-"));
  fs.mkdirSync(path.join(dir, ".git"));
  process.chdir(dir);
  errors = [];
  uploadValues.mockClear();
  vi.spyOn(console, "error").mockImplementation((...a: unknown[]) => void errors.push(a.join(" ")));
});

afterEach(() => {
  process.chdir(prev);
  vi.restoreAllMocks();
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("import", () => {
  it("refuses a folder with a clear message", async () => {
    fs.mkdirSync(path.join(dir, "envs"));
    await expect(importCommand("envs", {})).rejects.toThrow("envs is not a file.");
  });

  it("fails when a named file holds no variables", async () => {
    fs.writeFileSync(path.join(dir, "empty.env"), "# nothing here\n");
    await expect(importCommand("empty.env", {})).rejects.toThrow("Nothing was imported.");
    expect(uploadValues).not.toHaveBeenCalled();
  });

  it("imports a UTF-16 file", async () => {
    fs.writeFileSync(
      path.join(dir, ".env"),
      Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from("API_KEY=abc\r\n", "utf16le")])
    );
    await importCommand(".env", { noRunLine: true });
    expect(uploadValues).toHaveBeenCalledWith(expect.objectContaining({ pairs: { API_KEY: "abc" } }));
  });

  it("warns about a name that appears more than once", async () => {
    fs.writeFileSync(path.join(dir, ".env"), "DUP=1\nDUP=2\n");
    await importCommand(".env", { noRunLine: true });
    expect(errors.join("\n")).toContain("DUP appears 2 times in .env. The last one is used.");
    expect(uploadValues).toHaveBeenCalledWith(expect.objectContaining({ pairs: { DUP: "2" } }));
  });
});
