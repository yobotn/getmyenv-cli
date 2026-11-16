import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { keptClaimFileMessage, revokeFailedMessage, unlinkCommand } from "./unlink.js";

const prev = process.cwd();
let dir = "";
let out: string[] = [];

const TOKEN = { version: 2, token: "tok_1", projectId: "p1", addedAt: "2026-01-01T00:00:00Z" };

function git(...args: string[]): void {
  spawnSync("git", ["-c", "user.email=t@example.com", "-c", "user.name=t", ...args], { cwd: dir, stdio: "ignore" });
}

/** A git repo whose project.json is committed, like a fresh clone. */
function clone(): string {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "getmyenv-unlink-"));
  git("init", "-q");
  fs.mkdirSync(path.join(dir, ".getmyenv"));
  fs.writeFileSync(path.join(dir, ".getmyenv", "project.json"), JSON.stringify({ projectId: "p1", projectName: "Acme" }));
  git("add", ".getmyenv/project.json");
  git("commit", "-q", "-m", "init");
  process.chdir(dir);
  return path.join(dir, ".getmyenv", "project.json");
}

beforeEach(() => {
  out = [];
  vi.stubEnv("GETMYENV_KEYCHAIN", "0");
  vi.spyOn(console, "log").mockImplementation((...a: unknown[]) => void out.push(a.join(" ")));
});

afterEach(() => {
  process.chdir(prev);
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  if (dir) fs.rmSync(dir, { recursive: true, force: true });
});

describe("unlink", () => {
  it("keeps a committed project.json when this machine has no token", async () => {
    const meta = clone();
    await unlinkCommand({ yes: true });
    expect(fs.existsSync(meta)).toBe(true);
    expect(out.join("\n")).toContain("Kept project.json");
  });

  it("removes project.json with the token", async () => {
    const meta = clone();
    fs.writeFileSync(path.join(dir, ".getmyenv", "token.json"), JSON.stringify(TOKEN));
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ revoked: true }), { status: 200 })));
    await unlinkCommand({ yes: true, apiUrl: "http://127.0.0.1:9" });
    expect(fs.existsSync(meta)).toBe(false);
    expect(fs.existsSync(path.join(dir, ".getmyenv", "token.json"))).toBe(false);
  });

  it("removes nothing when the server cannot be reached, and points to --local", async () => {
    clone();
    fs.writeFileSync(path.join(dir, ".getmyenv", "token.json"), JSON.stringify(TOKEN));
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("fetch failed")));
    await expect(unlinkCommand({ yes: true, apiUrl: "http://127.0.0.1:9" })).rejects.toThrow(
      "npx getmyenv unlink --local"
    );
    expect(fs.existsSync(path.join(dir, ".getmyenv", "token.json"))).toBe(true);
  });

  it("--local removes the files without a request, and warns that the token still works", async () => {
    clone();
    fs.writeFileSync(path.join(dir, ".getmyenv", "token.json"), JSON.stringify(TOKEN));
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    await unlinkCommand({ yes: true, local: true, apiUrl: "http://127.0.0.1:9" });
    expect(fetch).not.toHaveBeenCalled();
    expect(fs.existsSync(path.join(dir, ".getmyenv", "token.json"))).toBe(false);
    expect(out.join("\n")).toContain("The token was not revoked. It keeps working on the server");
  });

  it("removes a token.json that is not valid JSON", async () => {
    clone();
    fs.writeFileSync(path.join(dir, ".getmyenv", "token.json"), "{ broken");
    await unlinkCommand({ yes: true });
    expect(fs.existsSync(path.join(dir, ".getmyenv", "token.json"))).toBe(false);
  });
});

describe("unlink a guest folder whose token ended", () => {
  const claimFile = () => path.join(dir, ".getmyenv", "claim.json");

  function guestFolder(): void {
    clone();
    fs.writeFileSync(path.join(dir, ".getmyenv", "token.json"), JSON.stringify(TOKEN));
    fs.writeFileSync(
      claimFile(),
      JSON.stringify({ version: 1, claimCode: "CODE", passphrase: "pass", projectId: "p1", projectName: "Acme", guestExpiresAt: "" })
    );
  }

  function respond(body: unknown, status: number) {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify(body), { status })));
  }

  it("keeps claim.json after the project was claimed in the browser, and points to claim", async () => {
    guestFolder();
    respond({ error: 'The guest project "Acme" was claimed.', code: "token_ended" }, 401);
    await unlinkCommand({ yes: true, apiUrl: "http://127.0.0.1:9" });
    expect(fs.existsSync(claimFile())).toBe(true);
    expect(fs.existsSync(path.join(dir, ".getmyenv", "token.json"))).toBe(false);
    expect(out.join("\n")).toContain(keptClaimFileMessage(true));
    expect(keptClaimFileMessage(true)).toContain("npx getmyenv claim");
  });

  it("treats a 410 (claimed or expired guest) as already ended and cleans up", async () => {
    guestFolder();
    respond({ error: "Guest project expired.", code: "gone" }, 410);
    await unlinkCommand({ yes: true, apiUrl: "http://127.0.0.1:9" });
    expect(fs.existsSync(path.join(dir, ".getmyenv", "token.json"))).toBe(false);
    expect(fs.existsSync(claimFile())).toBe(true);
    expect(out.join("\n")).toContain("The token already no longer works on the server.");
  });
});

describe("revokeFailedMessage", () => {
  it("tells a guest to try again when the server is reachable, not to open Project settings", () => {
    const msg = revokeFailedMessage({ unreachable: true, guest: true });
    expect(msg).toContain("Try again when the server is reachable.");
    expect(msg).not.toContain("Project settings");
    expect(revokeFailedMessage({ unreachable: false, guest: false })).toContain("Project settings, Tokens");
  });
});
