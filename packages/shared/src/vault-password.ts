/**
 * Vault password rule for setting or changing it, in the dashboard and the CLI.
 * Unlock does not check it.
 */

const WEAK_DENYLIST = new Set(
  [
    "password1234",
    "password12345",
    "password123456",
    "123456789012",
    "1234567890123",
    "qwerty123456",
    "letmein12345",
    "letmein123456",
    "iloveyou1234",
    "welcome12345",
    "admin1234567",
    "changeme1234",
  ].map((s) => s.toLowerCase())
);

export const VAULT_PASSWORD_HELP = "At least 12 characters, with a letter and a number.";

export type VaultPasswordCheck = {
  ok: boolean;
  /** Reason when ok is false; null when ok. */
  error: string | null;
  lengthOk: boolean;
  letterOk: boolean;
  numberOk: boolean;
  notWeak: boolean;
};

function isAllSameChar(password: string): boolean {
  if (password.length === 0) return false;
  const first = password[0];
  return password.split("").every((c) => c === first);
}

/** Structured checks for UI hints, plus one error string. */
export function validateVaultPassword(password: string): VaultPasswordCheck {
  const lengthOk = password.length >= 12;
  const letterOk = /[a-zA-Z]/.test(password);
  const numberOk = /\d/.test(password);
  const notWeak = !WEAK_DENYLIST.has(password.toLowerCase()) && !isAllSameChar(password);

  let error: string | null = null;
  if (!lengthOk) {
    error = "Use at least 12 characters.";
  } else if (!letterOk || !numberOk) {
    error = "Include at least one letter and one number.";
  } else if (!notWeak) {
    error = "Choose a stronger password. Avoid common or repeated patterns.";
  }

  return {
    ok: lengthOk && letterOk && numberOk && notWeak,
    error,
    lengthOk,
    letterOk,
    numberOk,
    notWeak,
  };
}
