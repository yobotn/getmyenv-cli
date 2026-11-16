const DAY_MS = 24 * 60 * 60 * 1000;

export const LOCAL_DIR = ".getmyenv";
/** How long a machine's access request waits for approval. */
export const ACCESS_REQUEST_TTL_MS = 5 * 60_000;
/** Access grant lifetime after approval. Single-use on first fetch. */
export const ACCESS_GRANT_TTL_MS = 60 * 60 * 1000;
/** How long an email login code works. */
export const OTP_TTL_MS = 10 * 60 * 1000;
export const OTP_MAX_ATTEMPTS = 5;
/** How long a member invite link works. */
export const INVITE_TTL_DAYS = 7;
export const INVITE_TTL_MS = INVITE_TTL_DAYS * DAY_MS;
/** "Remember this browser" skips the email login code for this long. */
export const REMEMBER_BROWSER_DAYS = 30;
export const REMEMBER_BROWSER_MS = REMEMBER_BROWSER_DAYS * DAY_MS;
/** Folder and server tokens expire after this long. Super admin tokens are shorter. */
export const TOKEN_MAX_DAYS = 365;
export const TOKEN_MAX_MS = TOKEN_MAX_DAYS * DAY_MS;
/** CLI sign-in tokens of a super admin expire after this long. */
export const SUPER_ADMIN_TOKEN_TTL_MS = 8 * 60 * 60 * 1000;
/** Linking a sign-in provider needs a code entered within this long. */
export const LINK_REAUTH_WINDOW_MS = 15 * 60_000;
/** General contact, also for a lost authenticator. Same address as the contact page. */
export const CONTACT_EMAIL = "hello@getmyenv.com";
/** Vulnerability reports. SECURITY.md and the contact page name it too. */
export const SECURITY_EMAIL = "security@getmyenv.com";
/** A browser session lasts at most this long. */
export const SESSION_MAX_DAYS = 14;
export const SESSION_MAX_MS = SESSION_MAX_DAYS * DAY_MS;
/** A browser session unused for this long ends, even before it expires. */
export const SESSION_IDLE_DAYS = 3;
export const SESSION_IDLE_MS = SESSION_IDLE_DAYS * DAY_MS;
/** The OAuth state, verifier and trust cookies live this long. */
export const OAUTH_FLOW_TTL_MS = 10 * 60_000;

/** Oldest CLI the API accepts. Older CLIs get "Update: npx getmyenv@latest". */
export const MIN_CLI_VERSION = "0.14.0";

/**
 * Open: CLI can read and write. Machines are granted automatically.
 * Locked: CLI is read-only, needs an allowlisted IP and a trusted or approved
 * machine. The server token's new machine policy decides the rest.
 */
export const PROTECTIONS = ["open", "locked"] as const;
export type Protection = (typeof PROTECTIONS)[number];

/** Contexts every new project starts with. */
export const DEFAULT_CONTEXTS = [
  { name: "Development", slug: "development", protection: "open" },
  { name: "Production", slug: "production", protection: "locked" },
] as const satisfies ReadonlyArray<{
  name: string;
  slug: string;
  protection: Protection;
}>;

export const DEFAULT_CONTEXT_SLUG = "development";

/** A new context with the slug `production` starts locked. Others start open. */
export function defaultProtectionForSlug(slug: string): Protection {
  return slug === "production" ? "locked" : "open";
}

/**
 * folder: open contexts, minted by browser sign-in in a project folder.
 * guest: open contexts on an unclaimed project.
 * server: one read-only context, IP allowlist required.
 */
export const TOKEN_KINDS = ["folder", "guest", "server"] as const;
export type TokenKind = (typeof TOKEN_KINDS)[number];

/**
 * What a server token does when an untrusted machine reads its context.
 * ask: pending request for the owner. auto: trust the machine on first read
 * (narrow allowlists only). blocked: refuse, trust it in the dashboard.
 */
export const NEW_MACHINE_POLICIES = ["ask", "auto", "blocked"] as const;
export type NewMachinePolicy = (typeof NEW_MACHINE_POLICIES)[number];

export const NEW_MACHINE_POLICY_LABELS: Record<NewMachinePolicy, string> = {
  ask: "Ask me",
  auto: "Trust from these IPs",
  blocked: "Blocked",
};

/** admin = signed-up dashboard user; super_admin = platform owner (/admin). */
export const USER_ROLES = ["admin", "super_admin"] as const;
export type UserRole = (typeof USER_ROLES)[number];

export const WEBHOOK_HEADERS = {
  event: "X-Getmyenv-Event",
  delivery: "X-Getmyenv-Delivery",
  signature: "X-Getmyenv-Signature",
  timestamp: "X-Getmyenv-Timestamp",
} as const;
