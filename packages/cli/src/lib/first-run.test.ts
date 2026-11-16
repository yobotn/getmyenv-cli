import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { FACTS } from "@getmyenv/shared";
import {
  hintMarkerPath,
  hintsEnabled,
  packageScriptName,
  pendingFirstRunHints,
  scriptUsesEnvFile,
} from "./first-run.js";

const TTY = { isTTY: true, env: {}, tokenKind: "folder" as const };

describe("hintsEnabled", () => {
  it("is on at a terminal with a folder or guest token", () => {
    expect(hintsEnabled(TTY)).toBe(true);
    expect(hintsEnabled({ ...TTY, tokenKind: "guest" })).toBe(true);
    expect(hintsEnabled({ ...TTY, env: { CI: "false" } })).toBe(true);
  });

  it("is off without a terminal, in CI, with GETMYENV_TOKEN or a server token", () => {
    expect(hintsEnabled({ ...TTY, isTTY: false })).toBe(false);
    expect(hintsEnabled({ ...TTY, env: { CI: "true" } })).toBe(false);
    expect(hintsEnabled({ ...TTY, env: { GETMYENV_TOKEN: "t" } })).toBe(false);
    expect(hintsEnabled({ ...TTY, tokenKind: "server" })).toBe(false);
  });
});

describe("packageScriptName", () => {
  it("finds the script a package manager starts", () => {
    expect(packageScriptName(["npm", "start"])).toBe("start");
    expect(packageScriptName(["npm.cmd", "run", "dev"])).toBe("dev");
    expect(packageScriptName(["npm", "run-script", "dev", "--", "--port", "3000"])).toBe("dev");
    expect(packageScriptName(["pnpm", "dev"])).toBe("dev");
    expect(packageScriptName(["yarn", "run", "build"])).toBe("build");
    expect(packageScriptName(["/usr/bin/bun", "--silent", "dev"])).toBe("dev");
  });

  it("is null for other commands", () => {
    expect(packageScriptName(["node", "server.js"])).toBeNull();
    expect(packageScriptName(["npm", "install"])).toBeNull();
    expect(packageScriptName([])).toBeNull();
  });
});

describe("scriptUsesEnvFile", () => {
  const pkg = { scripts: { dev: "node --env-file=.env server.js", start: "node server.js" } };
  it("is true only when that script passes --env-file", () => {
    expect(scriptUsesEnvFile(["npm", "run", "dev"], pkg)).toBe(true);
    expect(scriptUsesEnvFile(["npm", "start"], pkg)).toBe(false);
    expect(scriptUsesEnvFile(["npm", "run", "missing"], pkg)).toBe(false);
    expect(scriptUsesEnvFile(["npm", "run", "dev"], null)).toBe(false);
  });
});

describe("pendingFirstRunHints", () => {
  let tmp: string;
  let cwd: string;
  let configDir: string;
  const base = () => ({
    ...TTY,
    apiUrl: "http://localhost:3000/api",
    projectId: "7",
    childArgs: ["npm", "run", "dev"],
    cwd,
    configDir: () => configDir,
  });

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "getmyenv-hints-"));
    cwd = path.join(tmp, "app");
    configDir = path.join(tmp, "config");
    fs.mkdirSync(cwd);
  });
  afterEach(() => fs.rmSync(tmp, { recursive: true, force: true }));

  it("shows the hints once, then not after the child spawned", () => {
    const first = pendingFirstRunHints(base());
    expect(first.lines).toEqual([FACTS.runExplainHint]);
    first.markShown();
    expect(fs.existsSync(hintMarkerPath(configDir, "http://localhost:3000/api", "7"))).toBe(true);
    expect(pendingFirstRunHints(base()).lines).toEqual([]);
  });

  it("shows them again when the first run failed before spawn", () => {
    pendingFirstRunHints(base());
    expect(pendingFirstRunHints(base()).lines).toEqual([FACTS.runExplainHint]);
  });

  it("keeps one marker per server origin and project", () => {
    pendingFirstRunHints(base()).markShown();
    expect(pendingFirstRunHints({ ...base(), projectId: "8" }).lines).not.toEqual([]);
    expect(pendingFirstRunHints({ ...base(), apiUrl: "https://getmyenv.com/api" }).lines).not.toEqual([]);
  });

  it("adds the .env and --env-file hints when they apply", () => {
    fs.writeFileSync(path.join(cwd, ".env"), "A=1\n");
    fs.writeFileSync(path.join(cwd, "package.json"), JSON.stringify({ scripts: { dev: "node --env-file=.env x.js" } }));
    expect(pendingFirstRunHints(base()).lines).toEqual([
      FACTS.runExplainHint,
      FACTS.runIgnoresEnvFile,
      FACTS.envFileScripts,
    ]);
  });

  it("never throws when the marker cannot be written", () => {
    fs.writeFileSync(configDir, "not a directory");
    const pending = pendingFirstRunHints(base());
    expect(pending.lines).toEqual([FACTS.runExplainHint]);
    expect(() => pending.markShown()).not.toThrow();
    expect(pendingFirstRunHints(base()).lines).toEqual([FACTS.runExplainHint]);
  });

  it("never throws when the config dir cannot be found", () => {
    const pending = pendingFirstRunHints({
      ...base(),
      configDir: () => {
        throw new Error("EACCES");
      },
    });
    expect(pending.lines).toEqual([FACTS.runExplainHint]);
    expect(() => pending.markShown()).not.toThrow();
  });

  it("shows nothing and writes nothing without a terminal or in CI", () => {
    for (const over of [{ isTTY: false }, { env: { CI: "1" } }, { env: { GETMYENV_TOKEN: "t" } }]) {
      const pending = pendingFirstRunHints({ ...base(), ...over });
      expect(pending.lines).toEqual([]);
      pending.markShown();
    }
    expect(fs.existsSync(configDir)).toBe(false);
  });
});
