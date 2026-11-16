import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";

/**
 * Only this user can read the file. On macOS and Linux that is mode 0600.
 * Windows ignores the mode, so the file would inherit the folder's rules,
 * which outside the user profile let every local user read it. There we grant
 * this user full control, then drop the inherited rules. Best effort: a
 * failure leaves the file as it was.
 */
export function restrictToOwner(file: string): void {
  fs.chmodSync(file, 0o600);
  if (process.platform !== "win32") return;
  try {
    const name = os.userInfo().username;
    const domain = process.env.USERDOMAIN;
    const user = domain ? `${domain}\\${name}` : name;
    const opts = { stdio: "ignore", windowsHide: true, timeout: 5000 } as const;
    // Grant first: if that fails, the inherited rules stay and the file stays readable to us.
    execFileSync("icacls", [file, "/grant:r", `${user}:F`], opts);
    execFileSync("icacls", [file, "/inheritance:r"], opts);
  } catch {
    /* keep the inherited rules */
  }
}
