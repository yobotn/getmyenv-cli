import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { getLocalDir, getProjectRoot, readJsonFile } from "./fs.js";
import { apiUrlForDisk } from "./api-url.js";
import { restrictToOwner } from "./private-file.js";

/** True when git tracks this file. False without git or outside a repo. */
export function isTrackedByGit(file: string, cwd = process.cwd()): boolean {
  try {
    const res = spawnSync("git", ["ls-files", "--error-unmatch", "--", file], {
      cwd: getProjectRoot(cwd),
      stdio: "ignore",
      timeout: 5000,
    });
    return res.status === 0;
  } catch {
    return false;
  }
}

/** A committed token.json is readable by anyone with the repo. Refuse to use it. */
export function assertTokenNotCommitted(cwd = process.cwd()): void {
  const file = tokenFilePath(cwd);
  if (fs.existsSync(file) && isTrackedByGit(file, cwd)) {
    throw new Error(
      [
        ".getmyenv/token.json is committed to git. Anyone with the repo can use it.",
        "Revoke it in Project settings, Tokens, then: git rm --cached .getmyenv/token.json",
        "Then run: npx getmyenv unlink, and npx getmyenv",
      ].join("\n")
    );
  }
}

/**
 * Per-folder token stored in `.getmyenv/token.json` (gitignored).
 * One folder = one project = one token. What the token can reach is decided
 * by the server (folder, guest or server token), not by this file.
 */
export type FolderToken = {
  version: 2;
  token: string;
  apiUrl?: string;
  projectId: string;
  addedAt: string;
};

export function tokenFilePath(cwd = process.cwd()): string {
  return path.join(getLocalDir(cwd), "token.json");
}

export const TOKEN_JSON_INVALID =
  ".getmyenv/token.json is not valid JSON. Fix it, or run: npx getmyenv unlink --yes, then npx getmyenv";

/** Null when there is no token.json. Throws TOKEN_JSON_INVALID when it is not JSON. */
export function readFolderToken(cwd = process.cwd()): FolderToken | null {
  const raw = readJsonFile(tokenFilePath(cwd), TOKEN_JSON_INVALID);
  if (!raw || typeof raw !== "object") return null;
  const d = raw as Record<string, unknown>;
  if (d.version !== 2) return null;
  if (typeof d.token !== "string" || !d.token.trim()) return null;
  if (typeof d.projectId !== "string" || !d.projectId) return null;
  if (typeof d.addedAt !== "string" || !d.addedAt) return null;
  return {
    version: 2,
    token: d.token.trim(),
    apiUrl:
      typeof d.apiUrl === "string" && d.apiUrl.trim()
        ? d.apiUrl.trim()
        : undefined,
    projectId: d.projectId,
    addedAt: d.addedAt,
  };
}

/** `readFolderToken`, with an invalid token.json read as none. For unlink and the API URL only. */
export function readFolderTokenLenient(cwd = process.cwd()): FolderToken | null {
  try {
    return readFolderToken(cwd);
  } catch {
    return null;
  }
}

export function writeFolderToken(
  entry: { token: string; apiUrl?: string; projectId: string; addedAt?: string },
  cwd = process.cwd()
): string {
  const file = tokenFilePath(cwd);
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const diskApi = apiUrlForDisk(entry.apiUrl);
  const payload: FolderToken = {
    version: 2,
    token: entry.token.trim(),
    projectId: String(entry.projectId),
    ...(diskApi ? { apiUrl: diskApi } : {}),
    addedAt: entry.addedAt ?? new Date().toISOString(),
  };
  fs.writeFileSync(file, JSON.stringify(payload, null, 2) + "\n", {
    mode: 0o600,
  });
  restrictToOwner(file);
  return file;
}

export function clearFolderToken(cwd = process.cwd()): boolean {
  const file = tokenFilePath(cwd);
  if (!fs.existsSync(file)) return false;
  fs.unlinkSync(file);
  return true;
}
