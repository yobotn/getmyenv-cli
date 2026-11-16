import { pcErr as pc } from "../lib/colors.js";
import { GUEST_GRACE_DAYS } from "@getmyenv/shared";
import {
  openSealedKey,
  sealContextKey,
  unwrapPrivateKey,
  wipe,
} from "@getmyenv/crypto";
import {
  clearClaimFile,
  ensureGitignoreHasEnv,
  promptHidden,
  readClaimFile,
  claimFileInvalid,
  CLAIM_FILE_INVALID,
  readLine,
  readProjectMeta,
  writeClaimFile,
  writeProjectMeta,
  type ClaimFile,
} from "../lib/fs.js";
import { readFolderToken, writeFolderToken } from "../lib/credentials.js";
import { ApiClient, ApiError, resolveApiUrl, type WhoamiResponse } from "../lib/api.js";
import { authorizeFolder, openBrowser, pollWithRetry, sleep } from "../lib/authorize.js";
import { createAccountKeys, type NewAccountKeys } from "../lib/recovery-code.js";
import type { VaultInfo } from "../lib/vault.js";

export type ClaimOpts = { apiUrl?: string };

type StartRes =
  | { status: "invalid" | "claimed" | "expired" }
  | {
      status: "claimable";
      sessionId: string;
      pollSecret: string;
      userCode: string;
      expiresAt: string;
    };

type PollRes = {
  status: "pending" | "approved" | "consumed" | "expired";
  token?: string;
};

async function askNewAccountKeys(): Promise<NewAccountKeys> {
  try {
    return await createAccountKeys();
  } catch (err) {
    throw new Error(`${err instanceof Error ? err.message : "Vault password required."} Run claim again.`);
  }
}

/**
 * Hand the context keys to the owner. The guest key opens them with the
 * claim.json passphrase, they are sealed to the owner's public key, and the
 * guest keys are deleted. Values stay as they are.
 */
async function finishClaim(owned: ApiClient, claim: ClaimFile): Promise<void> {
  const vault = await owned.request<VaultInfo>("GET", "/api/cli/vault");
  if (!vault.claim) {
    clearClaimFile();
    console.error(`${pc.green("✓")} ${pc.bold(claim.projectName)} is already set up. claim.json was removed.\n`);
    return;
  }

  let guestKey: Uint8Array;
  try {
    guestKey = await unwrapPrivateKey(claim.passphrase, vault.claim.wrappedPrivateKey);
  } catch {
    throw new Error(
      "The guest passphrase does not open this project. Delete .getmyenv/claim.json and run claim again with the passphrase shown at creation."
    );
  }

  let ownerPublicKey = vault.publicKey;
  let keys: NewAccountKeys["keys"] | undefined;
  try {
    if (!ownerPublicKey) {
      const created = await askNewAccountKeys();
      wipe(created.privateKey);
      ownerPublicKey = created.publicKey;
      keys = created.keys;
    }
    const shares = vault.claim.shares.map((s) => {
      const key = openSealedKey(s.sealedKey, guestKey, s.contextId);
      try {
        return { contextId: s.contextId, sealedKey: sealContextKey(key, ownerPublicKey!, s.contextId) };
      } finally {
        wipe(key);
      }
    });
    await owned.request("POST", "/api/cli/vault/claim", {
      claimCode: claim.claimCode,
      ...(keys ? { keys } : {}),
      shares,
    });
  } finally {
    wipe(guestKey);
  }

  clearClaimFile();
  ensureGitignoreHasEnv();
  console.error(
    `\n${pc.green("✓")} Claimed ${pc.bold(claim.projectName)}. ${keys ? "Vault password and recovery code set." : "It opens with your Vault password."}`
  );
  console.error(
    pc.dim("claim.json was removed. Read-only contexts like Production are now available in the dashboard.\n")
  );
}

/** A signed-in folder token for the claimed project: reuse this folder's, or sign in. */
async function ownerClient(apiUrl: string, claim: ClaimFile): Promise<ApiClient> {
  const existing = readFolderToken();
  if (existing?.projectId === claim.projectId) {
    const client = new ApiClient(apiUrl, existing.token);
    try {
      const who = await client.request<WhoamiResponse>("GET", "/api/cli/whoami");
      if (!who.isGuest && who.token.kind === "folder") return client;
    } catch (err) {
      if (!(err instanceof ApiError)) throw err;
    }
  }
  console.error(pc.dim("Sign in and pick this project to finish.\n"));
  const pickAgain = (picked: string) => `You picked ${picked}. Run claim again and pick ${claim.projectName}.`;
  const who = await authorizeFolder({
    apiUrl,
    expected: { id: claim.projectId, name: claim.projectName, mismatch: pickAgain },
  });
  if (who.project.id !== claim.projectId) {
    throw new Error(pickAgain(who.project.name));
  }
  const token = readFolderToken()?.token;
  if (!token) throw new Error("Sign-in did not save a token. Run claim again.");
  return new ApiClient(apiUrl, token);
}

