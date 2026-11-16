import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { isUnsafeEnvName, ownEnvNameError, unsafeEnvError, unsafeEnvWarning } from "@getmyenv/shared";
import {
  assertVariableNames,
  explainLines,
  isWindowsBatch,
  mergeEnv,
  signalExitCode,
  validationError,
  windowsCommandLine,
} from "./run-env.js";

const SECRET = "sk-live-do-not-print-4242";

describe("assertVariableNames", () => {
  it("accepts variable names", () => {
    expect(() => assertVariableNames(["API_KEY", "_PRIVATE", "DB2_URL"])).not.toThrow();
  });

  it("refuses names that could break an env or a .env file", () => {
    for (const bad of ["A\nB", "A=B", "1ABC", "A B", "", "A;rm", "lower_case", "_private"]) {
      expect(() => assertVariableNames([bad])).toThrow(/not a valid variable name/);
    }
  });
});

describe("mergeEnv", () => {
  it("context values win over the parent env and report replaced names", () => {
    const r = mergeEnv({ API_KEY: "parent", PATH: "/bin" }, { API_KEY: SECRET }, [], false);
    expect(r.env.API_KEY).toBe(SECRET);
    expect(r.env.PATH).toBe("/bin");
    expect(r.overridden).toEqual(["API_KEY"]);
    expect(r.applied).toEqual(["API_KEY"]);
  });

  it("--keep-existing keeps parent values", () => {
    const r = mergeEnv({ API_KEY: "parent" }, { API_KEY: SECRET, OTHER: "x" }, [], true);
    expect(r.env.API_KEY).toBe("parent");
    expect(r.env.OTHER).toBe("x");
    expect(r.kept).toEqual(["API_KEY"]);
    expect(r.overridden).toEqual([]);
    expect(r.applied).toEqual(["OTHER"]);
  });

  it("does not count an identical parent value as replaced", () => {
    const r = mergeEnv({ A: "1" }, { A: "1" }, [], false);
    expect(r.overridden).toEqual([]);
    expect(r.entries[0]?.origin).toBe("context");
  });

  it("a key missing in the context is filled by the parent env", () => {
    const r = mergeEnv({ DB_URL: "from-op" }, {}, [{ name: "DB_URL", reason: "missing" }], false);
    expect(r.filledByParent).toEqual(["DB_URL"]);
    expect(r.unresolved).toEqual([]);
    expect(r.env.DB_URL).toBe("from-op");
  });

  it("never passes the CLI's own GETMYENV_* settings to the child", () => {
    const r = mergeEnv(
      { GETMYENV_TOKEN: "tok", GETMYENV_API_URL: "https://x", getmyenv_config_dir: "/c", PATH: "/bin" },
      { API_KEY: SECRET },
      [],
      false
    );
    expect(r.env.GETMYENV_TOKEN).toBeUndefined();
    expect(r.env.GETMYENV_API_URL).toBeUndefined();
    expect(r.env.getmyenv_config_dir).toBeUndefined();
    expect(r.env.PATH).toBe("/bin");
    expect(r.env.API_KEY).toBe(SECRET);
  });

  it("an empty parent value does not fill a missing key", () => {
    const r = mergeEnv({ DB_URL: "" }, {}, [{ name: "DB_URL", reason: "missing" }], false);
    expect(r.unresolved.map((m) => m.name)).toEqual(["DB_URL"]);
  });
});

describe("validationError", () => {
  const missing = mergeEnv(
    {},
    { A: "1" },
    [
      { name: "B", reason: "missing" },
      { name: "C", reason: "expired" },
    ],
    false
  );

  it("fails when keys are missing and lists their names", () => {
    const err = validationError(missing, "staging", false);
    expect(err).toContain("2 variables have no value in staging");
    expect(err).toContain("Set them in a terminal: npx getmyenv set --missing -c staging");
    expect(err).toContain("Or remove them from the project: npx getmyenv unset B C --all");
    expect(err).toContain("  B");
    expect(err).toContain("  C (expired)");
    expect(err).toContain("--allow-missing");
  });

  it("says it for one variable", () => {
    const one = mergeEnv({}, {}, [{ name: "B", reason: "missing" }], false);
    const err = validationError(one, "staging", false)!;
    expect(err).toContain("1 variable has no value in staging:");
    expect(err).toContain("Set it in a terminal");
    expect(err).not.toContain("(s)");
  });

  it("--allow-missing passes", () => {
    expect(validationError(missing, "staging", true)).toBeNull();
  });

  it("passes when nothing is missing", () => {
    expect(validationError(mergeEnv({}, { A: "1" }, [], false), "dev", false)).toBeNull();
  });
});

