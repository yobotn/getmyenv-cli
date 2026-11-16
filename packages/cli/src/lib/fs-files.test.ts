import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { colorEnabled } from "./colors.js";
import { confirmDiff } from "./confirm.js";
import { readFolderToken, TOKEN_JSON_INVALID } from "./credentials.js";
import {
  assertFileTarget,
  decodeText,
  duplicateEnvNames,
  PROJECT_JSON_INVALID,
  readEnvFile,
  readProjectMeta,
} from "./fs.js";

const prev = process.cwd();
const tempDirs: string[] = [];

/** A temp repo root with an empty .getmyenv folder, as cwd. */
function repo(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "getmyenv-files-"));
  tempDirs.push(dir);
  fs.mkdirSync(path.join(dir, ".git"));
  fs.mkdirSync(path.join(dir, ".getmyenv"));
  process.chdir(dir);
  return dir;
}

afterEach(() => {
  process.chdir(prev);
  vi.restoreAllMocks();
  for (const dir of tempDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

const BOM = "﻿";
const TOKEN = { version: 2, token: "tok_1", projectId: "p1", addedAt: "2026-01-01T00:00:00Z" };

describe("token.json and project.json", () => {
  it("read with a UTF-8 byte order mark", () => {
    const dir = repo();
    fs.writeFileSync(path.join(dir, ".getmyenv", "token.json"), BOM + JSON.stringify(TOKEN));
    fs.writeFileSync(path.join(dir, ".getmyenv", "project.json"), BOM + JSON.stringify({ projectId: "p1", projectName: "Acme" }));
    expect(readFolderToken()?.token).toBe("tok_1");
    expect(readProjectMeta()).toEqual({ projectId: "p1", projectName: "Acme" });
  });

  it("say so when they are not JSON, instead of reading as not linked", () => {
    const dir = repo();
    fs.writeFileSync(path.join(dir, ".getmyenv", "token.json"), "{ broken");
    fs.writeFileSync(path.join(dir, ".getmyenv", "project.json"), "{ broken");
    expect(() => readFolderToken()).toThrow(TOKEN_JSON_INVALID);
    expect(() => readProjectMeta()).toThrow(PROJECT_JSON_INVALID);
    expect(fs.readFileSync(path.join(dir, ".getmyenv", "project.json"), "utf8")).toBe("{ broken");
  });
});

describe("env files", () => {
  const text = "API_KEY=abc\nPORT=3000\n";

  it("decode UTF-16 LE and BE, and UTF-8 with or without a BOM", () => {
    const le = Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(text, "utf16le")]);
    const be = Buffer.from(Buffer.concat([Buffer.from([0xfe, 0xff]), Buffer.from(text, "utf16le").swap16()]));
    expect(decodeText(le)).toBe(text);
    expect(decodeText(be)).toBe(text);
    expect(decodeText(Buffer.from(BOM + text, "utf8"))).toBe(text);
    expect(decodeText(Buffer.from(text, "utf8"))).toBe(text);
  });

  it("import a UTF-16 file written by PowerShell 5.1", () => {
    const dir = repo();
    const file = path.join(dir, ".env");
    fs.writeFileSync(file, Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from("API_KEY=abc\r\nPORT=3000\r\n", "utf16le")]));
    expect(readEnvFile(file).values).toEqual({ API_KEY: "abc", PORT: "3000" });
  });

  it("list names that appear more than once, outside multiline values", () => {
    const dir = repo();
    const file = path.join(dir, ".env");
    fs.writeFileSync(file, 'DUP=1\nOTHER=x\nexport DUP=2\nKEY="line one\nDUP=inside\n"\nDUP=3\n');
    expect(duplicateEnvNames(file)).toEqual([{ name: "DUP", count: 3 }]);
    expect(readEnvFile(file).values.DUP).toBe("3");
  });
});

describe("assertFileTarget", () => {
  it("refuses a folder and a missing parent folder with a clear message", () => {
    const dir = repo();
    expect(() => assertFileTarget(dir)).toThrow(`${dir} is a folder. Pass a file name with -o.`);
    expect(() => assertFileTarget(path.join(dir, "nope", ".env"))).toThrow(/does not exist. Create it first/);
    expect(assertFileTarget(path.join(dir, ".env"))).toBeNull();
  });
});

describe("confirmDiff", () => {
  it("counts conflicts apart from names only in the local file", async () => {
    const lines: string[] = [];
    vi.spyOn(console, "error").mockImplementation((...a: unknown[]) => void lines.push(a.join(" ")));
    await confirmDiff({
      conflicts: [{ name: "A", detail: "local value differs" }],
      removed: [{ name: "B" }, { name: "C" }],
      action: "Overwrite .env",
      yes: true,
    });
    const out = lines.join("\n");
    expect(out).toContain("1 conflict:");
    expect(out).toContain("2 names will be removed:");
    expect(out).not.toContain("(s)");
  });
});

describe("colorEnabled", () => {
  it("colors a terminal only, and follows NO_COLOR and FORCE_COLOR", () => {
    expect(colorEnabled({ isTTY: true }, {})).toBe(true);
    expect(colorEnabled({ isTTY: false }, {})).toBe(false);
    expect(colorEnabled({}, {})).toBe(false);
    expect(colorEnabled({ isTTY: true }, { NO_COLOR: "1" })).toBe(false);
    expect(colorEnabled({ isTTY: false }, { FORCE_COLOR: "1" })).toBe(true);
    expect(colorEnabled({ isTTY: true }, { TERM: "dumb" })).toBe(false);
  });
});

describe("claim.json that cannot be read", () => {
  it("is reported as not valid, never as missing", async () => {
    const dir = repo();
    const file = path.join(dir, ".getmyenv", "claim.json");
    const { claimFileInvalid } = await import("./fs.js");
    expect(claimFileInvalid()).toBe(false);
    fs.writeFileSync(file, "{ not json");
    expect(claimFileInvalid()).toBe(true);
  });

  it("stops claim before it asks for details or writes the file", async () => {
    const dir = repo();
    const file = path.join(dir, ".getmyenv", "claim.json");
    fs.writeFileSync(file, '{"claimCode":"c"}');
    const { claimCommand } = await import("../commands/claim.js");
    const { CLAIM_FILE_INVALID } = await import("./fs.js");
    const tty = Object.getOwnPropertyDescriptor(process.stdin, "isTTY");
    Object.defineProperty(process.stdin, "isTTY", { value: true, configurable: true });
    vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      await expect(claimCommand({ apiUrl: "http://localhost:9" })).rejects.toThrow(CLAIM_FILE_INVALID);
    } finally {
      if (tty) Object.defineProperty(process.stdin, "isTTY", tty);
      else delete (process.stdin as { isTTY?: boolean }).isTTY;
    }
    expect(fs.readFileSync(file, "utf8")).toBe('{"claimCode":"c"}');
  });
});

describe("lock", () => {
  it("clears the keychain even when project.json is broken", async () => {
    const dir = repo();
    fs.writeFileSync(path.join(dir, ".getmyenv", "project.json"), "{ broken");
    const keychain = await import("./keychain.js");
    const clear = vi.spyOn(keychain, "clearAllCachedKeys").mockResolvedValue(0);
    vi.spyOn(console, "log").mockImplementation(() => {});
    const { lockCommand } = await import("../commands/lock.js");
    await lockCommand({});
    expect(clear).toHaveBeenCalledWith([]);
  });
});
