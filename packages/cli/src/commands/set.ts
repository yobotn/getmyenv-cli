import { pc, pcErr } from "../lib/colors.js";
import { ownEnvNameError, plural, suggestVariableName, unsafeEnvWarning, VARIABLE_NAME_HELP, variableNameSchema } from "@getmyenv/shared";
import { promptHidden } from "../lib/fs.js";
import { ensureTokenAndLink } from "../lib/bootstrap.js";
import { resolveContext } from "../lib/context.js";
import { printDidYouMean, printPublicSecretWarnings } from "../lib/known-keys.js";
import { refreshKnownKeys } from "../lib/known-keys-cache.js";
import { syncFromLinked } from "../lib/template-file.js";
import { assertWritable, uploadValues } from "../lib/upload.js";

export type SetOpts = {
  context?: string;
  apiUrl?: string;
  expires?: string;
  /** Read the one value from stdin, so it never lands in argv or shell history. */
  stdin?: boolean;
  /** Prompt for every name with no value in the context. */
  missing?: boolean;
};

async function readStdinValue(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString("utf8").replace(/\r?\n$/, "");
}

/** Names declared in the project with no value in this context, in project order. */
export function missingNames(
  keys: Array<{ name: string; status: Record<string, string> }>,
  slug: string
): string[] {
  return keys.filter((k) => (k.status[slug] ?? "missing") === "missing").map((k) => k.name);
}

/** `set sk_live_...` without `KEY=` puts the value where the name goes. Never print it. */
function looksLikeValue(name: string): boolean {
  return name.length >= 24 || /[^A-Za-z0-9_.-]/.test(name);
}

export function invalidNameMessage(name: string): string {
  if (looksLikeValue(name)) {
    return `Invalid name. It looks like a value, so it is not shown. Use KEY=VALUE, or set KEY to be prompted. ${VARIABLE_NAME_HELP}`;
  }
  const hint = suggestVariableName(name);
  return `Invalid name: ${name}. ${VARIABLE_NAME_HELP}${hint ? ` Did you mean ${hint}?` : ""}`;
}

function parsePair(arg: string): { name: string; value?: string } {
  const eq = arg.indexOf("=");
  if (eq <= 0) return { name: arg.trim() };
  return { name: arg.slice(0, eq).trim(), value: arg.slice(eq + 1) };
}

/** A date a year from now, as YYYY-MM-DD, for examples that do not age. */
function exampleDate(now: Date): string {
  const d = new Date(now);
  d.setUTCFullYear(d.getUTCFullYear() + 1);
  return d.toISOString().slice(0, 10);
}

export function parseExpires(raw: string | undefined, now = new Date()): string | null | undefined {
  if (raw === undefined) return undefined;
  if (raw === "never" || raw === "") return null;
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) {
    throw new Error(`--expires takes a date like ${exampleDate(now)}, or never.`);
  }
  if (d.getTime() <= now.getTime()) {
    throw new Error(`--expires must be a future date, like ${exampleDate(now)}, or never.`);
  }
  return d.toISOString();
}

