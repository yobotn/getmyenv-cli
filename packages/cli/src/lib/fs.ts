import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import readline from "node:readline";
import dotenv from "dotenv";
import {
  CONTEXT_SLUG_RE,
  isValidContextSlug,
  isValidVariableName,
  LOCAL_DIR,
  VAULT_UNLOCK_DURATION,
  slugify,
} from "@getmyenv/shared";
import { restrictToOwner } from "./private-file.js";

/**
 * `.getmyenv/project.json`, committed so a clone knows its project.
 * Holds no API URL: a committed file must not redirect where tokens go.
 * `.getmyenv/template.json` is committed too: names only, see template-file.ts.
 */
export type ProjectMeta = {
  projectId?: string;
  projectName?: string;
  /** Default context slug for this folder. */
  context?: string;
};

const SLUG_RE = CONTEXT_SLUG_RE;

/**
 * Nearest folder at or above cwd with a linked `.getmyenv/`, so commands work
 * from subfolders. Stops at a git repo root. Falls back to cwd.
 */
export function getProjectRoot(cwd = process.cwd()): string {
  let dir = path.resolve(cwd);
  for (;;) {
    const local = path.join(dir, LOCAL_DIR);
    if (
      fs.existsSync(path.join(local, "project.json")) ||
      fs.existsSync(path.join(local, "token.json")) ||
      fs.existsSync(path.join(local, "template.json"))
    ) {
      return dir;
    }
    const parent = path.dirname(dir);
    if (parent === dir || fs.existsSync(path.join(dir, ".git"))) return path.resolve(cwd);
    dir = parent;
  }
}

export function getLocalDir(cwd = process.cwd()): string {
  return path.join(getProjectRoot(cwd), LOCAL_DIR);
}

/** Text of a file as UTF-8, without a byte order mark (Notepad and PowerShell 5.1 add one). */
export function readTextFile(file: string): string {
  return fs.readFileSync(file, "utf8").replace(/^﻿/, "");
}

/**
 * Parse a JSON file. Null when it does not exist. Invalid JSON throws
 * `invalid`: a broken file is never read as missing, so it is never
 * silently replaced.
 */
export function readJsonFile(file: string, invalid: string): unknown {
  if (!fs.existsSync(file)) return null;
  try {
    return JSON.parse(readTextFile(file));
  } catch {
    throw new Error(invalid);
  }
}

export const PROJECT_JSON_INVALID =
  ".getmyenv/project.json is not valid JSON. Fix it, or restore it: git checkout -- .getmyenv/project.json";

export function readProjectMeta(cwd = process.cwd()): ProjectMeta | null {
  const file = path.join(getLocalDir(cwd), "project.json");
  const raw = readJsonFile(file, PROJECT_JSON_INVALID);
  if (!raw || typeof raw !== "object") return null;
  const d = raw as Record<string, unknown>;
  const context =
    typeof d.context === "string" && SLUG_RE.test(d.context.trim())
      ? d.context.trim()
      : undefined;
  return {
    ...(typeof d.projectId === "string" && d.projectId
      ? { projectId: d.projectId }
      : {}),
    ...(typeof d.projectName === "string" && d.projectName.trim()
      ? { projectName: d.projectName.trim() }
      : {}),
    ...(context ? { context } : {}),
  };
}

export function writeProjectMeta(meta: ProjectMeta, cwd = process.cwd()): void {
  const dir = getLocalDir(cwd);
  fs.mkdirSync(dir, { recursive: true });
  const payload: ProjectMeta = {
    ...(meta.projectId != null ? { projectId: String(meta.projectId) } : {}),
    ...(meta.projectName?.trim()
      ? { projectName: meta.projectName.trim() }
      : {}),
    ...(meta.context && SLUG_RE.test(meta.context)
      ? { context: meta.context }
      : {}),
  };
  fs.writeFileSync(
    path.join(dir, "project.json"),
    JSON.stringify(payload, null, 2) + "\n",
    { mode: 0o600 }
  );
}

/**
 * Check that `file` can be written as a plain file: not a symlink, not a
 * folder, and its folder exists. Returns its stats, or null when it is new.
 */
