import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { getProjectRoot, promptChoice, promptHidden } from "./fs.js";

describe("prompts write to stderr, never stdout", () => {
  afterEach(() => vi.restoreAllMocks());

  it("promptHidden echoes to stderr", async () => {
    const stdin = process.stdin as NodeJS.ReadStream & { setRawMode?: (v: boolean) => void };
    const wasTty = stdin.isTTY;
    Object.defineProperty(stdin, "isTTY", { value: true, configurable: true });
    const setRaw = stdin.setRawMode;
    stdin.setRawMode = () => stdin;
    const out = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    const err = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    try {
      const p = promptHidden("Password: ");
      stdin.emit("data", Buffer.from("s"));
      stdin.emit("data", Buffer.from("\r"));
      await expect(p).resolves.toBe("s");
      expect(out).not.toHaveBeenCalled();
      expect(err.mock.calls.map((c) => String(c[0])).join("")).toContain("Password: ");
    } finally {
      Object.defineProperty(stdin, "isTTY", { value: wasTty, configurable: true });
      stdin.setRawMode = setRaw;
      stdin.pause();
    }
  });

  it("promptChoice lists options on stderr", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    await promptChoice("Pick", ["only one"]);
    await expect(promptChoice("Pick", ["a", "b"])).rejects.toThrow();
    expect(log).not.toHaveBeenCalled();
    expect(error).toHaveBeenCalled();
  });
});

describe("getProjectRoot", () => {
  const made: string[] = [];
  afterEach(() => {
    for (const dir of made.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
  });

  function tmp(): string {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "getmyenv-root-"));
    made.push(dir);
    return dir;
  }

  it("finds the linked folder from a subfolder", () => {
    const root = tmp();
    fs.mkdirSync(path.join(root, ".getmyenv"));
    fs.writeFileSync(path.join(root, ".getmyenv", "project.json"), "{}");
    const sub = path.join(root, "apps", "web");
    fs.mkdirSync(sub, { recursive: true });
    expect(getProjectRoot(sub)).toBe(root);
  });

  it("stops at a git repo root", () => {
    const outer = tmp();
    fs.mkdirSync(path.join(outer, ".getmyenv"));
    fs.writeFileSync(path.join(outer, ".getmyenv", "project.json"), "{}");
    const repo = path.join(outer, "repo");
    fs.mkdirSync(path.join(repo, ".git"), { recursive: true });
    const sub = path.join(repo, "src");
    fs.mkdirSync(sub);
    expect(getProjectRoot(sub)).toBe(sub);
  });
});
