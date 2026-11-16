import type { TokenKind } from "./constants.js";
import { FACTS } from "./facts.js";

/**
 * Why a token row was deleted. The server keeps the token hash and the reason
 * for a while, so the CLI can say what happened instead of "Unauthorized".
 */
export const ENDED_TOKEN_REASONS = [
  "project_deleted",
  "guest_purged",
  "guest_claimed",
  "member_removed",
  "member_left",
  "ownership_transferred",
  "context_reset",
  "context_opened",
  "context_deleted",
  "revoked",
  "account_deleted",
] as const;
export type EndedTokenReason = (typeof ENDED_TOKEN_REASONS)[number];

/** API error code for a token that was deleted or expired. Sent with HTTP 401. */
export const TOKEN_ENDED_CODE = "token_ended";

/** When each reason happens, for the docs. */
export const ENDED_TOKEN_CAUSES: Record<EndedTokenReason, string> = {
  project_deleted: "The owner or a super admin deleted the project.",
  guest_purged: "An expired guest project was deleted.",
  guest_claimed: "Someone claimed the guest project. Its guest tokens stop working.",
  member_removed: "The owner removed you from the project.",
  member_left: "You left the project.",
  ownership_transferred: "You gave the project to a new owner and did not stay as a member.",
  context_reset: "The owner reset the Read-only context the server token reads.",
  context_opened: "The context the server token reads is no longer Read-only.",
  context_deleted: "The context the server token reads was deleted.",
  revoked: "The token was revoked in the dashboard.",
  account_deleted: "The account the token belongs to was deleted.",
};

export function isEndedTokenReason(value: string): value is EndedTokenReason {
  return (ENDED_TOKEN_REASONS as readonly string[]).includes(value);
}

function tokenNoun(kind: TokenKind): string {
  if (kind === "server") return "server token";
  if (kind === "guest") return "guest token";
  return "folder token";
}

/** Reasons after which the project is gone, so a new token for it cannot exist. */
const PROJECT_GONE: ReadonlySet<EndedTokenReason> = new Set(["project_deleted", "guest_purged", "account_deleted"]);

function nextStep(kind: TokenKind, reason?: EndedTokenReason): string {
  // A claim finishes in the folder that holds claim.json. unlink first would lose that file's keys.
  if (reason === "guest_claimed") return "Finish the claim in this folder: npx getmyenv claim";
  if (kind !== "server") return "Run: npx getmyenv unlink, then npx getmyenv";
  return reason && PROJECT_GONE.has(reason)
    ? "Remove GETMYENV_TOKEN from this server."
    : "Create a new server token in Project settings, Tokens.";
}

function what(reason: EndedTokenReason, kind: TokenKind, project: string): string {
  switch (reason) {
    case "project_deleted": {
      const base = `The project "${project}" was deleted. Its values are no longer available.`;
      return kind === "server" ? base : `${base} ${FACTS.templateFileRecovery}`;
    }
    case "guest_purged":
      return `The guest project "${project}" expired and was deleted.`;
    case "guest_claimed":
      return `The guest project "${project}" was claimed.`;
    case "member_removed":
      return `You were removed from "${project}". Ask the owner to invite you again.`;
    case "member_left":
      return `You left "${project}".`;
    case "ownership_transferred":
      return `You gave "${project}" to a new owner and left it.`;
    case "context_reset":
      return `The Read-only context this server token read in "${project}" was reset.`;
    case "context_opened":
      return `The context this server token read in "${project}" is no longer Read-only.`;
    case "context_deleted":
      return `The context this server token read in "${project}" was deleted.`;
    case "revoked":
      return `This ${tokenNoun(kind)} for "${project}" was revoked.`;
    case "account_deleted":
      return `The account for this ${tokenNoun(kind)} was deleted.`;
  }
}

/** What the CLI prints when a token was deleted: what happened, then one next step. */
export function endedTokenMessage(input: {
  reason: EndedTokenReason;
  kind: TokenKind;
  projectName: string;
}): string {
  return `${what(input.reason, input.kind, input.projectName)} ${nextStep(input.kind, input.reason)}`;
}

/** What the CLI prints when a token passed its expiry date. */
export function expiredTokenMessage(input: { kind: TokenKind; expiresAt: Date }): string {
  const day = input.expiresAt.toISOString().slice(0, 10);
  return `This ${tokenNoun(input.kind)} expired on ${day}. ${nextStep(input.kind)}`;
}
