import { randomBytes } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { pcErr as pc } from "../lib/colors.js";
import { createUserKeys, wipe } from "@getmyenv/crypto";
import { FACTS, TEMPLATE_FILE } from "@getmyenv/shared";
import {
  ensureGitignoreHasEnv,
  claimFilePath,
  readProjectMeta,
  writeClaimFile,
  writeProjectMeta,
} from "../lib/fs.js";
import { readFolderToken, writeFolderToken } from "../lib/credentials.js";
import { ApiClient, resolveApiUrl } from "../lib/api.js";
import { readTemplateFile } from "../lib/template-file.js";

export type GuestOpts = {
  name?: string;
  apiUrl?: string;
};

type CreateGuestOpts = GuestOpts & {
  /** The caller says that project.json now points to the new project. Without it, this function says so. */
  replaceProjectMeta?: boolean;
};

export function folderNameHint(): string {
  return path.basename(process.cwd()) || "project";
}

/**
 * Create an unclaimed guest project with one open context, Development.
 * Writes token.json and claim.json (gitignored) and project.json (committed).
 * claim.json holds the guest passphrase that wraps the guest key until claim.
 */
export async function createGuestProject(opts: CreateGuestOpts = {}): Promise<{
  projectId: string;
  projectName: string;
  guestExpiresAt: string;
}> {
  // Only a token links this folder on this machine. A committed project.json
  // alone (a clone) is replaced once the new project exists.
  const previous = readProjectMeta();
  if (readFolderToken()) {
    const name = previous?.projectName ?? previous?.projectId;
    throw new Error(
      `This folder is already linked${name ? ` to ${name}` : ""}. See it: npx getmyenv status. To start over: npx getmyenv unlink, then npx getmyenv guest`
    );
  }
  // claim.json is the only copy of a guest project's passphrase. Never write over
  // it, even when it does not parse.
  if (fs.existsSync(claimFilePath())) {
    throw new Error(
      "This folder has a guest project (claim.json) but no token on this machine. Claim it: npx getmyenv claim"
    );
  }
  const apiUrl = resolveApiUrl(opts.apiUrl);
  const name = (opts.name?.trim() || folderNameHint()).slice(0, 120);
  const passphrase = randomBytes(32).toString("base64url");
  const guestKeys = await createUserKeys(passphrase);
  wipe(guestKeys.privateKey);

  type CreateRes = {
    projectId: string;
    projectName: string;
    token: string;
    claimCode: string;
    guestExpiresAt: string;
    context: string;
  };
  let created: CreateRes;
  try {
    created = await new ApiClient(apiUrl).request<CreateRes>("POST", "/api/anon-projects", {
      name,
      keys: { publicKey: guestKeys.publicKey, wrappedPrivateKey: guestKeys.wrapped },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`Could not create a guest project: ${msg}`);
  }

  writeFolderToken({ token: created.token, apiUrl, projectId: created.projectId });
  writeProjectMeta({
    projectId: created.projectId,
    projectName: created.projectName,
    context: created.context,
  });
  writeClaimFile({
    claimCode: created.claimCode,
    passphrase,
    projectId: created.projectId,
    projectName: created.projectName,
    guestExpiresAt: created.guestExpiresAt,
  });
  ensureGitignoreHasEnv();

  console.error(`${pc.green("✓")} Guest project ${pc.bold(created.projectName)}. Context: development.`);
  if (previous?.projectId && previous.projectId !== created.projectId && !opts.replaceProjectMeta) {
    console.error(
      pc.dim(`project.json now points to ${created.projectName}. It pointed to ${previous.projectName ?? previous.projectId}.`)
    );
  }
  console.error(pc.dim(`${FACTS.guestShort} ${FACTS.committedFiles}`));
  if (process.stdin.isTTY) {
    console.error(
      pc.dim("claim.json holds the claim code and guest passphrase. Shown once, save them to claim later:")
    );
    console.error(`  ${pc.dim("Claim code:")}       ${created.claimCode}`);
    console.error(`  ${pc.dim("Guest passphrase:")} ${passphrase}\n`);
  } else {
    console.error(
      pc.dim(
        `claim.json holds the claim code and guest passphrase. It is the only copy. Keep it private. ${FACTS.claimLoss} ${FACTS.templateFileRecovery}\n`
      )
    );
  }
  return created;
}

/** The steps printed after guest, in plain text. Runtime first, export only as an alternative. */
export function guestNextLines(): string[] {
  return [
    "Next:",
    "  npx getmyenv import            # from .env",
    "  npx getmyenv set API_KEY       # or one at a time",
    "  npx getmyenv run -- npm start  # your start command, no .env file on disk",
    "  npx getmyenv claim             # keep it, with an account",
    "",
    "Only if a tool needs a .env file:",
    "  npx getmyenv export            # writes a plaintext .env",
    "",
    `For AI agents: ${FACTS.agentRunOrExport}`,
    `For AI agents: ${FACTS.agentSecretInput}`,
  ];
}

function colorNextLine(line: string): string {
  const hash = line.indexOf("# ");
  if (line.startsWith("  npx ") && hash > 0) {
    return pc.cyan(line.slice(0, hash)) + pc.dim(line.slice(hash));
  }
  if (line.startsWith("For AI agents:")) return pc.dim(line);
  return line;
}

export async function guestCommand(opts: GuestOpts = {}): Promise<void> {
  console.error(pc.bold("\ngetmyenv guest\n"));
  const read = readTemplateFile();
  if (read && !read.ok) console.error(pc.yellow(`${TEMPLATE_FILE} is not valid (${read.reason}). Not used.\n`));
  const file = read?.ok ? read.file : null;
  const name = opts.name ?? file?.name;
  await createGuestProject({ ...opts, ...(name ? { name } : {}) });
  if (file && file.keys.length > 0) {
    const { applyTemplateFile } = await import("./template.js");
    await applyTemplateFile(file, { apiUrl: opts.apiUrl, ask: false });
  }
  for (const line of guestNextLines()) console.error(colorNextLine(line));
  console.error("");
}
