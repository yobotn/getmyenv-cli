import fs from "node:fs";
import path from "node:path";
import { pc } from "../lib/colors.js";
import { TOKEN_ENDED_CODE } from "@getmyenv/shared";
import {
  CLAIM_FILE_INVALID,
  claimFileInvalid,
  claimFilePath,
  clearClaimFile,
  getLocalDir,
  promptConfirm,
  readClaimFile,
  readProjectMeta,
  type ProjectMeta,
} from "../lib/fs.js";
import {
  clearFolderToken,
  isTrackedByGit,
  readFolderToken,
  readFolderTokenLenient,
  tokenFilePath,
} from "../lib/credentials.js";
import { clearCachedKeys, keychainAccount } from "../lib/keychain.js";
import { ApiClient, ApiError, resolveApiUrl } from "../lib/api.js";

export type UnlinkOpts = { apiUrl?: string; yes?: boolean; local?: boolean };

/** project.json as far as it can be read. A broken one is still removed with the token. */
function readMetaLenient(): ProjectMeta | null {
  try {
    return readProjectMeta();
  } catch {
    return null;
  }
}

/** token.json that exists but cannot be read as a token. Its token cannot be revoked from here. */
function tokenFileIsBroken(): boolean {
  if (!fs.existsSync(tokenFilePath())) return false;
  try {
    return readFolderToken() === null;
  } catch {
    return true;
  }
}

/** Why the revoke failed, and the ways on. Nothing was removed. */
export function revokeFailedMessage(opts: { unreachable: boolean; guest: boolean }): string {
  const first = opts.unreachable
    ? "Could not reach the server to revoke this folder's token. Nothing was removed."
    : "Could not revoke the token on the server. Nothing was removed.";
  const retry = opts.guest
    ? "Try again when the server is reachable."
    : "Try again, or revoke it in Project settings, Tokens first.";
  return `${first} ${retry} To remove only the local files: npx getmyenv unlink --local`;
}

/**
 * Unlink this folder: revoke its token and remove local getmyenv files.
 * The project, its contexts and values stay. A committed project.json stays
 * when this machine has no token: it belongs to the repo, not to this machine.
 * --local removes the files without revoking the token.
 */
export async function unlinkCommand(opts: UnlinkOpts): Promise<void> {
  const meta = readMetaLenient();
  const folder = readFolderTokenLenient();
  const brokenToken = tokenFileIsBroken();
  const projectFile = path.join(getLocalDir(), "project.json");
  const hasToken = Boolean(folder) || brokenToken;
  const keepProjectFile = !hasToken && fs.existsSync(projectFile) && isTrackedByGit(projectFile);
  if (!hasToken && !meta?.projectId && !fs.existsSync(projectFile)) {
    console.log(pc.dim("This folder is not linked."));
    return;
  }

  if (!opts.yes && !process.stdin.isTTY) {
    throw new Error(
      folder && !opts.local
        ? "Unlink revokes this folder's token. Without a terminal, pass --yes."
        : "Unlink removes this folder's .getmyenv files. Without a terminal, pass --yes."
    );
  }
  if (!opts.yes) {
    const label = meta?.projectName ?? meta?.projectId ?? "this folder";
    const tokenLine = !hasToken
      ? "This machine has no token for it. Removes the local .getmyenv files."
      : fs.existsSync(claimFilePath())
        ? "Removes .getmyenv files except claim.json. The guest token stays, so claim still works."
        : opts.local
          ? "Removes .getmyenv files without revoking the token."
          : "Revokes this folder's token and removes .getmyenv files.";
    const ok = await promptConfirm(`Unlink ${label}? ${tokenLine} The project and its values stay.`, {
      defaultYes: false,
    });
    if (!ok) {
      console.log(pc.dim("Kept."));
      return;
    }
  }

  let guestEnded = false;
  if (folder && opts.local) {
    console.log(
      pc.yellow(
        "The token was not revoked. It keeps working on the server until it expires or its project ends. Revoke it in Project settings, Tokens."
      )
    );
  } else if (folder) {
    try {
      const res = await new ApiClient(resolveApiUrl(opts.apiUrl), folder.token).request<{ revoked?: boolean }>(
        "DELETE",
        "/api/cli/token"
      );
      if (res?.revoked === false) {
        console.log(pc.dim("Guest token kept on the server, so claim still works with claim.json."));
      } else {
        console.log(`${pc.green("✓")} Token revoked`);
      }
    } catch (err) {
      // 401/404: the token is already gone on the server. Anything else keeps
      // token.json, so a still-valid token is never left without a local copy.
      if (!(err instanceof ApiError && (err.status === 401 || err.status === 404))) {
        throw new Error(
          revokeFailedMessage({
            unreachable: err instanceof ApiError && err.status === 0,
            guest: fs.existsSync(claimFilePath()),
          })
        );
      }
      console.log(pc.dim("The token already no longer works on the server."));
      // A guest token only ends when its project was claimed or deleted. claim.json is no use then.
      guestEnded = err.code === TOKEN_ENDED_CODE && readClaimFile() !== null;
    }
  } else if (brokenToken) {
    console.log(
      pc.yellow(
        "token.json was not valid, so its token could not be revoked from here. If it held one, revoke it in Project settings, Tokens."
      )
    );
  }
  const projectId = meta?.projectId ?? folder?.projectId;
  if (projectId && (await clearCachedKeys(keychainAccount(resolveApiUrl(opts.apiUrl), projectId)))) {
    console.log(`${pc.green("✓")} Removed the unlocked keys from the OS keychain`);
  }
  if (clearFolderToken()) console.log(`${pc.green("✓")} Removed token.json`);
  if (keepProjectFile) {
    console.log(pc.dim("Kept project.json. It is committed, so every clone knows its project."));
  } else if (fs.existsSync(projectFile)) {
    fs.unlinkSync(projectFile);
    console.log(`${pc.green("✓")} Removed project.json`);
  }
  if (guestEnded && clearClaimFile()) {
    console.log(`${pc.green("✓")} Removed claim.json. The guest project was claimed or deleted, so it has no use.`);
  } else if (claimFileInvalid()) {
    console.log(pc.yellow(`Kept claim.json. ${CLAIM_FILE_INVALID}`));
  } else if (readClaimFile()) {
    console.log(
      pc.yellow("Kept claim.json. It holds the claim code and guest passphrase. Delete it if you do not need the project.")
    );
  }
  try {
    const dir = getLocalDir();
    if (fs.readdirSync(dir).length === 0) fs.rmdirSync(dir);
  } catch {
    /* ignore */
  }
}