export function assertFileTarget(file: string): fs.Stats | null {
  const stat = fs.lstatSync(file, { throwIfNoEntry: false }) ?? null;
  if (stat?.isSymbolicLink()) throw new Error(`${file} is a symlink. Refusing to write through it.`);
  if (stat?.isDirectory()) {
    throw new Error(`${file} is a folder. Pass a file name with -o.`);
  }
  if (stat && !stat.isFile()) throw new Error(`${file} is not a regular file.`);
  if (!stat) {
    const dir = path.dirname(path.resolve(file));
    if (!fs.statSync(dir, { throwIfNoEntry: false })?.isDirectory()) {
      throw new Error(`The folder ${path.dirname(file)} does not exist. Create it first, or pick another path with -o.`);
    }
  }
  return stat;
}

/**
 * Write a file only this user can read. Never through a symlink. A new file
 * is created with `wx`; an existing one is replaced only when `overwrite`.
 */
export function writePrivateFile(file: string, content: string, opts: { overwrite: boolean }): void {
  const stat = assertFileTarget(file);
  if (stat && !opts.overwrite) throw new Error(`${file} already exists. Pick another name with -o.`);
  fs.writeFileSync(file, content, { mode: 0o600, flag: stat ? "w" : "wx" });
  restrictToOwner(file);
}

/** OS user config for machine identity - never in the repo. */
export function getConfigDir(): string {
  const base =
    process.env.GETMYENV_CONFIG_DIR?.trim() ||
    path.join(os.homedir(), ".config", "getmyenv");
  fs.mkdirSync(base, { recursive: true, mode: 0o700 });
  return base;
}

/**
 * Leave stdin as we found it after raw-mode secret input: cooked mode, paused.
 * A flowing stdin keeps the process alive and, in `run`, reads keystrokes meant
 * for the child. readline resumes it when needed. Remove only our own listener:
 * readline adds its keypress listener once per stream and never again.
 */
function restoreStdinAfterRaw(onData?: (chunk: Buffer) => void): void {
  const stdin = process.stdin;
  try {
    stdin.setRawMode?.(false);
  } catch {
    /* ignore */
  }
  if (onData) stdin.removeListener("data", onData);
  stdin.pause();
}

/**
 * Read one line from a TTY without using raw mode.
 * Safe to call after promptHidden.
 */
export function readLine(question: string): Promise<string> {
  return new Promise((resolve, reject) => {
    if (!process.stdin.isTTY) {
      reject(new Error("Interactive input requires a TTY."));
      return;
    }
    restoreStdinAfterRaw();
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stderr,
      terminal: true,
    });
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer);
    });
  });
}

/**
 * Read a secret at a terminal without echo. Refuses without a terminal.
 * Always restores stdin so a later promptConfirm / promptChoice can run.
 */
export async function promptHidden(question: string): Promise<string> {
  const stdin = process.stdin;
  if (!stdin.isTTY) {
    throw new Error(
      `No terminal to ask for the Vault password. Run this same command once in a terminal to unlock. Open contexts then stay unlocked for ${VAULT_UNLOCK_DURATION}. On servers and in CI, use a server token.`
    );
  }

  // Prompts go to stderr so stdout stays clean for `export --stdout > .env` and pipes.
  const out = process.stderr;
  return new Promise((resolve, reject) => {
    out.write(question);
    let value = "";
    // A chunk can hold many characters (paste) or one escape sequence (arrow keys).
    const onData = (chunk: Buffer) => {
      const text = chunk.toString("utf8");
      if (text.startsWith("\u001b")) return;
      for (const c of text) {
        if (c === "\n" || c === "\r" || c === "\u0004") {
          restoreStdinAfterRaw(onData);
          out.write("\n");
          resolve(value);
          return;
        }
        if (c === "\u0003") {
          restoreStdinAfterRaw(onData);
          out.write("\n");
          process.exitCode = 130;
          reject(new Error("Cancelled."));
          return;
        }
        if (c === "\u007f" || c === "\b") {
          if (value.length > 0) {
            value = Array.from(value).slice(0, -1).join("");
            out.write("\b \b");
          }
          continue;
        }
        if (c < " ") continue;
        value += c;
        out.write("*");
      }
    };
    stdin.setRawMode?.(true);
    stdin.resume();
    stdin.on("data", onData);
  });
}