describe("explainLines", () => {
  it("prints names and origins, never values", () => {
    const r = mergeEnv(
      { API_KEY: "parent-value-xyz", KEEP: "parent-keep-abc", FILL: "parent-fill-123" },
      { API_KEY: SECRET, NEW_ONE: SECRET },
      [
        { name: "FILL", reason: "missing" },
        { name: "GONE", reason: "expired" },
      ],
      false
    );
    const out = explainLines(r, "development").join("\n");
    expect(out).not.toContain(SECRET);
    expect(out).not.toContain("parent-value-xyz");
    expect(out).not.toContain("parent-fill-123");
    expect(out).toMatch(/API_KEY\s+getmyenv \(development\), replaces parent env/);
    expect(out).toMatch(/NEW_ONE\s+getmyenv \(development\)/);
    expect(out).toMatch(/FILL\s+parent env \(missing in development\)/);
    expect(out).toMatch(/GONE\s+not set \(expired in development\)/);
    expect(out).toContain("2 from getmyenv, 1 replaced, 0 kept, 1 from parent env, 1 not set");
  });

  it("marks names run refuses, unless --allow-unsafe-env", () => {
    const r = mergeEnv({}, { NODE_OPTIONS: "--require x", API_KEY: SECRET }, [], false);
    const out = explainLines(r, "staging").join("\n");
    expect(out).toMatch(/NODE_OPTIONS\s+getmyenv \(staging\), refused: changes how programs start/);
    expect(out).not.toMatch(/API_KEY.*refused/);
    expect(explainLines(r, "staging", { allowUnsafeEnv: true }).join("\n")).not.toContain("refused");
  });

  it("shows kept origins with --keep-existing", () => {
    const r = mergeEnv({ KEEP: "parent" }, { KEEP: SECRET }, [], true);
    const out = explainLines(r, "staging").join("\n");
    expect(out).toMatch(/KEEP\s+parent env \(--keep-existing\)/);
    expect(out).not.toContain(SECRET);
  });
});

