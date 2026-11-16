import fs from "node:fs";
import path from "node:path";
import { pcErr as pc } from "../lib/colors.js";
import { FACTS, isOwnEnvName, ownEnvNameError, plural, unsafeEnvWarning, VARIABLE_NAME_HELP } from "@getmyenv/shared";
import {
  contextSlugFromEnvFile,
  duplicateEnvNames,
  ensureGitignoreHasEnv,
  readEnvFile,
  promptConfirm,
  rootEnvFiles,
} from "../lib/fs.js";
import type { ContextInfo } from "../lib/api.js";
import { ensureTokenAndLink, type Linked } from "../lib/bootstrap.js";
import { defaultContextSlug, findContext, resolveContext } from "../lib/context.js";
import { confirmDiff } from "../lib/confirm.js";
import { printDidYouMean, printPublicSecretWarnings } from "../lib/known-keys.js";
import { refreshKnownKeys } from "../lib/known-keys-cache.js";
import { syncFromLinked } from "../lib/template-file.js";
import { uploadValues } from "../lib/upload.js";
import { runLine } from "./start.js";

export type ImportOpts = {
  context?: string;
  apiUrl?: string;
  prune?: boolean;
  dryRun?: boolean;
  yes?: boolean;
  /** The caller prints its own run line. */
  noRunLine?: boolean;
};

type Target = { slug: string; files: string[] };

/** `.env` before `.env.local`, so local files win on merge. */
function byLocalLast(a: string, b: string): number {
  const la = a.endsWith(".local") ? 1 : 0;
  const lb = b.endsWith(".local") ? 1 : 0;
  return la - lb || a.localeCompare(b);
}

/**
 * Plan which file goes to which context.
 * `.env.<slug>` maps to that context. `.env` and `.env.local` go to the
 * default context, or to -c when given.
 */
export function planImport(
  files: string[],
  opts: { explicitFile: boolean; context?: string; defaultSlug: string }
): Target[] {
  const map = new Map<string, string[]>();
  for (const file of [...files].sort(byLocalLast)) {
    const fromName = contextSlugFromEnvFile(file);
    const slug = opts.explicitFile
      ? (opts.context ?? fromName ?? opts.defaultSlug)
      : (fromName ?? opts.context ?? opts.defaultSlug);
    if (!opts.explicitFile && opts.context && slug !== opts.context) continue;
    map.set(slug, [...(map.get(slug) ?? []), file]);
  }
  return [...map.entries()].map(([slug, list]) => ({ slug, files: list }));
}

function titleFromSlug(slug: string): string {
  return slug
    .split("-")
    .map((w) => (w ? w[0]!.toUpperCase() + w.slice(1) : w))
    .join(" ");
}

async function ensureTargetContext(
  linked: Linked,
  slug: string,
  opts: ImportOpts
): Promise<ContextInfo | null> {
  const found = findContext(linked.who.contexts, slug);
  if (found) return found;
  if (linked.who.isGuest || linked.who.token.kind !== "folder") {
    const why = linked.who.isGuest ? FACTS.guestContexts : "Server tokens cannot change values.";
    console.error(pc.yellow(`Skipped ${slug}: no such context. ${why}`));
    return null;
  }
  if (opts.dryRun) {
    console.error(pc.dim(`Would create open context ${slug}.`));
    return { id: 0, slug, name: titleFromSlug(slug), protection: "open" };
  }
  const create =
    opts.yes || (process.stdin.isTTY && (await promptConfirm(`Create open context ${slug}?`, { defaultYes: true })));
  if (!create) {
    const hint = process.stdin.isTTY ? "" : " Or pass --yes.";
    console.error(pc.dim(`Skipped ${slug}. Create it: npx getmyenv context create "${titleFromSlug(slug)}".${hint}`));
    return null;
  }
  const created = await linked.client.request<ContextInfo>("POST", "/api/cli/contexts", {
    name: titleFromSlug(slug),
  });
  linked.who.contexts.push(created);
  console.error(`${pc.green("✓")} Created context ${created.slug}`);
  return created;
}

