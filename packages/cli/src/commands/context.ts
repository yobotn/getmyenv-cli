import { pc } from "../lib/colors.js";
import { decryptSecret, parsePayload, type SealedKey } from "@getmyenv/crypto";
import { readProjectMeta, writeProjectMeta } from "../lib/fs.js";
import type { ContextInfo } from "../lib/api.js";
import { ensureTokenAndLink, type Linked } from "../lib/bootstrap.js";
import { defaultContextSlug, findContext } from "../lib/context.js";
import { uploadValues } from "../lib/upload.js";
import { contextKey } from "../lib/vault.js";

type Opts = { apiUrl?: string };

export async function contextListCommand(opts: Opts): Promise<void> {
  const { who, meta } = await ensureTokenAndLink({ apiUrl: opts.apiUrl, quiet: true });
  const current = defaultContextSlug(who, meta);
  const width = Math.max(...who.contexts.map((c) => c.slug.length), 4);
  for (const c of who.contexts) {
    const marker = c.slug === current ? pc.green("*") : " ";
    const prot = c.protection === "locked" ? pc.yellow("Read-only") : pc.dim("open     ");
    console.log(`${marker} ${c.slug.padEnd(width)}  ${prot}  ${c.name}`);
  }
}

/**
 * Create an open context, and copy values from an open one with `from`. Prints nothing.
 * With `softCopy`, a failed copy is returned as `copyError`: the context exists by then.
 */
export async function createContext(
  name: string,
  opts: Opts & { from?: string; softCopy?: boolean }
): Promise<{ created: ContextInfo; source: ContextInfo | null; copied: number; copyError?: string }> {
  const linked = await ensureTokenAndLink({ apiUrl: opts.apiUrl, quiet: true });
  const { who, client } = linked;
  let source: ContextInfo | null = null;
  if (opts.from) {
    source = findContext(who.contexts, opts.from);
    if (!source) throw new Error(`No context "${opts.from}".`);
    if (source.protection === "locked") {
      throw new Error(`${source.slug} is Read-only. Copy from it in the dashboard.`);
    }
  }
  const created = await client.request<ContextInfo>("POST", "/api/cli/contexts", { name });

  let copied = 0;
  if (source) {
    try {
      copied = await copyValues(linked, source, created);
    } catch (err) {
      if (!opts.softCopy) throw err;
      return { created, source, copied, copyError: err instanceof Error ? err.message : String(err) };
    }
  }
  return { created, source, copied };
}

/** Decrypt an open context's values on this machine and upload them to another. */
async function copyValues(linked: Linked, source: ContextInfo, target: ContextInfo): Promise<number> {
  const data = await linked.client.request<{
    sealedKey: SealedKey | null;
    values: Array<{ name: string; ciphertext: string }>;
  }>("GET", `/api/cli/values?context=${encodeURIComponent(source.slug)}`);
  if (data.values.length === 0) return 0;
  const key = await contextKey(linked, { ...source, sealedKey: data.sealedKey });
  const pairs = Object.fromEntries(
    data.values.map((v) => [v.name, decryptSecret(key, v.name, parsePayload(v.ciphertext))])
  );
  const res = await uploadValues({ linked, context: target, pairs });
  return res.set.length;
}

export async function contextCreateCommand(
  name: string,
  opts: Opts & { from?: string; use?: boolean }
): Promise<void> {
  const { created, source, copied } = await createContext(name, opts);
  console.log(
    `${pc.green("✓")} Context ${pc.bold(created.name)} (${created.slug}), open${source ? `, ${copied} value${copied === 1 ? "" : "s"} copied from ${source.slug}` : ""}`
  );
  if (opts.use) {
    const meta = readProjectMeta();
    writeProjectMeta({ ...(meta ?? {}), context: created.slug });
    console.log(pc.dim(`Default context for this folder: ${created.slug}`));
  } else {
    console.log(pc.dim(`Run with it: npx getmyenv run ${created.slug} -- <command>`));
  }
}

export async function contextUseCommand(slug: string, opts: Opts): Promise<void> {
  const { who } = await ensureTokenAndLink({ apiUrl: opts.apiUrl, quiet: true });
  const ctx = findContext(who.contexts, slug);
  if (!ctx) {
    const available = who.contexts.map((c) => c.slug).join(", ");
    throw new Error(`No context "${slug}". Available: ${available}`);
  }
  if (ctx.protection === "locked" && who.token.kind !== "server") {
    throw new Error(
      `${ctx.slug} is Read-only. This folder's token reads open contexts only. Read-only contexts are read on servers with a server token.`
    );
  }
  const meta = readProjectMeta();
  writeProjectMeta({ ...(meta ?? {}), context: ctx.slug });
  console.log(`${pc.green("✓")} Default context for this folder: ${pc.bold(ctx.slug)}`);
  console.log(pc.dim("Saved in .getmyenv/project.json."));
}
