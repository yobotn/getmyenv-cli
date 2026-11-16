import {
  ACCESS_GRANT_TTL_MS,
  ACCESS_REQUEST_TTL_MS,
  INVITE_TTL_DAYS,
  LINK_REAUTH_WINDOW_MS,
  OAUTH_FLOW_TTL_MS,
  OTP_TTL_MS,
  REMEMBER_BROWSER_DAYS,
  SESSION_IDLE_DAYS,
  SESSION_MAX_DAYS,
  SUPER_ADMIN_TOKEN_TTL_MS,
  TOKEN_MAX_DAYS,
} from "./constants.js";
import { GUEST_MAX_KEYS, MAX_KEYS_PER_PROJECT, PILOT_MAX_CONTEXTS, PILOT_MAX_PROJECTS } from "./plans.js";

/**
 * Product facts that copy repeats: the homepage, docs, guides, llms, SEO, the
 * CLI and the dashboard. Change a number or a rule here and every surface
 * follows. `pnpm check:product` fails when copy types these numbers by hand.
 */

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

/** A guest project accepts writes until this long after its last CLI use. */
export const GUEST_ACTIVE_DAYS = 30;
/** Use never keeps a guest project active past this long after it was created. */
export const GUEST_MAX_DAYS = 180;
/** After expiry, reads (run, export) and claim still work for this long. */
export const GUEST_GRACE_DAYS = 30;
export const GUEST_ACTIVE_MS = GUEST_ACTIVE_DAYS * DAY_MS;
export const GUEST_MAX_MS = GUEST_MAX_DAYS * DAY_MS;
export const GUEST_GRACE_MS = GUEST_GRACE_DAYS * DAY_MS;

function plural(n: number, unit: string): string {
  return `${n} ${unit}${n === 1 ? "" : "s"}`;
}

/** How long an unlocked context key stays in the OS keychain. */
export const VAULT_UNLOCK_HOURS = 8;
export const VAULT_UNLOCK_MS = VAULT_UNLOCK_HOURS * HOUR_MS;
/** "8 hours". */
export const VAULT_UNLOCK_DURATION = plural(VAULT_UNLOCK_HOURS, "hour");

/** How long an approved machine request stays usable. */
export const ACCESS_GRANT_HOURS = ACCESS_GRANT_TTL_MS / HOUR_MS;
/** "1 hour". */
export const ACCESS_GRANT_DURATION = plural(ACCESS_GRANT_HOURS, "hour");

const MINUTE_MS = 60_000;
/** "5 minutes". How long a machine's access request waits for approval. */
export const ACCESS_REQUEST_DURATION = plural(ACCESS_REQUEST_TTL_MS / MINUTE_MS, "minute");
/** "10 minutes". How long an email login code works. */
export const LOGIN_CODE_DURATION = plural(OTP_TTL_MS / MINUTE_MS, "minute");
/** "7 days". How long a member invite link works. */
export const INVITE_DURATION = plural(INVITE_TTL_DAYS, "day");
/** "30 days". How long "Remember this browser" skips the login code. */
export const REMEMBER_BROWSER_DURATION = plural(REMEMBER_BROWSER_DAYS, "day");
/** "1 year". How long a folder or server token lasts at most. */
export const TOKEN_DURATION =
  TOKEN_MAX_DAYS % 365 === 0 ? plural(TOKEN_MAX_DAYS / 365, "year") : plural(TOKEN_MAX_DAYS, "day");
/** "8 hours". How long a super admin's CLI sign-in token lasts. */
export const SUPER_ADMIN_TOKEN_DURATION = plural(SUPER_ADMIN_TOKEN_TTL_MS / HOUR_MS, "hour");
/** "14 days". How long a browser session lasts at most. */
export const SESSION_DURATION = plural(SESSION_MAX_DAYS, "day");
/** "3 days". A browser session unused this long ends. */
export const SESSION_IDLE_DURATION = plural(SESSION_IDLE_DAYS, "day");
/** "10 minutes". How long the OAuth sign-in cookies live. */
export const OAUTH_FLOW_DURATION = plural(OAUTH_FLOW_TTL_MS / MINUTE_MS, "minute");
/** "15 minutes". Linking a sign-in provider needs a code entered within this long. */
export const LINK_REAUTH_DURATION = plural(LINK_REAUTH_WINDOW_MS / MINUTE_MS, "minute");

