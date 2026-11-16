import { pcErr as pc } from "../lib/colors.js";
import {
  linkDomain,
  parseTemplateRef,
  type PublicTemplate,
  type TemplateFile,
  type TemplateKey,
} from "@getmyenv/shared";
import { promptHidden } from "../lib/fs.js";
import { ApiClient, getSessionToken, resolveApiUrl, type ContextInfo } from "../lib/api.js";
import { ensureTokenAndLink, type Linked } from "../lib/bootstrap.js";
import { resolveContext } from "../lib/context.js";
import { knownKeys, refreshKnownKeys } from "../lib/known-keys-cache.js";
import { syncFromLinked } from "../lib/template-file.js";
import { assertWritable, uploadValues } from "../lib/upload.js";

/** Load a public template by id or URL. No token needed. */
export async function fetchTemplate(ref: string, apiUrl?: string): Promise<PublicTemplate> {
  const publicId = parseTemplateRef(ref);
  if (!publicId) {
    throw new Error(`Not a template id or link: ${ref}`);
  }
  const res = await new ApiClient(resolveApiUrl(apiUrl)).request<{ template: PublicTemplate }>(
    "GET",
    `/api/templates/public/${publicId}`
  );
  return res.template;
}

export function printTemplate(template: PublicTemplate): void {
  const n = template.keys.length;
  console.error(`Template ${pc.bold(template.name)} ${pc.dim(`(${n} variable${n === 1 ? "" : "s"})`)}`);
  if (template.description) console.error(pc.dim(template.description));
  console.error("");
}

/**
 * Add the template's names to the linked project, then ask for each value
 * that is still missing in the folder's default context. Enter skips one.
 */
export async function applyTemplate(
  template: PublicTemplate,
  opts: { apiUrl?: string }
): Promise<{ context: string }> {
  if (!getSessionToken()) throw new Error("Link this folder first: npx getmyenv start");
  const apiUrl = resolveApiUrl(opts.apiUrl);
  await new ApiClient(apiUrl, getSessionToken()).request("POST", "/api/cli/template", {
    publicId: template.publicId,
  });

  const linked = await ensureTokenAndLink({ apiUrl, quiet: true });
  const ctx = resolveContext(linked.who, linked.meta, undefined);
  assertWritable(linked, ctx);
  syncFromLinked(linked, { added: template.keys.map((k) => k.name) });
  await askMissingValues(template.keys, linked, ctx);
  return { context: ctx.slug };
}

/**
 * Declare the template file's names in the linked project, then ask for each
 * value that is still missing. Without a terminal, list them instead.
 * Values already set, for example from a .env import, are not touched.
 */
export async function applyTemplateFile(
  file: TemplateFile,
  opts: { apiUrl?: string; ask?: boolean }
): Promise<{ context: string }> {
  const linked = await ensureTokenAndLink({ apiUrl: opts.apiUrl, quiet: true });
  const ctx = resolveContext(linked.who, linked.meta, undefined);
  assertWritable(linked, ctx);
  const names = file.keys.map((k) => k.name);
  if (names.length > 0) {
    await linked.client.request("POST", "/api/cli/values", { context: ctx.slug, values: [], declare: names });
  }
  syncFromLinked(linked, { added: names });

  if (opts.ask ?? process.stdin.isTTY === true) {
    await askMissingValues(file.keys, linked, ctx);
    return { context: ctx.slug };
  }
  const todo = missingIn(file.keys, linked, ctx);
  if (todo.length > 0) {
    console.error(`No value yet in ${ctx.slug}: ${todo.map((k) => k.name).join(", ")}`);
    console.error(`Set ${todo.length === 1 ? "it" : "them"} in a terminal: npx getmyenv set --missing\n`);
  }
  return { context: ctx.slug };
}

function missingIn(keys: TemplateKey[], linked: Linked, ctx: ContextInfo): TemplateKey[] {
  const status = new Map(linked.who.keys.map((k) => [k.name, k.status[ctx.slug] ?? "missing"]));
  return keys.filter((k) => (status.get(k.name) ?? "missing") === "missing");
}

/**
 * Ask for each value still missing in ctx, hidden. Enter skips one and sends
 * nothing. `linked` must be fresh, so values set a moment ago are not asked.
 */
export async function askMissingValues(keys: TemplateKey[], linked: Linked, ctx: ContextInfo): Promise<void> {
  const todo = missingIn(keys, linked, ctx);
  if (todo.length === 0) {
    console.error(`${pc.green("✓")} Every template variable has a value in ${ctx.slug}.`);
    return;
  }

  await refreshKnownKeys(linked.apiUrl);
  const catalog = knownKeys();
  console.error(`Values for ${pc.bold(ctx.slug)}. Hidden as you type. Enter skips one.\n`);
  const pairs: Record<string, string> = {};
  for (const key of todo) {
    const known = catalog.get(key.name);
    const description = key.description || known?.description;
    const link = key.link || known?.docsUrl;
    console.error(`${pc.bold(key.name)}${key.optional ? pc.dim(" (optional)") : ""}`);
    if (description) console.error(pc.dim(`  ${description}`));
    if (link) console.error(pc.dim(`  Get it on ${linkDomain(link) ?? link}: ${link}`));
    const value = await promptHidden(`  ${key.name}: `);
    if (value) {
      const hint = catalog.formatHint(key.name, value);
      if (hint) console.error(pc.yellow(`  ${hint}`));
      pairs[key.name] = value;
    }
    console.error("");
  }

  if (Object.keys(pairs).length > 0) {
    const res = await uploadValues({ linked, context: ctx, pairs });
    for (const name of res.set) console.error(`${pc.green("✓")} ${name} ${pc.dim(`set in ${ctx.slug}`)}`);
  }
  const skipped = todo.filter((k) => !pairs[k.name]).map((k) => k.name);
  if (skipped.length > 0) {
    console.error(pc.dim(`No value yet: ${skipped.join(", ")}. Set later in a terminal: npx getmyenv set --missing`));
  }
  console.error("");
}
