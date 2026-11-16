import path from "node:path";
import { pc } from "../lib/colors.js";
import {
  createBackupEnvelope,
  parsePayload,
  parseWrappedKey,
  serializeBackup,
  type BackupContext,
} from "@getmyenv/crypto";
import { slugify } from "@getmyenv/shared";
import { ensureTokenAndLink } from "../lib/bootstrap.js";
import { writePrivateFile } from "../lib/fs.js";

type BackupOpts = { output?: string; apiUrl?: string };

/** Encrypted backup of open contexts. Opens offline with the current Vault password or recovery code. */
export async function backupCommand(opts: BackupOpts): Promise<void> {
  const { client } = await ensureTokenAndLink({ apiUrl: opts.apiUrl });
  const data = await client.request<{
    projectName: string;
    publicKey: string | null;
    wrappedPrivateKey: unknown;
    recoveryWrappedKey?: unknown | null;
    contexts: BackupContext[];
    keys: string[];
    tags?: Record<string, string>;
    values: Array<{ key: string; context: string; expiresAt: string | null; ciphertext: string }>;
  }>("GET", "/api/cli/backup");
  if (!data.publicKey || !data.wrappedPrivateKey) {
    throw new Error("No Vault password yet, so there is nothing to back up. Set it in the dashboard, or set a value: npx getmyenv set KEY");
  }

  const envelope = createBackupEnvelope({
    projectName: data.projectName,
    publicKey: data.publicKey,
    wrappedPrivateKey: parseWrappedKey(JSON.stringify(data.wrappedPrivateKey)),
    recoveryWrappedKey: data.recoveryWrappedKey
      ? parseWrappedKey(JSON.stringify(data.recoveryWrappedKey))
      : null,
    contexts: data.contexts,
    keys: data.keys,
    tags: data.tags,
    values: data.values.map((v) => ({
      key: v.key,
      context: v.context,
      expiresAt: v.expiresAt,
      payload: parsePayload(v.ciphertext),
    })),
  });

  const out =
    opts.output ??
    path.join(process.cwd(), `${slugify(data.projectName) || "project"}.getmyenv-backup`);
  writePrivateFile(out, serializeBackup(envelope), { overwrite: false });
  console.log(
    `${pc.green("✓")} Encrypted backup: ${out} (${data.values.length} values, ${data.contexts.length} open contexts)`
  );
  console.log(
    pc.dim(
      data.recoveryWrappedKey
        ? "It opens with your Vault password or recovery code as they are now, not with newer ones. Read-only contexts are backed up from the dashboard."
        : "It opens with your Vault password as it is now, not with a newer one. Read-only contexts are backed up from the dashboard."
    )
  );
}
