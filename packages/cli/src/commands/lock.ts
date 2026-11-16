import { pc } from "../lib/colors.js";
import { readProjectMeta } from "../lib/fs.js";
import { readFolderToken } from "../lib/credentials.js";
import { resolveApiUrl } from "../lib/api.js";
import { clearAllCachedKeys, keychainAccount } from "../lib/keychain.js";

/** Forget every unlocked context key on this machine. The next run asks for the Vault password. */
export async function lockCommand(opts: { apiUrl?: string }): Promise<void> {
  // A broken project file or API URL must never stop lock from clearing the keychain.
  let fallback: string[] = [];
  try {
    const projectId = readProjectMeta()?.projectId ?? readFolderToken()?.projectId;
    if (projectId) fallback = [keychainAccount(resolveApiUrl(opts.apiUrl), projectId)];
  } catch {
    fallback = [];
  }
  const removed = await clearAllCachedKeys(fallback);
  console.log(
    removed > 0
      ? `${pc.green("✓")} Locked. The next run asks for the Vault password.`
      : pc.dim("Already locked.")
  );
}