describe("windowsCommandLine", () => {
  it("leaves plain args alone", () => {
    expect(windowsCommandLine(["npm", "run", "dev"])).toBe("npm run dev");
  });

  it("quotes args with spaces and shell characters, and escapes every cmd metacharacter", () => {
    expect(windowsCommandLine(["node", "-e", "console.log('a b')"])).toBe(`node -e ^"console.log^('a^ b'^)^"`);
    expect(windowsCommandLine(["echo", "a&b"])).toBe(`echo ^"a^&b^"`);
    expect(windowsCommandLine(["x", ""])).toBe(`x ^"^"`);
  });

  it("escapes inner quotes and doubles backslashes before them and at the end", () => {
    expect(windowsCommandLine(["x", 'say "hi"'])).toBe(`x ^"say^ \\^"hi\\^"^"`);
    expect(windowsCommandLine(["x", 'a\\"b'])).toBe(`x ^"a\\\\\\^"b^"`);
    expect(windowsCommandLine(["x", "C:\\Program Files\\"])).toBe(`x ^"C:\\Program^ Files\\\\^"`);
  });

  it("escapes % so cmd does not expand variables", () => {
    expect(windowsCommandLine(["echo", "%PATH%"])).toBe(`echo ^"^%PATH^%^"`);
  });

  it("escapes twice for a .cmd or .bat, which cmd reads again", () => {
    expect(windowsCommandLine(["npm", "a&b"], { batch: true })).toBe(`npm ^^^"a^^^&b^^^"`);
  });

  it("quotes a command path with spaces and keeps % out of the quotes", () => {
    expect(windowsCommandLine(["C:\\Program Files\\nodejs\\node.exe", "-v"])).toBe(
      `"C:\\Program Files\\nodejs\\node.exe" -v`
    );
    expect(windowsCommandLine(["C:\\%X%\\a b.exe"])).toBe(`"C:\\"^%"X"^%"\\a b.exe"`);
  });

  // The real thing: cmd.exe must hand each arg to the program unchanged, run nothing else, expand nothing.
  const NASTY = [
    "a b",
    "a&b",
    "a|b",
    "<in>",
    "(paren)",
    "semi;colon",
    "comma,",
    "x=y",
    "^caret",
    '"quoted"',
    'odd"quote',
    'a"&echo INJECTED&"b',
    '" & echo INJECTED & "',
    "trail\\",
    'back\\"slash',
    "%GETMYENV_TEST_VAR%",
    "!GETMYENV_TEST_VAR!",
    "100%",
    "",
  ];

  function roundTrip(command: string[], extra: { batch?: boolean } = {}): string {
    const res = spawnSync(windowsCommandLine(command, extra), {
      shell: true,
      encoding: "utf8",
      env: { ...process.env, GETMYENV_TEST_VAR: "expanded" },
    });
    return res.stdout;
  }

  it.runIf(process.platform === "win32")("passes nasty args through cmd.exe unchanged", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "getmyenv-args-"));
    try {
      const script = path.join(dir, "echo.cjs");
      fs.writeFileSync(script, "process.stdout.write(JSON.stringify(process.argv.slice(2)))");
      expect(JSON.parse(roundTrip([process.execPath, script, ...NASTY]))).toEqual(NASTY);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it.runIf(process.platform === "win32")("passes nasty args through a .cmd shim unchanged", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "getmyenv-args-"));
    try {
      fs.writeFileSync(path.join(dir, "echo.cjs"), "process.stdout.write(JSON.stringify(process.argv.slice(2)))");
      const shim = path.join(dir, "echo-shim.cmd");
      fs.writeFileSync(shim, `@"${process.execPath}" "%~dp0echo.cjs" %*\r\n`);
      expect(isWindowsBatch(shim, process.env)).toBe(true);
      expect(isWindowsBatch(path.join(dir, "echo-shim"), process.env)).toBe(true);
      expect(JSON.parse(roundTrip([shim, ...NASTY], { batch: true }))).toEqual(NASTY);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("isWindowsBatch", () => {
  // cmd.exe matches PATHEXT case-insensitively, which a Linux filesystem cannot mimic.
  it.runIf(process.platform === "win32")("finds .cmd files on PATH with PATHEXT", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "getmyenv-pathext-"));
    try {
      fs.writeFileSync(path.join(dir, "tool.cmd"), "@echo off\r\n");
      fs.writeFileSync(path.join(dir, "prog.exe"), "");
      const env = { Path: dir, PATHEXT: ".EXE;.CMD" };
      expect(isWindowsBatch("tool", env, os.tmpdir())).toBe(true);
      expect(isWindowsBatch("prog", env, os.tmpdir())).toBe(false);
      expect(isWindowsBatch("missing", env, os.tmpdir())).toBe(false);
      expect(isWindowsBatch("x.bat", env)).toBe(true);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("signalExitCode", () => {
  it("is 128 + the signal number", () => {
    expect(signalExitCode("SIGINT", { SIGINT: 2, SIGTERM: 15 })).toBe(130);
    expect(signalExitCode("SIGTERM", { SIGINT: 2, SIGTERM: 15 })).toBe(143);
  });

  it("falls back to 1 for unknown signals", () => {
    expect(signalExitCode("SIGUSR2", {})).toBe(1);
  });
});

describe("unsafe env names", () => {
  it("flags names that change how programs start", () => {
    for (const name of ["NODE_OPTIONS", "PATH", "LD_PRELOAD", "DYLD_INSERT_LIBRARIES", "BASH_ENV", "PYTHONSTARTUP"]) {
      expect(isUnsafeEnvName(name)).toBe(true);
    }
    for (const name of ["API_KEY", "DATABASE_URL", "NODE_ENV", "PATH_PREFIX", "OLD_PATH"]) {
      expect(isUnsafeEnvName(name)).toBe(false);
    }
  });

  it("flags program-starting prefixes and proxies, in any case", () => {
    for (const name of [
      "npm_config_script_shell",
      "NPM_CONFIG_NODE_OPTIONS",
      "Npm_Config_Onload_Script",
      "GIT_CONFIG_COUNT",
      "GIT_CONFIG_KEY_0",
      "GIT_ASKPASS",
      "GIT_EXTERNAL_DIFF",
      "GIT_SSH",
      "GIT_SSH_COMMAND",
      "PYTHONHOME",
      "PYTHONWARNINGS",
      "PERL5DB",
      "RUBYOPT",
      "RUBYLIB",
      "NODE_EXTRA_CA_CERTS",
      "NODE_PATH",
      "NODE_TLS_REJECT_UNAUTHORIZED",
      "BROWSER",
      "SSH_ASKPASS",
      "EDITOR",
      "VISUAL",
      "HTTP_PROXY",
      "https_proxy",
      "ALL_PROXY",
      "no_proxy",
    ]) {
      expect(isUnsafeEnvName(name), name).toBe(true);
    }
  });

  it("keeps common app names allowed", () => {
    for (const name of [
      "PORT",
      "NODE_ENV",
      "node_env",
      "PYTHONUNBUFFERED",
      "DATABASE_URL",
      "GITHUB_TOKEN",
      "GITHUB_CLIENT_SECRET",
      "NPM_TOKEN",
      "NEXT_PUBLIC_API_URL",
      "STRIPE_KEY",
    ]) {
      expect(isUnsafeEnvName(name), name).toBe(false);
    }
  });

  it("run refuses them by name, with the way out", () => {
    const msg = unsafeEnvError(["API_KEY", "NODE_OPTIONS", "LD_PRELOAD"], "development");
    expect(msg).toContain("development sets LD_PRELOAD, NODE_OPTIONS.");
    expect(msg).toContain("These change how programs start");
    expect(msg).toContain("npx getmyenv unset LD_PRELOAD NODE_OPTIONS --all");
    expect(unsafeEnvError(["PATH"], "development")).toContain("PATH. It changes how programs start");
    expect(msg).toContain("--allow-unsafe-env");
    expect(unsafeEnvError(["API_KEY"], "development")).toBeNull();
  });

  it("set and import warn", () => {
    expect(unsafeEnvWarning(["PATH"])).toBe(
      "PATH changes how programs start. run refuses it unless you pass --allow-unsafe-env."
    );
    expect(unsafeEnvWarning(["PATH", "NODE_OPTIONS"])).toContain("NODE_OPTIONS, PATH change how programs start. run refuses them");
    expect(unsafeEnvWarning(["API_KEY"])).toBeNull();
  });
});

describe("GETMYENV_* names from a context", () => {
  it("are never passed to the child, even when everything else is", () => {
    const r = mergeEnv(
      { GETMYENV_TOKEN: "parent-token" },
      { GETMYENV_API_URL: "https://evil.example", getmyenv_config_dir: "/tmp/x", API_KEY: "k" },
      [{ name: "GETMYENV_TOKEN", reason: "missing" }],
      false
    );
    expect(r.env).toEqual({ API_KEY: "k" });
    expect(r.applied).toEqual(["API_KEY"]);
    expect(r.ignored.sort()).toEqual(["GETMYENV_API_URL", "GETMYENV_TOKEN", "getmyenv_config_dir"]);
    expect(r.unresolved).toEqual([]);
    expect(r.filledByParent).toEqual([]);
    expect(unsafeEnvError(r.applied, "dev")).toBeNull();
  });

  it("set and import refuse them", () => {
    expect(ownEnvNameError(["GETMYENV_TOKEN", "API_KEY"])).toContain("GETMYENV_TOKEN");
    expect(ownEnvNameError(["API_KEY"])).toBeNull();
  });
});
