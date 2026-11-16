import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

const BIN = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../dist/bin.js");
const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

/** Run the built CLI with a piped stdin that never sends data or closes. */
function runCli(
  args: string[],
  prepare?: (cwd: string) => void
): Promise<{ code: number | null; out: string; timedOut: boolean }> {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "getmyenv-nontty-"));
  tempDirs.push(cwd);
  // A repo root of its own, so the CLI never walks up into another .getmyenv folder.
  fs.mkdirSync(path.join(cwd, ".git"));
  prepare?.(cwd);
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    GETMYENV_CONFIG_DIR: path.join(cwd, ".config"),
    GETMYENV_SKIP_UPDATE: "1",
    GETMYENV_API_URL: "http://127.0.0.1:9",
  };
  delete env.GETMYENV_TOKEN;
  delete env.FORCE_COLOR;
  delete env.NO_COLOR;
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [BIN, ...args], { cwd, env, stdio: ["pipe", "pipe", "pipe"] });
    let out = "";
    child.stdout.on("data", (d) => (out += String(d)));
    child.stderr.on("data", (d) => (out += String(d)));
    const timer = setTimeout(() => {
      child.kill();
      resolve({ code: null, out, timedOut: true });
    }, 10_000);
    child.on("exit", (code) => {
      clearTimeout(timer);
      resolve({ code, out, timedOut: false });
    });
  });
}

describe.skipIf(!fs.existsSync(BIN))("non-TTY", () => {
  it("bare getmyenv prints next steps and exits 1 without reading stdin", async () => {
    const r = await runCli([]);
    expect(r.timedOut).toBe(false);
    expect(r.code).toBe(1);
    expect(r.out).toContain("This folder is not linked");
  }, 15_000);

  it("a clone with project.json names its project instead of saying not linked", async () => {
    const r = await runCli(["status"], (cwd) => {
      fs.mkdirSync(path.join(cwd, ".getmyenv"));
      fs.writeFileSync(path.join(cwd, ".getmyenv", "project.json"), JSON.stringify({ projectId: "p1", projectName: "Acme" }));
      fs.writeFileSync(path.join(cwd, ".getmyenv", "template.json"), JSON.stringify({ version: 1, keys: [] }));
    });
    expect(r.code).toBe(1);
    expect(r.out).toContain("This folder belongs to Acme, but this machine has no token for it.");
    expect(r.out).toContain("npx getmyenv guest");
    expect(r.out).not.toContain("not linked");
  }, 15_000);

  it("a broken token.json says so instead of reading as not linked", async () => {
    const r = await runCli(["status"], (cwd) => {
      fs.mkdirSync(path.join(cwd, ".getmyenv"));
      fs.writeFileSync(path.join(cwd, ".getmyenv", "token.json"), "{ not json");
    });
    expect(r.code).toBe(1);
    expect(r.out).toContain(".getmyenv/token.json is not valid JSON.");
  }, 15_000);

  it("commander errors carry the getmyenv prefix and point to the command's help", async () => {
    const r = await runCli(["ls", "--nope"]);
    expect(r.code).toBe(1);
    expect(r.out).toContain("getmyenv: unknown option '--nope'");
    expect(r.out).toContain("See: npx getmyenv ls --help");
    expect(r.out).not.toContain("error: unknown option");
  }, 15_000);

  it("piped output has no color codes", async () => {
    const r = await runCli(["unlink", "--yes"]);
    expect(r.out).not.toContain("\u001b[");
  }, 15_000);

  it("run without a token fails fast with next steps", async () => {
    const r = await runCli(["run", "--", "node", "-v"]);
    expect(r.timedOut).toBe(false);
    expect(r.code).toBe(1);
    expect(r.out).toContain("npx getmyenv");
  }, 15_000);

  it("unknown commands fail", async () => {
    const r = await runCli(["nope"]);
    expect(r.code).toBe(1);
    expect(r.out).toContain('Unknown command "nope"');
  }, 15_000);
});