/** Claimed in the browser, but the CLI never finished. Finish with claim.json. */
async function resumeClaim(apiUrl: string, claim: ClaimFile): Promise<void> {
  console.error(pc.dim("This project is already claimed. Handing its keys to your account.\n"));
  await finishClaim(await ownerClient(apiUrl, claim), claim);
}

/** No claim.json here: ask for the claim code and guest passphrase printed when the project was created. */
async function askClaimDetails(): Promise<ClaimFile> {
  const meta = readProjectMeta();
  if (!meta?.projectId) {
    throw new Error(
      "No .getmyenv/claim.json or project.json in this folder. Run claim in the folder that created the guest project."
    );
  }
  console.error(pc.dim("No .getmyenv/claim.json here. Enter the claim code and guest passphrase shown when the project was created.\n"));
  const claimCode = (await readLine("Claim code: ")).trim();
  const passphrase = (await promptHidden("Guest passphrase (hidden): ")).trim();
  if (!claimCode || !passphrase) throw new Error("Claim code and guest passphrase required.");
  const data = {
    claimCode,
    passphrase,
    projectId: meta.projectId,
    projectName: meta.projectName ?? "this project",
    guestExpiresAt: "",
  };
  ensureGitignoreHasEnv();
  writeClaimFile(data);
  return { version: 1, ...data };
}

/**
 * Claim a guest project: sign in and take ownership in the browser, then
 * hand the context keys to the owner's account.
 */
export async function claimCommand(opts: ClaimOpts = {}): Promise<void> {
  console.error(pc.bold("\ngetmyenv claim\n"));

  if (!process.stdin.isTTY) {
    throw new Error("Claim needs a terminal. Run: npx getmyenv claim");
  }
  if (claimFileInvalid()) throw new Error(CLAIM_FILE_INVALID);
  const claim = readClaimFile() ?? (await askClaimDetails());

  const apiUrl = resolveApiUrl(opts.apiUrl);
  const client = new ApiClient(apiUrl);
  const start = await client.request<StartRes>("POST", "/api/claim/start", {
    claimCode: claim.claimCode,
  });
  if (start.status === "invalid") {
    throw new Error("This claim code is not valid. Check .getmyenv/claim.json or the code shown at creation.");
  }
  if (start.status === "expired") {
    throw new Error(`This guest project expired more than ${GUEST_GRACE_DAYS} days ago. It can no longer be claimed.`);
  }
  if (start.status === "claimed") {
    await resumeClaim(apiUrl, claim);
    return;
  }
  if (start.status !== "claimable") throw new Error("Unexpected claim status. Run claim again.");
  const session = start;

  const base = apiUrl.replace(/\/$/, "");
  // After #, so the claim code never reaches the server, proxy logs or browser history requests.
  const claimUrl = `${base}/claim#code=${encodeURIComponent(claim.claimCode)}&session=${encodeURIComponent(session.sessionId)}`;
  console.error("\nOpen this URL to claim the project:\n");
  console.error(`  ${claimUrl}\n`);
  console.error(`Enter this code on the page: ${pc.bold(session.userCode)}\n`);
  openBrowser(claimUrl);
  console.error(pc.dim("Opened in your browser. Waiting...\n"));

  const deadline = new Date(session.expiresAt).getTime();
  let newToken: string | null = null;
  while (Date.now() < deadline) {
    // A dropped connection or a server hiccup is retried until the deadline.
    const poll = await pollWithRetry(
      () =>
        client.request<PollRes>("POST", "/api/claim/poll", {
          claimCode: claim.claimCode,
          sessionId: session.sessionId,
          pollSecret: session.pollSecret,
        }),
      deadline
    );
    if (!poll) break;
    if (poll.status === "approved" && poll.token) {
      newToken = poll.token;
      break;
    }
    if (poll.status === "consumed") {
      throw new Error("This claim session was already used. Run claim again.");
    }
    if (poll.status === "expired") {
      throw new Error("Claim session expired. Run claim again.");
    }
    const remaining = Math.max(0, Math.ceil((deadline - Date.now()) / 1000));
    process.stderr.write(`\r${pc.dim(`Waiting... ${String(remaining).padStart(2, "0")}s`)}   `);
    await sleep(2000);
  }
  process.stderr.write("\n");
  if (!newToken) throw new Error("Claim timed out. Run claim again.");

  writeFolderToken({ token: newToken, apiUrl, projectId: claim.projectId });
  const meta = readProjectMeta();
  writeProjectMeta({
    ...(meta ?? {}),
    projectId: claim.projectId,
    projectName: claim.projectName,
  });

  await finishClaim(new ApiClient(apiUrl, newToken), claim);
}