/** Yes/no on a TTY. Empty input picks the default, which is No unless `defaultYes`. */
export async function promptConfirm(
  question: string,
  opts?: { defaultYes?: boolean }
): Promise<boolean> {
  const defaultYes = opts?.defaultYes === true;
  const hint = defaultYes ? "[Y/n]" : "[y/N]";
  const answer = await readLine(`${question} ${hint} `);
  const trimmed = answer.trim();
  if (!trimmed) return defaultYes;
  if (defaultYes) return !/^n(o)?$/i.test(trimmed);
  return /^y(es)?$/i.test(trimmed);
}

/** 1-based numbered choice. Empty input selects defaultIndex (0-based). */
export async function promptChoice(
  question: string,
  options: string[],
  defaultIndex = 0
): Promise<number> {
  if (options.length === 0) {
    throw new Error("No options to choose from.");
  }
  if (options.length === 1) return 0;
  const def = Math.min(Math.max(defaultIndex, 0), options.length - 1);
  for (let i = 0; i < options.length; i++) {
    console.error(`  ${i + 1}) ${options[i]}`);
  }
  const answer = await readLine(`${question} [${def + 1}]: `);
  const trimmed = answer.trim();
  if (!trimmed) return def;
  const n = Number.parseInt(trimmed, 10);
  if (!Number.isFinite(n) || n < 1 || n > options.length) return def;
  return n - 1;
}

export function ensureGitignoreHasEnv(cwd = process.cwd()): void {
  const gi = path.join(getProjectRoot(cwd), ".gitignore");
  // project.json and template.json are committed so a clone knows its project
  // and its names. The token and the guest passphrase in claim.json stay on
  // this machine.
  const entries = [
    ".env",
    ".env.local",
    ".env.*.local",
    ".getmyenv/token.json",
    ".getmyenv/claim.json",
  ];
  let content = fs.existsSync(gi) ? fs.readFileSync(gi, "utf8") : "";
  let changed = false;

  for (const entry of entries) {
    if (!content.split(/\r?\n/).includes(entry)) {
      content +=
        (content.endsWith("\n") || content === "" ? "" : "\n") + entry + "\n";
      changed = true;
    }
  }
  if (changed) {
    fs.writeFileSync(gi, content);
  }
}

/** Ignore one plaintext file written by `export -o`. Files outside the project are left alone. */
export function ensureGitignoreHas(file: string, cwd = process.cwd()): void {
  const root = getProjectRoot(cwd);
  const rel = path.relative(root, path.resolve(cwd, file)).split(path.sep).join("/");
  if (!rel || rel.startsWith("..") || path.isAbsolute(rel)) return;
  const gi = path.join(root, ".gitignore");
  const content = fs.existsSync(gi) ? fs.readFileSync(gi, "utf8") : "";
  const lines = content.split(/\r?\n/);
  if (lines.includes(rel) || lines.includes(`/${rel}`)) return;
  fs.writeFileSync(
    gi,
    content + (content.endsWith("\n") || content === "" ? "" : "\n") + rel + "\n"
  );
}

export type ClaimFile = {
  version: 1;
  claimCode: string;
  /** Guest wrapping passphrase. Local and gitignored until claim. */
  passphrase: string;
  projectId: string;
  projectName: string;
  guestExpiresAt: string;
};

export function claimFilePath(cwd = process.cwd()): string {
  return path.join(getLocalDir(cwd), "claim.json");
}

export function readClaimFile(cwd = process.cwd()): ClaimFile | null {
  const file = claimFilePath(cwd);
  if (!fs.existsSync(file)) return null;
  try {
    const raw = JSON.parse(readTextFile(file)) as Partial<ClaimFile>;
    if (
      typeof raw.claimCode !== "string" ||
      typeof raw.passphrase !== "string" ||
      typeof raw.projectId !== "string" ||
      typeof raw.projectName !== "string" ||
      typeof raw.guestExpiresAt !== "string"
    ) {
      return null;
    }
    return {
      version: 1,
      claimCode: raw.claimCode,
      passphrase: raw.passphrase,
      projectId: raw.projectId,
      projectName: raw.projectName,
      guestExpiresAt: raw.guestExpiresAt,
    };
  } catch {
    return null;
  }
}

