/**
 * Pack @getmyenv/shared, @getmyenv/crypto and getmyenv, install them into an
 * empty temp project with npm, and run `npx getmyenv` there with no TTY and
 * temp config dirs. Used by smoke-cli.mjs and e2e-cli.mjs.
 */
import { execFileSync, spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
export const isWindows = process.platform === "win32";
const PACKAGES = ["packages/shared", "packages/crypto", "packages/cli"];

export function assertBuilt() {
  for (const pkg of PACKAGES) {
    if (!fs.existsSync(path.join(root, pkg, "dist"))) {
      console.error(`${pkg}/dist is missing. Build shared, crypto and the CLI first: pnpm build:packages`);
      process.exit(1);
    }
  }
}

export async function loadShared() {
  return import(pathToFileURL(path.join(root, "packages/shared/dist/index.js")).href);
}

export function cliVersion() {
  return JSON.parse(fs.readFileSync(path.join(root, "packages/cli/package.json"), "utf8")).version;
}

/** Windows needs the shell to find pnpm.cmd, npm.cmd and npx.cmd, so args with spaces are quoted there. */
export function shellLine(cmd, args) {
  return [cmd, ...args.map((a) => (/\s/.test(a) ? `"${a}"` : a))].join(" ");
}

function sh(cmd, args, opts = {}) {
  return isWindows
    ? execFileSync(shellLine(cmd, args), { shell: true, encoding: "utf8", ...opts })
    : execFileSync(cmd, args, { encoding: "utf8", ...opts });
}

/** Packs the three packages and installs them into `<tmp>/app`. */
export function packAndInstall(prefix) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  const tarballs = path.join(tmp, "tarballs");
  const app = path.join(tmp, "app");
  const home = path.join(tmp, "home");
  for (const dir of [tarballs, app, home]) fs.mkdirSync(dir, { recursive: true });

  console.log(`Packing into ${tarballs}`);
  for (const pkg of PACKAGES) {
    sh("pnpm", ["pack", "--pack-destination", tarballs], { cwd: path.join(root, pkg), stdio: "pipe" });
  }
  const packed = fs.readdirSync(tarballs).filter((f) => f.endsWith(".tgz"));
  if (packed.length !== PACKAGES.length) {
    console.error(`Expected ${PACKAGES.length} tarballs, got: ${packed.join(", ") || "none"}`);
    process.exit(1);
  }

  fs.writeFileSync(path.join(app, "package.json"), JSON.stringify({ name: "getmyenv-test-app", private: true }, null, 2));
  console.log("Installing the tarballs with npm");
  sh(
    "npm",
    ["install", "--no-audit", "--no-fund", "--loglevel=error", ...packed.map((f) => path.join(tarballs, f))],
    { cwd: app, stdio: "inherit" }
  );
  return { tmp, app, home };
}

/** The parent env without GETMYENV_*, with temp home and config dirs. */
export function cliEnv({ tmp, home, apiUrl }) {
  const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.toUpperCase().startsWith("GETMYENV_")));
  return Object.assign(env, {
    HOME: home,
    USERPROFILE: home,
    XDG_CONFIG_HOME: path.join(home, ".config"),
    GETMYENV_CONFIG_DIR: path.join(tmp, "config"),
    GETMYENV_API_URL: apiUrl,
    GETMYENV_SKIP_UPDATE: "1",
    GETMYENV_KEYCHAIN: "0",
    NO_COLOR: "1",
  });
}

/** Runs `npx --no-install getmyenv ...args` in `cwd`. stdin is closed, so there is no TTY. */
export function cliRunner({ cwd, env: baseEnv }) {
  return function getmyenv(args, extraEnv = {}) {
    const env = { ...baseEnv, ...extraEnv };
    const line = shellLine("npx", ["--no-install", "getmyenv", ...args]);
    const r = isWindows
      ? spawnSync(line, { cwd, env, shell: true, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] })
      : spawnSync("npx", ["--no-install", "getmyenv", ...args], {
          cwd,
          env,
          encoding: "utf8",
          stdio: ["ignore", "pipe", "pipe"],
        });
    return { line, status: r.status, stdout: r.stdout ?? "", stderr: r.stderr ?? "" };
  };
}

/**
 * Like cliRunner, but does not block the event loop, so an in-process server
 * (the fault proxy) keeps answering. Returns the child and a promise of the result.
 */
export function cliSpawner({ cwd, env: baseEnv }) {
  return function getmyenv(args, extraEnv = {}) {
    const env = { ...baseEnv, ...extraEnv };
    const line = shellLine("npx", ["--no-install", "getmyenv", ...args]);
    const opts = { cwd, env, stdio: ["ignore", "pipe", "pipe"] };
    const child = isWindows
      ? spawn(line, { ...opts, shell: true })
      : spawn("npx", ["--no-install", "getmyenv", ...args], opts);
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (c) => (stdout += c));
    child.stderr.on("data", (c) => (stderr += c));
    const done = new Promise((resolve) => {
      child.on("close", (status) => resolve({ line, status, stdout, stderr }));
    });
    return { child, done };
  };
}

/** Collects checks and prints a report. */
export function checker() {
  const failures = [];
  return {
    check(name, ok, r) {
      console.log(`${ok ? "ok  " : "FAIL"}  ${name}`);
      if (!ok) failures.push({ name, r });
      return ok;
    },
    finish(tmp, success) {
      if (process.argv.includes("--keep")) {
        console.log(`Kept ${tmp}`);
      } else {
        fs.rmSync(tmp, { recursive: true, force: true });
      }
      if (failures.length > 0) {
        console.error(`\n${failures.length} check(s) failed.`);
        for (const { name, r } of failures) {
          console.error(`\n- ${name}`);
          if (r) {
            console.error(`  $ ${r.line}\n  exit ${r.status}\n  stdout: ${r.stdout.trim()}\n  stderr: ${r.stderr.trim()}`);
          }
        }
        process.exit(1);
      }
      console.log(`\n${success}`);
    },
  };
}