export const MAX_VALUES_PER_REQUEST = 500;
export const MAX_CIPHERTEXT_CHARS = 200_000;
/** Plaintext that fits in MAX_CIPHERTEXT_CHARS after encryption and base64, rounded down. */
export const MAX_VALUE_TEXT_KB = 145;

/** Oldest Node.js major the CLI supports. Matches `engines.node` in packages/cli/package.json. */
export const NODE_MAJOR = 24;

const RUN_WHERE = `Run getmyenv where your app starts: your machine, the server, the CI job, or the container's start command. It needs Node ${NODE_MAJOR} or newer there. run is the default. If getmyenv can't run where the app starts, export writes a plaintext .env instead.`;

export const FACTS = {
  runWhere: RUN_WHERE,
  runNeedsServer:
    "run fetches the values from getmyenv each time it starts. If it can't reach the server, the command does not start. A running process keeps its values.",
  processGetsValues:
    "The process that run starts gets readable values as environment variables, and so do its child processes. export writes them to a plaintext file.",
  runIgnoresEnvFile: "run does not read .env files. Delete them when you are ready.",
  runExplainHint: "npx getmyenv run --explain lists every name and where it comes from. Never values.",
  tokenLifetime: `Tokens last up to ${TOKEN_DURATION}.`,
  superAdminTokenLifetime: `Super admin tokens last ${SUPER_ADMIN_TOKEN_DURATION}.`,
  guestLifecycle: `A guest project stays active while the CLI uses it. After ${GUEST_ACTIVE_DAYS} days without use, or ${GUEST_MAX_DAYS} days after it was created, values can't change. For ${GUEST_GRACE_DAYS} more days, run still works and it can still be claimed. Unclaimed projects may be deleted after that.`,
  guestShort: `It stays active while you use it, up to ${GUEST_MAX_DAYS} days. Claim it to keep it.`,
  readOnlyWho: "Only the owner sets Read-only values, in the dashboard.",
  analyticsScope:
    "Analytics loads on public pages only. It never loads on sign-in, signup, claim or the dashboard, where the vault unlocks.",
  nodeAnyLanguage: `The CLI needs Node ${NODE_MAJOR} or newer where the app starts, also in a Python, Ruby or PHP container.`,
  defaultContexts: "New projects start with Development (open) and Production (Read-only).",
  guestContexts: "Guest projects have Development only. Claiming adds Production (Read-only).",
  claimHandoff:
    "Keep claim.json private. Do not print it, paste it in chat, or add it to git. The human runs npx getmyenv claim in the same folder, and claim reads it.",
  guestPrint:
    "At a terminal, guest prints the claim code and guest passphrase once. Run by an agent or a script, it prints neither, and claim.json is the only copy.",
  claimLoss: "If the folder is lost before claim, the project cannot be claimed.",
  templateFile:
    "Commit .getmyenv/template.json. It lists the variable names, never values. In a fresh clone, npx getmyenv can start a new project from it and asks for each value.",
  templateFileRecovery: "A clone with .getmyenv/template.json can start a new project with the same names.",
  templateFileNewProject: "Values, members and tokens do not carry over.",
  committedFiles:
    "Commit .getmyenv/project.json and .getmyenv/template.json. token.json and claim.json stay local and are gitignored.",
  claimUnlock: `After claim, values open with the human's Vault password. The human runs npx getmyenv run -- <start command> once in a terminal to unlock. Then run works without a prompt for ${VAULT_UNLOCK_DURATION}.`,
  agentRunOrExport: `Ask the human once, in one message: where will the app run, and use getmyenv at runtime or as a manager only? Recommend runtime: npx getmyenv run -- <command> passes the values to the process, with no .env file on disk. Manager only: npx getmyenv export writes a plaintext .env for tools that read one, and the scripts stay as they are. ${RUN_WHERE} If you cannot ask, use runtime for local development.`,
  agentSecretInput:
    "In the same message, ask how to enter secret values. First declare the names with no values: npx getmyenv set KEY1= KEY2=. Names are safe to share. Then recommend the hidden prompt: the human runs npx getmyenv set --missing in a terminal and types each value, which never enters the chat. With an account, the dashboard works too. If the human pastes a value in chat instead, it is sent to your AI provider, so tell them to rotate it at its provider afterwards. Values not secret, like LOG_LEVEL, can use set KEY=value. import reads .env files directly. If you cannot ask, declare the names and tell the human to run npx getmyenv set --missing.",
  envFileScripts:
    "With runtime, remove --env-file=.env only from scripts that load that file. run already puts the values in the environment, and node stops with an error when the file is missing.",
  pilotShort: `Accounts created during the pilot stay free: up to ${PILOT_MAX_PROJECTS} projects, ${PILOT_MAX_CONTEXTS} contexts each.`,
  pilotLimits: `Accounts created during the pilot stay free, up to ${PILOT_MAX_PROJECTS} projects you own, ${PILOT_MAX_CONTEXTS} contexts each. Projects shared with you do not count.`,
  keyLimits: `A project holds up to ${MAX_KEYS_PER_PROJECT} variable names. A guest project holds up to ${GUEST_MAX_KEYS} until it is claimed.`,
  valueLimits: `Up to ${MAX_VALUES_PER_REQUEST} values per request. Each value's ciphertext is up to ${MAX_CIPHERTEXT_CHARS.toLocaleString("en-US")} characters, about ${MAX_VALUE_TEXT_KB} KB of text.`,
  vaultUnlock: `Unlocked context keys stay in the OS keychain for ${VAULT_UNLOCK_DURATION}, or until npx getmyenv lock.`,
  accessGrant: `Approval gives a machine a one-time grant for ${ACCESS_GRANT_DURATION}.`,
  accessRequest: `A machine's request waits up to ${ACCESS_REQUEST_DURATION} for approval.`,
  allowlistIpv6: "If the machine connects over IPv6, add its IPv6 range too, like 2001:db8::/64.",
  revokeRunning: "Revoking stops new reads. A running process keeps the values it started with until it restarts.",
  browserUnlock: "The dashboard unlocks the vault per browser tab, in memory. Reload, close the tab, or Lock, and the keys are gone.",
  recoveryCode:
    "Your recovery code opens your vault if you forget the Vault password. It stays with you. We never see it and cannot recover it.",
  keyHierarchy:
    "One Vault password per account. It unlocks your encrypted private key on your device. Your private key opens the context keys shared with you. Each context has its own random key. Each reader (you, each member, each server token) gets their own sealed copy. The recovery code unlocks the same private key.",
  keyHierarchyShort:
    "One Vault password per account unlocks your private key on your device. Each context has its own key, and each reader gets their own sealed copy.",
  backupOpens:
    "A backup opens with the Vault password or the recovery code in effect when it was made. A newer Vault password or recovery code does not open it.",
  backupAfterReset:
    "After a vault reset, an older backup still opens with the Vault password or recovery code it was made with. Restoring it puts its values back, readable with your new key. It does not bring back the old vault.",
  vaultRecover:
    "We cannot recover your Vault password. Your recovery code lets you set a new one and keeps every value.",
  vaultReset:
    "Lost the Vault password and the recovery code? Choose \"Forgot your Vault password?\" and reset the vault. Names, contexts and members stay. Values only you could open are deleted, and you set them again. Contexts a member or server token still reads keep their values until you reset them.",
} as const;
