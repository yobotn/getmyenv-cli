/**
 * Soft update nudge: compare running CLI_VERSION to npm latest.
 * Cache under ~/.config/getmyenv. Fail-open on network errors.
 */

import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pcErr as pc } from "./colors.js";
import { CLI_VERSION } from "./api.js";

const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const FETCH_TIMEOUT_MS = 2500;

type CacheFile = {
  latest: string;
  checkedAt: string;
};

function configDir(): string {
  return (
    process.env.GETMYENV_CONFIG_DIR?.trim() ||
    path.join(os.homedir(), ".config", "getmyenv")
  );
}

function cachePath(): string {
  return path.join(configDir(), "latest-version.json");
}

/** Simple semver compare for x.y.z (no prerelease). Returns -1 / 0 / 1. */
export function compareSemver(a: string, b: string): number {
  const pa = a.replace(/^v/, "").split(".").map((n) => parseInt(n, 10) || 0);
  const pb = b.replace(/^v/, "").split(".").map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < 3; i++) {
    const da = pa[i] ?? 0;
    const db = pb[i] ?? 0;
    if (da < db) return -1;
    if (da > db) return 1;
  }
  return 0;
}

function readCache(): CacheFile | null {
  try {
    const raw = fs.readFileSync(cachePath(), "utf8");
    const data = JSON.parse(raw) as CacheFile;
    if (!data.latest || !data.checkedAt) return null;
    const age = Date.now() - new Date(data.checkedAt).getTime();
    if (Number.isNaN(age) || age > CACHE_TTL_MS) return null;
    return data;
  } catch {
    return null;
  }
}

function looksLikeGlobalBin(): boolean {
  const argv1 = (process.argv[1] ?? "").toLowerCase();
  if (argv1.includes(`${path.sep}npx${path.sep}`) || argv1.includes("npm-cache")) {
    return false;
  }
  // Global installs typically live under npm global node_modules, not a project.
  if (
    argv1.includes(`${path.sep}node_modules${path.sep}`) &&
    (argv1.includes(`${path.sep}getmyenv${path.sep}`) ||
      argv1.endsWith(`${path.sep}getmyenv`))
  ) {
    const inProject = argv1.includes(
      `${path.sep}node_modules${path.sep}.bin${path.sep}`
    );
    if (!inProject && !argv1.includes(`${path.sep}.npm${path.sep}`)) {
      return true;
    }
  }
  return false;
}

function updateCommand(): string {
  return looksLikeGlobalBin()
    ? "npm i -g getmyenv@latest"
    : "npx getmyenv@latest";
}

/** Refresh the cache in a detached process so the command never waits on npm. */
function refreshInBackground(): void {
  const script = `(${fetchAndCache.toString()})(${JSON.stringify(cachePath())}, ${FETCH_TIMEOUT_MS})`;
  try {
    const child = spawn(process.execPath, ["-e", script], {
      detached: true,
      stdio: "ignore",
      windowsHide: true,
    });
    child.on("error", () => undefined);
    child.unref();
  } catch {
    /* fail open */
  }
}

/** Runs in the background child. Self-contained: no imports from this module. */
async function fetchAndCache(file: string, timeoutMs: number): Promise<void> {
  const fs = await import("node:fs");
  const path = await import("node:path");
  const ctrl = new AbortController();
  setTimeout(() => ctrl.abort(), timeoutMs).unref();
  try {
    const res = await fetch("https://registry.npmjs.org/getmyenv/latest", {
      signal: ctrl.signal,
      redirect: "error",
    });
    if (!res.ok) return;
    const data = (await res.json()) as { version?: string };
    if (!data.version) return;
    fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
    fs.writeFileSync(file, JSON.stringify({ latest: data.version, checkedAt: new Date().toISOString() }), {
      mode: 0o600,
    });
  } catch {
    /* fail open */
  }
}

/** One line for the nudge, or null when up to date or unknown. */
export function updateLine(current: string, latest: string | null): string | null {
  if (!latest || compareSemver(current, latest) >= 0) return null;
  return `getmyenv ${latest} is available (you have ${current}). Update: ${updateCommand()}`;
}

/**
 * Soft update nudge. Never blocks and never exits: one line on stderr from the
 * cached npm version, refreshed in the background once a day. Skipped in CI.
 */
export async function maybeSuggestUpdate(): Promise<void> {
  const ci = process.env.CI?.trim().toLowerCase();
  if (process.env.GETMYENV_SKIP_UPDATE === "1" || (ci && ci !== "false" && ci !== "0")) return;
  if (
    process.argv.includes("-V") ||
    process.argv.includes("--version") ||
    process.argv.includes("-h") ||
    process.argv.includes("--help")
  ) {
    return;
  }

  const cached = readCache();
  if (!cached) refreshInBackground();
  const line = updateLine(CLI_VERSION, cached?.latest ?? null);
  if (line) console.error(pc.yellow(line));
}