/** claim.json is there but cannot be read. It may hold the only copy of the guest passphrase. */
export function claimFileInvalid(cwd = process.cwd()): boolean {
  return fs.existsSync(claimFilePath(cwd)) && readClaimFile(cwd) === null;
}

/** Said whenever claim.json is there but cannot be read. Never write over it. */
export const CLAIM_FILE_INVALID =
  ".getmyenv/claim.json is not valid. It may hold the only copy of the guest passphrase, so it was not changed. Fix it or move it, then run again.";

export function writeClaimFile(data: Omit<ClaimFile, "version">, cwd = process.cwd()): string {
  const file = claimFilePath(cwd);
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const payload: ClaimFile = { version: 1, ...data };
  fs.writeFileSync(file, JSON.stringify(payload, null, 2) + "\n", {
    mode: 0o600,
  });
  restrictToOwner(file);
  return file;
}

export function clearClaimFile(cwd = process.cwd()): boolean {
  const file = claimFilePath(cwd);
  if (!fs.existsSync(file)) return false;
  fs.unlinkSync(file);
  return true;
}

/** dotenv rules (multiline values, inline comments, BOM). Invalid names land in `skipped`. */
export function readEnvText(text: string): { values: Record<string, string>; skipped: string[] } {
  const values: Record<string, string> = {};
  const skipped: string[] = [];
  for (const [key, value] of Object.entries(dotenv.parse(text))) {
    if (isValidVariableName(key)) values[key] = value;
    else skipped.push(key);
  }
  return { values, skipped };
}

/** `readEnvText`, valid names only. */
export function parseEnvText(text: string): Record<string, string> {
  return readEnvText(text).values;
}

/**
 * Text from bytes, by byte order mark: UTF-16 LE or BE (PowerShell 5.1 `>`
 * writes UTF-16 LE), else UTF-8 without its BOM.
 */
export function decodeText(buf: Buffer): string {
  if (buf.length >= 2 && buf[0] === 0xff && buf[1] === 0xfe) {
    return buf.subarray(2, 2 + ((buf.length - 2) & ~1)).toString("utf16le");
  }
  if (buf.length >= 2 && buf[0] === 0xfe && buf[1] === 0xff) {
    return Buffer.from(buf.subarray(2, 2 + ((buf.length - 2) & ~1))).swap16().toString("utf16le");
  }
  return buf.toString("utf8").replace(/^﻿/, "");
}

/** `readEnvText` for a file, UTF-8 or UTF-16. A missing file reads as empty. */
export function readEnvFile(filePath: string): { values: Record<string, string>; skipped: string[] } {
  if (!fs.existsSync(filePath)) return { values: {}, skipped: [] };
  return readEnvText(decodeText(fs.readFileSync(filePath)));
}

/** Names that appear more than once in an env file, with their count. dotenv keeps the last one. */
export function duplicateEnvNames(filePath: string): Array<{ name: string; count: number }> {
  if (!fs.existsSync(filePath)) return [];
  const counts = new Map<string, number>();
  const text = decodeText(fs.readFileSync(filePath));
  for (const line of splitEnvEntries(text)) {
    // Same line rule as dotenv: optional `export`, a name, then = or :.
    const m = line.match(/^\s*(?:export\s+)?([\w.-]+)\s*[=:]/);
    if (m?.[1]) counts.set(m[1], (counts.get(m[1]) ?? 0) + 1);
  }
  return [...counts.entries()].filter(([, n]) => n > 1).map(([name, count]) => ({ name, count }));
}