/** `import [file]`: encrypt .env values locally and upload them to contexts. */
export async function importCommand(file: string | undefined, opts: ImportOpts): Promise<void> {
  const linked = await ensureTokenAndLink({ apiUrl: opts.apiUrl });
  await refreshKnownKeys(linked.apiUrl);
  const { who, meta } = linked;
  const explicitContext = opts.context ? resolveContext(who, meta, opts.context).slug : undefined;

  let files: string[];
  if (file) {
    const resolved = path.resolve(process.cwd(), file);
    if (!fs.existsSync(resolved)) throw new Error(`File not found: ${file}`);
    if (!fs.statSync(resolved).isFile()) {
      throw new Error(`${file} is not a file. Pass an env file: npx getmyenv import path/to/.env`);
    }
    files = [resolved];
  } else {
    files = rootEnvFiles();
    if (files.length === 0) {
      throw new Error("No .env files in this folder. Pass one: npx getmyenv import path/to/.env");
    }
  }

  const targets = planImport(files, {
    explicitFile: Boolean(file),
    context: explicitContext,
    defaultSlug: defaultContextSlug(who, meta),
  });
  if (targets.length === 0) {
    throw new Error(`No .env files map to ${explicitContext}. Pass a file: npx getmyenv import .env -c ${explicitContext}`);
  }

  if (opts.dryRun) console.error(pc.dim("Dry run. Nothing is uploaded.\n"));

  let imported = 0;
  let changed = 0;
  let skipped = 0;
  const added: string[] = [];
  for (const target of targets) {
    const label = target.files.map((f) => path.relative(process.cwd(), f) || f).join(" + ");
    const ctx = await ensureTargetContext(linked, target.slug, opts);
    if (!ctx) {
      skipped++;
      continue;
    }
    if (ctx.protection === "locked") {
      console.error(pc.yellow(`Skipped ${label}: ${ctx.slug} is Read-only. ${FACTS.readOnlyWho}`));
      skipped++;
      continue;
    }

    const pairs: Record<string, string> = {};
    const badNames: string[] = [];
    for (const f of target.files) {
      const read = readEnvFile(f);
      Object.assign(pairs, read.values);
      badNames.push(...read.skipped);
      const rel = path.relative(process.cwd(), f) || f;
      for (const dup of duplicateEnvNames(f)) {
        console.error(pc.yellow(`${dup.name} appears ${dup.count} times in ${rel}. The last one is used.`));
      }
    }
    if (badNames.length > 0) {
      console.error(pc.yellow(`Skipped ${[...new Set(badNames)].join(", ")}. ${VARIABLE_NAME_HELP}`));
    }
    const own = ownEnvNameError(Object.keys(pairs));
    if (own) {
      for (const name of Object.keys(pairs)) if (isOwnEnvName(name)) delete pairs[name];
      console.error(pc.yellow(`Skipped ${own}`));
    }
    const names = Object.keys(pairs);
    if (names.length === 0) {
      console.error(pc.dim(`Skipped ${label}: no variables.`));
      // A file named on the command line that holds nothing is an error, not a quiet success.
      if (file) skipped++;
      continue;
    }

    const statusOf = (name: string) =>
      who.keys.find((k) => k.name === name)?.status[ctx.slug] ?? "missing";
    const hostedOnly = who.keys
      .filter((k) => !(k.name in pairs) && statusOf(k.name) !== "missing")
      .map((k) => k.name);

    console.error(`${pc.bold(label)} -> ${ctx.slug}`);
    for (const name of names.sort()) {
      const sign = pairs[name] === "" ? pc.yellow("○") : statusOf(name) === "missing" ? pc.green("+") : pc.cyan("~");
      console.error(`  ${sign} ${name}${pairs[name] === "" ? pc.dim(" (empty, declared only)") : ""}`);
    }
    for (const name of hostedOnly) {
      console.error(`  ${opts.prune ? pc.red("-") : pc.dim("=")} ${name}${pc.dim(opts.prune ? " (unset, not in file)" : " (kept, not in file)")}`);
    }
    printDidYouMean(names, "  ");
    printPublicSecretWarnings(pairs, "  ");
    const unsafe = unsafeEnvWarning(names);
    if (unsafe) console.error(pc.yellow(`  ${unsafe}`));

    if (opts.dryRun) {
      console.error("");
      continue;
    }

    if (opts.prune && hostedOnly.length > 0) {
      const ok = await confirmDiff({
        conflicts: [],
        removed: hostedOnly.map((name) => ({ name, detail: `unset in ${ctx.slug}` })),
        removedLabel: "not in the file",
        action: `Unset ${plural(hostedOnly.length, "value")} not in the file`,
        yes: opts.yes,
      });
      if (!ok) {
        console.error(pc.dim("Skipped.\n"));
        skipped++;
        continue;
      }
    }

    const res = await uploadValues({
      linked,
      context: ctx,
      pairs,
      prune: opts.prune,
    });
    imported += res.set.length;
    changed += res.set.length + res.declared.length + res.pruned.length;
    added.push(...res.set, ...res.declared);
    console.error(
      `${pc.green("✓")} ${res.set.length} set, ${res.declared.length} declared${res.pruned.length ? `, ${res.pruned.length} unset` : ""} in ${ctx.slug}\n`
    );
  }

  if (opts.dryRun) return;
  syncFromLinked(linked, { added });
  if (changed === 0 && skipped > 0) {
    throw new Error("Nothing was imported. See the skipped files above.");
  }
  ensureGitignoreHasEnv();
  if (imported > 0) {
    console.error(pc.dim(`Your .env files are unchanged. ${FACTS.runIgnoresEnvFile}\n`));
    if (!opts.noRunLine) {
      console.error("Start your app with:");
      console.error(pc.cyan(`  ${runLine(explicitContext ?? defaultContextSlug(who, meta))}\n`));
    }
  }
}
