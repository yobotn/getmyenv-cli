import { pcErr as pc } from "./colors.js";
import fs from "node:fs";
import path from "node:path";
import { GUEST_ACTIVE_DAYS, GUEST_GRACE_MS, TEMPLATE_FILE, TOKEN_ENDED_CODE } from "@getmyenv/shared";
import {
  ensureGitignoreHasEnv,
  getLocalDir,
  readClaimFile,
  readProjectMeta,
  writeProjectMeta,
  type ProjectMeta,
} from "./fs.js";
import {
  ApiClient,
  ApiError,
  getSessionToken,
  resolveApiUrl,
  type WhoamiResponse,
} from "./api.js";
import { assertTokenNotCommitted } from "./credentials.js";

export type Linked = {
  who: WhoamiResponse;
  apiUrl: string;
  token: string;
  client: ApiClient;
  meta: ProjectMeta | null;
};

export const NOT_LINKED_STEPS = [
  "This folder is not linked to a getmyenv project.",
  "Start in a terminal: npx getmyenv",
  "Without an account: npx getmyenv guest",
  "In CI: set GETMYENV_TOKEN",
].join("\n");

/**
 * Next steps for a folder with no token on this machine. A clone with a
 * committed project.json gets its project named: it is not a new folder.
 */
export function notLinkedMessage(meta: ProjectMeta | null = readProjectMeta()): string {
  if (!meta?.projectId) return NOT_LINKED_STEPS;
  const hasTemplate = fs.existsSync(path.join(getLocalDir(), "template.json"));
  return [
    `This folder belongs to ${meta.projectName ?? meta.projectId}, but this machine has no token for it.`,
    "In a terminal: npx getmyenv (sign in)",
    ...(hasTemplate ? [`Or start your own project from ${TEMPLATE_FILE}: npx getmyenv guest`] : []),
    "In CI: set GETMYENV_TOKEN",
  ].join("\n");
}

export function printGuestBanner(who: WhoamiResponse): void {
  if (!who.isGuest) return;
  const DAY = 24 * 60 * 60 * 1000;
  const expires = who.guestExpiresAt ? new Date(who.guestExpiresAt).getTime() : NaN;
  const needClaim = readClaimFile() ? "" : " Needs the claim code and guest passphrase shown at creation.";
  const plural = (n: number) => `${n} day${n === 1 ? "" : "s"}`;
  if (Number.isFinite(expires) && expires <= Date.now()) {
    const graceLeft = Math.max(0, Math.ceil((expires + GUEST_GRACE_MS - Date.now()) / DAY));
    console.error(
      pc.yellow(
        `Guest project expired. Values can't change. run works for ${plural(graceLeft)} more. Export or claim it: npx getmyenv claim.${needClaim}\n`
      )
    );
    return;
  }
  const daysLeft = Number.isFinite(expires) ? Math.max(0, Math.ceil((expires - Date.now()) / DAY)) : null;
  // Each use moves the date to GUEST_ACTIVE_DAYS from now, so a countdown only means
  // something once the cap after creation is closer than that.
  const when =
    daysLeft != null && daysLeft < GUEST_ACTIVE_DAYS
      ? `Expires in ${plural(daysLeft)}.`
      : `Expires after ${plural(GUEST_ACTIVE_DAYS)} without use.`;
  console.error(pc.yellow(`Guest project. ${when} Keep it: npx getmyenv claim.${needClaim}\n`));
}

/** The step the server suggests after a guest project was claimed. */
const CLAIMED_NEXT_STEP = /\s*(Run: npx getmyenv unlink, then npx getmyenv|Sign in: npx getmyenv)\s*$/;

/**
 * A claimed guest project whose keys may still be sealed to the guest key:
 * claim.json finishes the hand-over, and unlink would be the wrong step.
 * Any other message is returned as is.
 */
export function claimedGuestMessage(message: string, hasClaimFile: boolean): string {
  if (!hasClaimFile || !/\bwas claimed\./.test(message)) return message;
  return `${message.replace(CLAIMED_NEXT_STEP, "")} Finish the claim in this folder: npx getmyenv claim`;
}

export async function fetchWhoami(client: ApiClient): Promise<WhoamiResponse> {
  try {
    return await client.request<WhoamiResponse>("GET", "/api/cli/whoami");
  } catch (err) {
    if (err instanceof ApiError && err.status === 410) {
      throw new Error(claimedGuestMessage(err.message, readClaimFile() !== null));
    }
    if (err instanceof ApiError && err.status === 401 && err.code === TOKEN_ENDED_CODE) {
      throw new Error(claimedGuestMessage(err.message, readClaimFile() !== null));
    }
    if (err instanceof ApiError && err.status === 401) {
      throw new Error(
        process.env.GETMYENV_TOKEN?.trim()
          ? "GETMYENV_TOKEN no longer works. It was revoked or expired. Create a new token in Project settings, Tokens."
          : "This folder's token no longer works. It was revoked or expired. Run: npx getmyenv unlink, then npx getmyenv"
      );
    }
    throw err;
  }
}

/**
 * Make sure this folder has a token, then load whoami.
 * No token: a terminal runs guided setup; anything else gets next steps.
 * project.json is refreshed from whoami (name, id) and keeps its context.
 */
export async function ensureTokenAndLink(opts: { apiUrl?: string; quiet?: boolean } = {}): Promise<Linked> {
  if (!getSessionToken()) {
    if (!process.stdin.isTTY) {
      throw new Error(notLinkedMessage());
    }
    const { startSetup } = await import("../commands/start.js");
    await startSetup({ apiUrl: opts.apiUrl, thenContinue: true });
  }

  const token = getSessionToken();
  if (!token) throw new Error(notLinkedMessage());
  if (!process.env.GETMYENV_TOKEN?.trim()) assertTokenNotCommitted();
  const apiUrl = resolveApiUrl(opts.apiUrl);
  const client = new ApiClient(apiUrl, token);
  const who = await fetchWhoami(client);
  if (!opts.quiet) printGuestBanner(who);

  let meta = readProjectMeta();
  if (meta?.projectId && meta.projectId !== who.project.id) {
    throw new Error(
      [
        `project.json points at ${meta.projectName ?? meta.projectId}, but the token is for ${who.project.name}.`,
        "Run: npx getmyenv unlink, then run the command again.",
      ].join("\n")
    );
  }

  const usingEnvToken = Boolean(process.env.GETMYENV_TOKEN?.trim());
  if (!usingEnvToken && (!meta?.projectId || meta.projectName !== who.project.name)) {
    writeProjectMeta({
      ...(meta ?? {}),
      projectId: who.project.id,
      projectName: who.project.name,
    });
    ensureGitignoreHasEnv();
    meta = readProjectMeta();
  }

  return { who, apiUrl, token, client, meta };
}