/** Lines of an env file, skipping the inside of quoted multiline values. */
function splitEnvEntries(text: string): string[] {
  const out: string[] = [];
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  let open: string | null = null;
  for (const line of lines) {
    if (open) {
      if (line.includes(open)) open = null;
      continue;
    }
    out.push(line);
    const m = line.match(/^\s*(?:export\s+)?[\w.-]+\s*[=:]\s*(["'`])(.*)$/);
    if (m && !m[2]!.includes(m[1]!)) open = m[1]!;
  }
  return out;
}

/** `parseEnvText` for a file. A missing file reads as empty. */
export function parseEnvFile(filePath: string): Record<string, string> {
  return readEnvFile(filePath).values;
}

const ENV_SKIP_DIRS = new Set([
  "node_modules",
  ".git",
  ".next",
  ".next-staging",
  ".next-prev",
  "dist",
  "build",
  "coverage",
  ".turbo",
  ".venv",
  "venv",
  ".pnpm-store",
  ".cache",
  "target",
  "vendor",
]);

const ENV_BASENAME_PRIORITY = [
  ".env.local",
  ".env",
  ".env.development.local",
  ".env.development",
  ".env.production.local",
  ".env.production",
];

const MAX_ENV_SCAN_DEPTH = 6;
const MAX_ENV_CANDIDATES = 50;

function isEnvCandidateName(name: string): boolean {
  if (!name.startsWith(".env")) return false;
  return /^\.env($|\.)/.test(name);
}

/** `.example`, `.sample` and `.template` files hold placeholders, not values. */
export function isEnvSampleFile(filePath: string): boolean {
  const base = path.basename(filePath).toLowerCase();
  return (
    base.endsWith(".example") ||
    base.endsWith(".sample") ||
    base.endsWith(".template")
  );
}

function basenamePriority(name: string): number {
  const idx = ENV_BASENAME_PRIORITY.indexOf(name);
  return idx === -1 ? ENV_BASENAME_PRIORITY.length : idx;
}

function compareEnvCandidates(a: string, b: string, cwd: string): number {
  const relA = path.relative(cwd, a);
  const relB = path.relative(cwd, b);
  const depthA = relA.split(path.sep).length;
  const depthB = relB.split(path.sep).length;
  if (depthA !== depthB) return depthA - depthB;
  const sampleA = isEnvSampleFile(a) ? 1 : 0;
  const sampleB = isEnvSampleFile(b) ? 1 : 0;
  if (sampleA !== sampleB) return sampleA - sampleB;
  const pri =
    basenamePriority(path.basename(a)) - basenamePriority(path.basename(b));
  if (pri !== 0) return pri;
  return relA.localeCompare(relB);
}

/**
 * Recursively find .env* files under cwd, including .example / .sample.
 * Skips common junk directories.
 */
export function listEnvFiles(cwd = process.cwd()): string[] {
  const root = path.resolve(cwd);
  const found: string[] = [];

  function walk(dir: string, depth: number): void {
    if (found.length >= MAX_ENV_CANDIDATES) return;
    if (depth > MAX_ENV_SCAN_DEPTH) return;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const ent of entries) {
      if (found.length >= MAX_ENV_CANDIDATES) return;
      const name = ent.name;
      if (ent.isDirectory()) {
        if (ENV_SKIP_DIRS.has(name)) continue;
        walk(path.join(dir, name), depth + 1);
        continue;
      }
      if (!ent.isFile() || !isEnvCandidateName(name)) continue;
      found.push(path.join(dir, name));
    }
  }

  walk(root, 0);
  found.sort((a, b) => compareEnvCandidates(a, b, root));
  return found;
}

/** Env files in this folder only (not subfolders). Samples skipped. */
export function rootEnvFiles(cwd = process.cwd()): string[] {
  const root = path.resolve(cwd);
  return listEnvFiles(root).filter(
    (f) => path.dirname(f) === root && !isEnvSampleFile(f)
  );
}

/**
 * Context slug implied by an env file name.
 * `.env.staging` and `.env.staging.local` map to `staging`.
 * `.env` and `.env.local` map to null (use the default context).
 * Sample files map to null too.
 */
export function contextSlugFromEnvFile(filePath: string): string | null {
  if (isEnvSampleFile(filePath)) return null;
  const base = path.basename(filePath).toLowerCase();
  const m = base.match(/^\.env\.(.+?)(?:\.local)?$/);
  if (!m?.[1] || m[1] === "local") return null;
  const slug = slugify(m[1]);
  return isValidContextSlug(slug) ? slug : null;
}
