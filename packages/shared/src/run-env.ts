/**
 * Pure pieces of `getmyenv run`: merge, validate, explain. Names only in any
 * output. The CLI runs these, and the homepage demo renders them, so the demo
 * prints what the CLI prints.
 */

export type MissingKey = { name: string; reason: "missing" | "expired" };

export type ParentEnv = Record<string, string | undefined>;

export type EnvOrigin =
  | "context"
  | "context-overrides-parent"
  | "parent-kept"
  | "parent-fills-missing"
  | "missing";

export type ExplainEntry = { name: string; origin: EnvOrigin; reason?: MissingKey["reason"] };

export type MergeResult = {
  env: ParentEnv;
  /** Names set from the context. */
  applied: string[];
  /** Names the context replaced in the parent env. */
  overridden: string[];
  /** Names the parent env kept because of --keep-existing. */
  kept: string[];
  /** Keys missing in the context but present in the parent env. */
  filledByParent: string[];
  /** Keys missing in the context and absent from the parent env. */
  unresolved: MissingKey[];
  /** GETMYENV_* names in the context. Never passed to the child. */
  ignored: string[];
  entries: ExplainEntry[];
};

/** "1 variable", "2 variables". */
export function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}

/** Prefix of every error the CLI prints. */
export function formatCliError(message: string): string {
  return `getmyenv: ${message}`;
}

/** The CLI's own settings (token, API URL, config dir). Any case: Windows env names ignore it. */
export function isOwnEnvName(name: string): boolean {
  return name.toUpperCase().startsWith("GETMYENV_");
}

/** The child never sees the CLI's own settings (token, API URL, config dir). */
export function withoutOwnEnv(parent: ParentEnv): ParentEnv {
  const env: ParentEnv = {};
  for (const [k, v] of Object.entries(parent)) {
    if (!isOwnEnvName(k)) env[k] = v;
  }
  return env;
}

/** Why `set` and `import` refuse GETMYENV_* names. Null when none. */
export function ownEnvNameError(names: string[]): string | null {
  const own = names.filter(isOwnEnvName).sort();
  if (own.length === 0) return null;
  return `${own.join(", ")}: names starting with GETMYENV_ are the CLI's own settings. run never passes them to your program. Pick another name.`;
}

/**
 * Names that change how programs start, which program runs, or where its
 * traffic goes. A value from the server here would let anyone who can write
 * the context run code on this machine. Best effort: no list covers every
 * program, so keep write access to contexts tight.
 */
export const UNSAFE_ENV_NAMES: readonly string[] = [
  "PATH",
  "PATHEXT",
  "COMSPEC",
  "SHELL",
  "BASH_ENV",
  "ENV",
  "PROMPT_COMMAND",
  "JAVA_TOOL_OPTIONS",
  "_JAVA_OPTIONS",
  "JDK_JAVA_OPTIONS",
  "BROWSER",
  "EDITOR",
  "VISUAL",
  "PAGER",
  "LESSOPEN",
  "LESSCLOSE",
  "SSH_ASKPASS",
  "SUDO_ASKPASS",
  "HTTP_PROXY",
  "HTTPS_PROXY",
  "ALL_PROXY",
  "NO_PROXY",
  "FTP_PROXY",
];
/** Matched without case: npm reads npm_config_* in any case, and Windows ignores case. */
export const UNSAFE_ENV_PREFIXES: readonly string[] = [
  "LD_",
  "DYLD_",
  "NODE_",
  "NPM_CONFIG_",
  "GIT_",
  "PYTHON",
  "PERL",
  "RUBY",
];
/** Common app names under an unsafe prefix that start nothing. */
export const SAFE_ENV_NAMES: readonly string[] = ["NODE_ENV", "PYTHONUNBUFFERED", "PYTHONDONTWRITEBYTECODE"];

export function isUnsafeEnvName(name: string): boolean {
  const upper = name.toUpperCase();
  if (SAFE_ENV_NAMES.includes(upper)) return false;
  return UNSAFE_ENV_NAMES.includes(upper) || UNSAFE_ENV_PREFIXES.some((p) => upper.startsWith(p));
}

/** Why `run` refuses: names from the context that change how programs start. Null when none. */
export function unsafeEnvError(names: string[], contextSlug: string): string | null {
  const unsafe = names.filter(isUnsafeEnvName).sort();
  if (unsafe.length === 0) return null;
  const one = unsafe.length === 1;
  return [
    `${contextSlug} sets ${unsafe.join(", ")}. ${one ? "It changes" : "These change"} how programs start, so anyone who can change ${contextSlug} could run code on this machine.`,
    `Remove ${one ? "it" : "them"} from the project: npx getmyenv unset ${unsafe.join(" ")} --all`,
    "Or run anyway: --allow-unsafe-env",
  ].join("\n");
}

/** One warning line for `set` and `import`. Null when no name is unsafe. */
export function unsafeEnvWarning(names: string[]): string | null {
  const unsafe = names.filter(isUnsafeEnvName).sort();
  if (unsafe.length === 0) return null;
  const one = unsafe.length === 1;
  return `${unsafe.join(", ")} ${one ? "changes" : "change"} how programs start. run refuses ${one ? "it" : "them"} unless you pass --allow-unsafe-env.`;
}

