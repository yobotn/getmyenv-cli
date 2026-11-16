import fs from "node:fs";
import { pcErr as pc } from "../lib/colors.js";
import {
  encryptSecret,
  parseBackup,
  restoreValuesFromBackup,
  serializePayload,
} from "@getmyenv/crypto";
import { ensureTokenAndLink } from "../lib/bootstrap.js";
import { findContext } from "../lib/context.js";
import { promptConfirm } from "../lib/fs.js";
import { resolveVaultPassword } from "../lib/guest-key.js";
import { syncFromLinked } from "../lib/template-file.js";
import { writeKey } from "../lib/vault.js";

type RestoreOpts = {
  apiUrl?: string;
  yes?: boolean;
  dryRun?: boolean;
};

/**
 * Restore a backup into this folder's project. The backup opens locally with
 * the Vault password or recovery code it was made with. Values are encrypted again with this
 * project's context keys. Read-only and unknown contexts are skipped.
 */
export async function restoreCommand(file: string, opts: RestoreOpts): Promise<void> {
  if (!fs.existsSync(file)) throw new Error(`File not found: ${file}`);
  if (!opts.yes && !opts.dryRun && !process.stdin.isTTY) {
    throw new Error("Restore replaces values with the same names. Pass --yes to confirm, or --dry-run to preview.");
  }
  let envelope: ReturnType<typeof parseBackup>;
  try {
    envelope = parseBackup(fs.readFileSync(file, "utf8"));
  } catch (err) {
    const msg = err instanceof Error ? err.message : "";
    throw new Error(
      msg.startsWith("Unsupported backup version")
        ? "This backup was made by an older version and cannot be restored."
        : "Not a getmyenv backup file."
    );
  }

  const linked = await ensureTokenAndLink({ apiUrl: opts.apiUrl });
  const { who, client } = linked;
  if (who.token.kind !== "folder") {
    throw new Error("Restore needs a signed-in folder token. Guest and server tokens cannot restore.");
  }

  const secret = await resolveVaultPassword({
    isGuest: false,
    prompt: envelope.recoveryWrappedKey
      ? "Vault password or recovery code for this backup (hidden): "
      : "Vault password for this backup (hidden): ",
  });
  let opened: Awaited<ReturnType<typeof restoreValuesFromBackup>>;
  try {
    opened = await restoreValuesFromBackup(secret, envelope);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "";
    if (/^(That recovery code|This backup|A recovery code)/.test(msg)) throw new Error(msg);
    throw new Error(
      envelope.recoveryWrappedKey
        ? "Could not open the backup. Check the Vault password or recovery code."
        : "Could not open the backup. Check the Vault password."
    );
  }
  console.error(`Backup checked: ${opened.values.length} values in ${envelope.contexts.length} contexts.\n`);

  const targets = new Map<string, ReturnType<typeof findContext>>();
  for (const c of envelope.contexts) targets.set(c.slug, findContext(who.contexts, c.slug));
  const writable = (slug: string) => targets.get(slug)?.protection === "open";

  const perContext = new Map<string, number>();
  for (const v of opened.values) perContext.set(v.context, (perContext.get(v.context) ?? 0) + 1);
  for (const [slug, count] of perContext) {
    const target = targets.get(slug);
    const note = !target
      ? pc.yellow(" (no such context here, skipped)")
      : target.protection === "locked"
        ? pc.yellow(" (Read-only, skipped)")
        : "";
    console.error(`  ${slug}: ${count} value${count === 1 ? "" : "s"}${note}`);
  }
  console.error("");

  if (opts.dryRun) {
    console.error(pc.dim(`Dry run. Nothing was restored into ${who.project.name}.`));
    return;
  }
  if (!opts.yes) {
    const ok = await promptConfirm(
      `Restore into ${who.project.name}? Existing values with the same names are replaced.`,
      { defaultYes: false }
    );
    if (!ok) {
      console.error(pc.dim("Nothing restored."));
      return;
    }
  }

  const values: Array<{ key: string; context: string; expiresAt: string | null; ciphertext: string }> = [];
  const keyVersions: Record<string, number> = {};
  for (const v of opened.values) {
    if (!writable(v.context)) continue;
    const target = targets.get(v.context)!;
    const { key, keyVersion } = await writeKey(linked, target);
    keyVersions[v.context] = keyVersion;
    values.push({
      key: v.key,
      context: v.context,
      expiresAt: v.expiresAt,
      ciphertext: serializePayload(encryptSecret(key, v.key, v.value)),
    });
  }

  const res = await client.request<{
    projectName: string;
    restored: number;
    skippedContexts: string[];
  }>("POST", "/api/cli/restore", {
    keys: envelope.keys,
    tags: envelope.tags ?? {},
    values,
    keyVersions,
  });

  syncFromLinked(linked, { added: [...envelope.keys, ...values.map((v) => v.key)] });

  const skipped = [...perContext.keys()].filter((slug) => !writable(slug));
  console.log(`${pc.green("✓")} Restored ${res.restored} values into ${res.projectName}`);
  if (skipped.length > 0) {
    console.log(
      pc.yellow(`Skipped: ${skipped.join(", ")}. Restore Read-only contexts in the dashboard.`)
    );
  }
}
