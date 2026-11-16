import { VAULT_PASSWORD_HELP, validateVaultPassword } from "@getmyenv/shared";
import { CLAIM_FILE_INVALID, claimFileInvalid, promptHidden, readClaimFile } from "./fs.js";

/** Ask for a new Vault password twice. Same rule as the dashboard. */
export async function promptNewVaultPassword(): Promise<string> {
  if (process.stdin.isTTY) console.error(VAULT_PASSWORD_HELP);
  const password = await promptHidden("New Vault password (hidden): ");
  if (!password) throw new Error("Vault password required.");
  const check = validateVaultPassword(password);
  if (!check.ok) throw new Error(check.error ?? VAULT_PASSWORD_HELP);
  const confirm = await promptHidden("Confirm Vault password (hidden): ");
  if (password !== confirm) throw new Error("Passwords did not match.");
  return password;
}

export type ResolveVaultPasswordOpts = {
  /** From whoami / ensureTokenAndLink. */
  isGuest?: boolean;
  /** Prompt label when a password is needed (unlock path). */
  prompt?: string;
  /**
   * Creating a new Vault (first wrap / no local key yet).
   * Prompts New + Confirm. Ignored for guests (claim.json passphrase).
   */
  create?: boolean;
};

/**
 * Guest projects wrap the guest private key with the passphrase in claim.json.
 * Use that silently so guest, set and run need no Vault password prompt.
 * Claimed projects prompt for the Vault password in a terminal.
 */
export async function resolveVaultPassword(opts: ResolveVaultPasswordOpts): Promise<string> {
  if (opts.isGuest) {
    const claim = readClaimFile();
    if (claim?.passphrase) {
      return claim.passphrase;
    }
    if (claimFileInvalid()) throw new Error(CLAIM_FILE_INVALID);
    throw new Error(
      "Guest project is missing .getmyenv/claim.json. Run it from the folder that created the project, or run: npx getmyenv claim"
    );
  }

  if (opts.create) return promptNewVaultPassword();

  const password = await promptHidden(opts.prompt ?? "Vault password (hidden): ");
  if (!password) {
    throw new Error("Vault password required.");
  }
  return password;
}
