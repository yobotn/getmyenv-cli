import fs from "node:fs";
import { pc as pcOut, pcErr } from "../lib/colors.js";
import { EXPORT_WARNING, formatDotenvValue, plural } from "@getmyenv/shared";
import {
  assertFileTarget,
  ensureGitignoreHas,
  ensureGitignoreHasEnv,
  readEnvFile,
  writePrivateFile,
} from "../lib/fs.js";
import { ensureTokenAndLink } from "../lib/bootstrap.js";
import { resolveContext } from "../lib/context.js";
import { confirmDiff } from "../lib/confirm.js";
import { decryptContext, type ContextData } from "../lib/read-context.js";
import { resolveValues } from "../lib/resolve.js";

export type ExportOpts = {
  context?: string;
  apiUrl?: string;
  output?: string;
  stdout?: boolean;
  yes?: boolean;
};

/**
 * `export`: write one context to a plaintext file, for tools that need one.
 * Read-only contexts go through the same checks as `run`: server token,
 * allowed IP, and a trusted or approved machine.
 */
export async function exportCommand(opts: ExportOpts): Promise<void> {
  const log = opts.stdout ? (l = "") => console.error(l) : (l = "") => console.log(l);
  const pc = opts.stdout ? pcErr : pcOut;
  const out = opts.output || ".env";
  // Before any request: a bad -o path should not cost a Vault password prompt.
  if (!opts.stdout) assertFileTarget(out);
  const linked = await ensureTokenAndLink({ apiUrl: opts.apiUrl, quiet: opts.stdout });
  const ctx = resolveContext(linked.who, linked.meta, opts.context);

  log(pc.yellow(EXPORT_WARNING));
  const data: ContextData =
    ctx.protection === "locked"
      ? await resolveValues(linked.client, linked.who.project.id, ctx.slug, "export")
      : await linked.client.request("GET", `/api/cli/values?context=${encodeURIComponent(ctx.slug)}`);

  const { values: remote } = await decryptContext(linked, ctx, data);

  const lines = [
    `# Exported by getmyenv from ${ctx.slug}. Plaintext. Do not commit.`,
    ...Object.entries(remote).map(([k, v]) => `${k}=${formatDotenvValue(v)}`),
    ...data.missing.map((m) => `# ${m.name} has no value in ${ctx.slug}`),
  ];

  if (opts.stdout) {
    process.stdout.write(lines.join("\n") + "\n");
    return;
  }

  if (fs.existsSync(out)) {
    const { values: local, skipped } = readEnvFile(out);
    const conflicts = Object.keys(remote)
      .filter((k) => k in local && local[k] !== remote[k])
      .map((name) => ({ name, detail: "local value differs" }));
    const dropped = Object.keys(local)
      .filter((k) => !(k in remote))
      .map((name) => ({ name, detail: "only in the local file" }));
    // Names getmyenv cannot hold (like lowercase) would vanish without a word.
    for (const name of skipped) {
      dropped.push({ name, detail: "not a valid name here, only in the local file" });
    }
    const ok = await confirmDiff({
      conflicts,
      removed: dropped,
      action: `Overwrite ${out}`,
      yes: opts.yes,
    });
    if (!ok) {
      log(pc.dim("Kept the existing file."));
      return;
    }
  }
  writePrivateFile(out, lines.join("\n") + "\n", { overwrite: true });
  ensureGitignoreHasEnv();
  ensureGitignoreHas(out);
  log(`${pc.green("✓")} Wrote ${plural(Object.keys(remote).length, "variable")} from ${ctx.slug} to ${out}`);
}