/** `set KEY[=VALUE] ...` Omitted values are prompted without echo. */
export async function setCommand(args: string[], opts: SetOpts): Promise<void> {
  if (opts.missing && (args.length > 0 || opts.stdin)) {
    throw new Error("--missing asks for every variable with no value. Run it without names or --stdin: npx getmyenv set --missing");
  }
  if (!opts.missing && args.length === 0) {
    throw new Error("Name a variable: npx getmyenv set KEY, or ask for every missing one: npx getmyenv set --missing");
  }
  const pairs = args.map(parsePair);
  for (const p of pairs) {
    if (!variableNameSchema.safeParse(p.name).success) {
      throw new Error(invalidNameMessage(p.name));
    }
  }
  const own = ownEnvNameError(pairs.map((p) => p.name));
  if (own) throw new Error(own);
  const expiresAt = parseExpires(opts.expires);
  if (opts.stdin) {
    if (pairs.length !== 1 || pairs[0]!.value !== undefined) {
      throw new Error("--stdin sets one variable: printf %s \"$VALUE\" | npx getmyenv set KEY --stdin");
    }
    if (process.stdin.isTTY) {
      throw new Error("--stdin reads a piped value: printf %s \"$VALUE\" | npx getmyenv set KEY --stdin");
    }
  }

  const linked = await ensureTokenAndLink({ apiUrl: opts.apiUrl });
  const ctx = resolveContext(linked.who, linked.meta, opts.context);
  assertWritable(linked, ctx);

  if (opts.missing) {
    const names = missingNames(linked.who.keys, ctx.slug);
    if (names.length === 0) {
      console.log(`${pc.green("✓")} Every variable in ${ctx.slug} has a value.`);
      return;
    }
    if (!process.stdin.isTTY) {
      throw new Error(
        `${plural(names.length, "variable")} ${names.length === 1 ? "has" : "have"} no value in ${ctx.slug}: ${names.join(", ")}. No terminal to ask in. Ask the human to run npx getmyenv set --missing in a terminal.`
      );
    }
    console.error(
      pcErr.dim(`${plural(names.length, "variable")} ${names.length === 1 ? "has" : "have"} no value in ${ctx.slug}. Leave one empty to skip it.`)
    );
    for (const name of names) pairs.push({ name });
  }

  const values: Record<string, string> = {};
  if (opts.stdin) {
    const piped = await readStdinValue();
    if (piped === "") throw new Error(`stdin was empty. Pipe a value, or declare the name with ${pairs[0]!.name}=`);
    values[pairs[0]!.name] = piped;
  }
  for (const p of pairs) {
    if (opts.stdin) break;
    if (p.value !== undefined) {
      values[p.name] = p.value;
      continue;
    }
    if (!process.stdin.isTTY) {
      throw new Error(
        `No value for ${p.name}, and no terminal to ask in. Ask the human to run npx getmyenv set ${p.name} in a terminal, or pass ${p.name}=VALUE, or pipe it with --stdin.`
      );
    }
    const typed = await promptHidden(`${p.name} (hidden): `);
    // With --missing, an empty answer skips the name. It already exists with no value.
    if (opts.missing && typed === "") continue;
    values[p.name] = typed;
  }
  if (Object.keys(values).length === 0) {
    console.log(pc.dim("Nothing to set."));
    return;
  }

  const res = await uploadValues({
    linked,
    context: ctx,
    pairs: values,
    expiresAt,
  });
  for (const name of res.set) console.log(`${pc.green("✓")} ${name} ${pc.dim(`set in ${ctx.slug}`)}`);
  for (const name of res.declared) console.log(`${pc.yellow("○")} ${name} ${pc.dim(`declared, no value in ${ctx.slug}`)}`);
  // KEY= on a name that already exists: the server keeps it as it is. Say so.
  for (const [name, value] of Object.entries(values)) {
    if (value !== "" || res.declared.includes(name)) continue;
    const status = linked.who.keys.find((k) => k.name === name)?.status[ctx.slug];
    console.log(
      status && status !== "missing"
        ? `${pc.dim("=")} ${name} ${pc.dim(`already has a value in ${ctx.slug}. An empty value does not clear it: npx getmyenv unset ${name}`)}`
        : `${pc.dim("=")} ${name} ${pc.dim(`already declared, no value in ${ctx.slug}`)}`
    );
  }
  const newNames = pairs.map((p) => p.name).filter((n) => !linked.who.keys.some((k) => k.name === n));
  if (newNames.length > 0) await refreshKnownKeys(linked.apiUrl);
  printDidYouMean(newNames);
  printPublicSecretWarnings(values);
  const unsafe = unsafeEnvWarning(Object.keys(values));
  if (unsafe) console.error(pcErr.yellow(unsafe));
  syncFromLinked(linked, { added: [...res.set, ...res.declared] });
}

/**
 * Why unset changed nothing. A declared name with no value in the context
 * stays in the project, and run still asks for it, so point to --all.
 */
export function unsetNoChangeLines(
  skipped: string[],
  keys: Array<{ name: string; status: Record<string, string> }>,
  slug: string,
  all: boolean
): string[] {
  const declared = all ? [] : skipped.filter((n) => keys.some((k) => k.name === n));
  const other = skipped.filter((n) => !declared.includes(n));
  const lines: string[] = [];
  if (declared.length > 0) {
    const one = declared.length === 1;
    lines.push(
      `${declared.join(", ")} ${one ? "has" : "have"} no value in ${slug}. The ${one ? "name stays" : "names stay"} in the project, and run asks for ${one ? "it" : "them"}. Remove ${one ? "it" : "them"}: npx getmyenv unset ${declared.join(" ")} --all`
    );
  }
  if (other.length > 0) lines.push(`No change: ${other.join(", ")}`);
  return lines;
}

export async function unsetCommand(
  names: string[],
  opts: { context?: string; apiUrl?: string; all?: boolean }
): Promise<void> {
  for (const n of names) {
    if (!variableNameSchema.safeParse(n).success) throw new Error(invalidNameMessage(n));
  }
  const linked = await ensureTokenAndLink({ apiUrl: opts.apiUrl });
  const ctx = resolveContext(linked.who, linked.meta, opts.context);
  assertWritable(linked, ctx);
  const res = await linked.client.request<{ removed: string[] }>("DELETE", "/api/cli/values", {
    context: ctx.slug,
    names,
    ...(opts.all ? { deleteKey: true } : {}),
  });
  const where = opts.all ? "removed from every context" : `unset in ${ctx.slug}`;
  for (const name of res.removed) console.log(`${pc.green("✓")} ${name} ${pc.dim(where)}`);
  const skipped = names.filter((n) => !res.removed.includes(n));
  for (const line of unsetNoChangeLines(skipped, linked.who.keys, ctx.slug, opts.all === true)) console.log(pc.dim(line));
  syncFromLinked(linked, opts.all ? { removed: res.removed } : {});
}
