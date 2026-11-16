import { pcErr as pc } from "./colors.js";
import {
  assertRecoveryWrap,
  createRecoveryWrap,
  createUserKeys,
  formatRecoveryCode,
  recoveryCodesMatch,
  wipe,
  type WrappedPrivateKey,
} from "@getmyenv/crypto";
import { FACTS } from "@getmyenv/shared";
import { readLine } from "./fs.js";
import { promptNewVaultPassword } from "./guest-key.js";

export const NO_TTY_FOR_VAULT =
  "No terminal to set a Vault password. Set it in the dashboard, Settings, or run this command in a terminal.";

const TYPE_BACK_ATTEMPTS = 3;

export type NewAccountKeys = {
  publicKey: string;
  /** Caller wipes it. */
  privateKey: Uint8Array;
  keys: {
    publicKey: string;
    wrappedPrivateKey: WrappedPrivateKey;
    recoveryWrappedKey: WrappedPrivateKey;
  };
};

function printRecoveryCode(code: string): void {
  const shown = formatRecoveryCode(code);
  const width = shown.length + 4;
  console.error("");
  console.error(pc.bold("Your recovery code"));
  console.error(`┌${"─".repeat(width)}┐`);
  console.error(`│  ${pc.bold(shown)}  │`);
  console.error(`└${"─".repeat(width)}┘`);
  console.error(pc.dim(`${FACTS.recoveryCode} Write it down or save it in a password manager.\n`));
}

/** The user types the code back. Nothing is saved until it matches. */
export async function confirmRecoveryCode(
  code: string,
  ask: (question: string) => Promise<string> = readLine
): Promise<void> {
  for (let attempt = 1; attempt <= TYPE_BACK_ATTEMPTS; attempt++) {
    const typed = await ask("Type the recovery code to confirm: ");
    if (recoveryCodesMatch(code, typed)) return;
    if (attempt < TYPE_BACK_ATTEMPTS) console.error(pc.red("That does not match. Try again.\n"));
  }
  throw new Error("The recovery code did not match. Nothing was saved. Run the command again.");
}

/**
 * New account keys: a Vault password typed twice, then a recovery code shown
 * once and typed back. Needs a terminal. Checks both wraps open the same key.
 */
export async function createAccountKeys(): Promise<NewAccountKeys> {
  if (!process.stdin.isTTY) throw new Error(NO_TTY_FOR_VAULT);
  console.error(
    pc.dim("Choose a Vault password. It stays on this machine. We store an encrypted key blob only.\n")
  );
  const created = await createUserKeys(await promptNewVaultPassword());
  try {
    const recovery = await createRecoveryWrap(created.privateKey);
    printRecoveryCode(recovery.code);
    await confirmRecoveryCode(recovery.code);
    await assertRecoveryWrap(recovery.code, recovery.wrapped, created.publicKey);
    return {
      publicKey: created.publicKey,
      privateKey: created.privateKey,
      keys: {
        publicKey: created.publicKey,
        wrappedPrivateKey: created.wrapped,
        recoveryWrappedKey: recovery.wrapped,
      },
    };
  } catch (err) {
    wipe(created.privateKey);
    throw err;
  }
}