function present(parent: ParentEnv, name: string): boolean {
  const v = parent[name];
  return v !== undefined && v !== "";
}

/**
 * Merge context values into the parent env.
 * The context wins unless keepExisting is set. A key missing in the context is
 * satisfied when the parent env already has it (for example from `op run`).
 */
export function mergeEnv(
  parent: ParentEnv,
  values: Record<string, string>,
  missing: MissingKey[],
  keepExisting: boolean
): MergeResult {
  const env: ParentEnv = withoutOwnEnv(parent);
  const applied: string[] = [];
  const overridden: string[] = [];
  const kept: string[] = [];
  const entries: ExplainEntry[] = [];
  const ignored: string[] = [];

  for (const name of Object.keys(values).sort()) {
    // The CLI's own settings never come from a context, even with --allow-unsafe-env.
    if (isOwnEnvName(name)) {
      ignored.push(name);
      continue;
    }
    if (present(parent, name)) {
      if (keepExisting) {
        kept.push(name);
        entries.push({ name, origin: "parent-kept" });
        continue;
      }
      if (parent[name] !== values[name]) {
        overridden.push(name);
        entries.push({ name, origin: "context-overrides-parent" });
      } else {
        entries.push({ name, origin: "context" });
      }
    } else {
      entries.push({ name, origin: "context" });
    }
    env[name] = values[name];
    applied.push(name);
  }

  const filledByParent: string[] = [];
  const unresolved: MissingKey[] = [];
  for (const m of [...missing].sort((a, b) => a.name.localeCompare(b.name))) {
    if (isOwnEnvName(m.name)) {
      ignored.push(m.name);
      continue;
    }
    if (present(parent, m.name)) {
      filledByParent.push(m.name);
      entries.push({ name: m.name, origin: "parent-fills-missing", reason: m.reason });
    } else {
      unresolved.push(m);
      entries.push({ name: m.name, origin: "missing", reason: m.reason });
    }
  }

  entries.sort((a, b) => a.name.localeCompare(b.name));
  return { env, applied, overridden, kept, filledByParent, unresolved, ignored, entries };
}

/** Error text when keys are unresolved and --allow-missing is not set. Null when fine. */
export function validationError(
  result: Pick<MergeResult, "unresolved">,
  contextSlug: string,
  allowMissing: boolean
): string | null {
  if (allowMissing || result.unresolved.length === 0) return null;
  const n = result.unresolved.length;
  const them = n === 1 ? "it" : "them";
  const lines = result.unresolved.map(
    (m) => `  ${m.name}${m.reason === "expired" ? " (expired)" : ""}`
  );
  return [
    `${plural(n, "variable")} ${n === 1 ? "has" : "have"} no value in ${contextSlug}:`,
    ...lines,
    `Set ${them} in a terminal: npx getmyenv set --missing -c ${contextSlug}`,
    `Or remove ${them} from the project: npx getmyenv unset ${result.unresolved.map((m) => m.name).join(" ")} --all`,
    "Or run anyway: --allow-missing",
  ].join("\n");
}

const ORIGIN_TEXT: Record<EnvOrigin, (ctx: string, reason?: string) => string> = {
  context: (ctx) => `getmyenv (${ctx})`,
  "context-overrides-parent": (ctx) => `getmyenv (${ctx}), replaces parent env`,
  "parent-kept": () => "parent env (--keep-existing)",
  "parent-fills-missing": (ctx, reason) =>
    `parent env (${reason === "expired" ? "expired" : "missing"} in ${ctx})`,
  missing: (ctx, reason) => `not set (${reason === "expired" ? "expired" : "missing"} in ${ctx})`,
};

/** `run` context label: "Staging (staging)" or "Production (production, Read-only)". */
export function runContextLabel(context: { name: string; slug: string; protection: string }): string {
  return `${context.name} (${context.slug}${context.protection === "locked" ? ", Read-only" : ""})`;
}

/**
 * `--explain` output. Names and origins only, never values.
 * Names `run` refuses (isUnsafeEnvName) are marked, unless allowUnsafeEnv.
 */
export function explainLines(
  result: MergeResult,
  contextSlug: string,
  opts: { allowUnsafeEnv?: boolean } = {}
): string[] {
  const width = Math.max(4, ...result.entries.map((e) => e.name.length));
  const fromContext = new Set(result.applied);
  const lines = result.entries.map((e) => {
    const refused = !opts.allowUnsafeEnv && fromContext.has(e.name) && isUnsafeEnvName(e.name);
    const note = refused ? ", refused: changes how programs start" : "";
    return `  ${e.name.padEnd(width)}  ${ORIGIN_TEXT[e.origin](contextSlug, e.reason)}${note}`;
  });
  lines.push("");
  lines.push(
    `  ${result.applied.length} from getmyenv, ${result.overridden.length} replaced, ${result.kept.length} kept, ${result.filledByParent.length} from parent env, ${result.unresolved.length} not set`
  );
  return lines;
}
