import fs from "node:fs";
import path from "node:path";
import {
  CONTEXT_NAME_MAX,
  CONTEXT_NAME_HELP,
  FACTS,
  MAX_VALUES_PER_REQUEST,
  NEW_MACHINE_POLICY_LABELS,
  TEMPLATE_FILE,
  explainLines,
  isValidContextName,
  mergeEnv,
  ownEnvNameError,
  plural,
  runContextLabel,
  unsafeEnvError,
  unsafeEnvWarning,
  validationError,
  VARIABLE_NAME_HELP,
  variableNameSchema,
  type CliMcpTool,
  type MissingKey,
} from "@getmyenv/shared";
import { getSessionToken, type ContextInfo, type WhoamiResponse } from "../lib/api.js";
import { ensureTokenAndLink, notLinkedMessage, type Linked } from "../lib/bootstrap.js";
import { defaultContextSlug, resolveContext } from "../lib/context.js";
import { toolError, toolText, type JsonSchema, type McpTool, type ToolResult } from "../lib/mcp-protocol.js";
import { readTemplateFile, syncFromLinked } from "../lib/template-file.js";
import { assertWritable, uploadValues } from "../lib/upload.js";
import { createContext } from "./context.js";
import { createGuestProject } from "./guest.js";
import { looksLikeSecret, missingNames } from "./set.js";
import { runLine } from "./start.js";

/**
 * The tools of `npx getmyenv mcp`. Names, status and commands only: no tool
 * reads, returns or accepts a secret value, a token, a claim code or ciphertext.
 */

export type McpToolOpts = { apiUrl?: string };

const CWD_SCHEMA: JsonSchema = {
  type: "string",
  minLength: 1,
  description:
    "The project folder, the one that holds .getmyenv/ (or a subfolder). Default: the folder the MCP server started in.",
};

const CONTEXT_SCHEMA: JsonSchema = {
  type: "string",
  minLength: 1,
  maxLength: 120,
  description:
    "Context slug or name, like development or staging. Default: the server token's context, then project.json, then development.",
};

function inputSchema(properties: Record<string, JsonSchema>, required: string[] = []): McpTool["inputSchema"] {
  return {
    type: "object",
    properties: { ...properties, cwd: CWD_SCHEMA },
    ...(required.length > 0 ? { required } : {}),
    additionalProperties: false,
  };
}

const READ_ONLY = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false };

/** Shown to every agent that connects. */
export const MCP_INSTRUCTIONS = [
  "getmyenv stores environment variables end-to-end encrypted. These tools handle names, contexts and status only.",
  "Secret values must never enter your context: no tool reads, returns or accepts a value.",
  "To fill values, declare the names with declare_variables, then call ask_human_for_values and give the human the command it returns. They type each value in a hidden prompt in their own terminal.",
  "To start the app with its values, use: npx getmyenv run -- <command>. explain_run shows what run would pass, names only.",
].join("\n");

const NOT_LINKED_AGENT_HINT = "Agent: create_guest_project starts a guest project in this folder, no account needed.";

/** Tool calls run one at a time, so chdir for `cwd` is safe. */
let queue: Promise<unknown> = Promise.resolve();

function serial<T>(work: () => Promise<T>): Promise<T> {
  const next = queue.then(work, work);
  queue = next.catch(() => undefined);
  return next;
}

/** Run `work` with the process in `cwd`. Every .getmyenv reader uses process.cwd(). */
export function inFolder<T>(cwd: unknown, work: () => Promise<T>): Promise<T> {
  return serial(async () => {
    const before = process.cwd();
    if (typeof cwd === "string" && cwd.trim()) {
      const dir = path.resolve(before, cwd.trim());
      let isDir = false;
      try {
        isDir = fs.statSync(dir).isDirectory();
      } catch {
        /* missing */
      }
      if (!isDir) throw new Error(`No folder at ${dir}. Pass cwd as the project folder.`);
      process.chdir(dir);
    }
    try {
      return await work();
    } finally {
      process.chdir(before);
    }
  });
}

/** The linked project, or the CLI's next steps. Never starts setup or prompts. */
async function linked(opts: McpToolOpts): Promise<Linked> {
  if (!getSessionToken()) throw new Error(`${notLinkedMessage()}\n${NOT_LINKED_AGENT_HINT}`);
  return ensureTokenAndLink({ apiUrl: opts.apiUrl, quiet: true });
}

function str(v: unknown): string | undefined {
  return typeof v === "string" && v.trim() ? v.trim() : undefined;
}

function protectionLabel(c: ContextInfo): "open" | "read-only" {
  return c.protection === "locked" ? "read-only" : "open";
}

function contextJson(c: ContextInfo, current: string) {
  return { slug: c.slug, name: c.name, protection: protectionLabel(c), default: c.slug === current };
}

function tokenSummary(who: WhoamiResponse): string {
  if (who.token.member) return "folder, shared project (the contexts the owner shared with you)";
  if (who.token.kind === "server") return `server (reads ${who.token.context ?? "one Read-only context"})`;
  if (who.token.kind === "guest") return "guest (Development, read and write)";
  return "folder (open contexts, read and write)";
}

function guestLine(who: WhoamiResponse): string | null {
  if (!who.isGuest) return null;
  const when = who.guestExpiresAt ? ` Active until ${who.guestExpiresAt} unless used again.` : "";
  return `Guest project.${when} To keep it, the human runs npx getmyenv claim in this folder.`;
}

function isSet(status: string | undefined): boolean {
  return status === "set" || status === "expiring_soon";
}

/** `set --missing` for this context, with -c when it is not the folder's default. */
function setMissingCommand(slug: string, current: string): string {
  const flag = slug === current ? "" : ` -c ${slug}`;
  return "npx getmyenv set --missing" + flag;
}

/** Fixed-width rows, like `getmyenv ls`. */
function grid(rows: string[][]): string[] {
  const widths = rows[0]!.map((_, i) => Math.max(...rows.map((r) => r[i]!.length)));
  return rows.map((r) => r.map((cell, i) => (i === r.length - 1 ? cell : cell.padEnd(widths[i]!))).join("  ").trimEnd());
}

async function statusTool(opts: McpToolOpts): Promise<ToolResult> {
  const { who, meta } = await linked(opts);
  const current = defaultContextSlug(who, meta);
  const contexts = who.contexts.map((c) => ({
    ...contextJson(c, current),
    set: who.keys.filter((k) => isSet(k.status[c.slug])).length,
  }));
  const total = who.keys.length;
  const width = Math.max(4, ...contexts.map((c) => c.slug.length));
  const run = runLine(current);
  const lines = [
    `Project: ${who.project.name}`,
    `Token: ${tokenSummary(who)}`,
    ...(who.token.kind === "server" && who.token.newMachinePolicy
      ? [`New machines: ${NEW_MACHINE_POLICY_LABELS[who.token.newMachinePolicy]}`]
      : []),
    ...(guestLine(who) ? [guestLine(who)!] : []),
    `Default context: ${current}`,
    "",
    `Contexts (${plural(total, "variable")}):`,
    ...contexts.map(
      (c) => `  ${c.default ? "*" : " "} ${c.slug.padEnd(width)}  ${c.set}/${total} set${c.protection === "read-only" ? "  Read-only" : ""}  ${c.name}`
    ),
  ];
  if (total > 0) {
    lines.push("", "Variables by context (names and status, never values):");
    const rows = [["NAME", ...who.contexts.map((c) => c.slug)]];
    for (const k of who.keys) rows.push([k.name, ...who.contexts.map((c) => k.status[c.slug] ?? "missing")]);
    lines.push(...grid(rows).map((l) => `  ${l}`));
  }
  lines.push("", `Run the app: ${run}`);
  return toolText(lines.join("\n"), {
    project: who.project,
    token: {
      kind: who.token.kind,
      member: who.token.member === true,
      ...(who.token.kind === "server" ? { context: who.token.context } : {}),
    },
    guest: who.isGuest ? { expiresAt: who.guestExpiresAt } : null,
    defaultContext: current,
    contexts,
    variables: who.keys.map((k) => ({
      name: k.name,
      status: Object.fromEntries(who.contexts.map((c) => [c.slug, k.status[c.slug] ?? "missing"])),
    })),
    runCommand: run,
  });
}

async function listContextsTool(opts: McpToolOpts): Promise<ToolResult> {
  const { who, meta } = await linked(opts);
  const current = defaultContextSlug(who, meta);
  const contexts = who.contexts.map((c) => contextJson(c, current));
  const width = Math.max(4, ...contexts.map((c) => c.slug.length));
  const lines = contexts.map(
    (c) => `${c.default ? "*" : " "} ${c.slug.padEnd(width)}  ${c.protection === "read-only" ? "Read-only" : "open     "}  ${c.name}`
  );
  lines.push("", `* is this folder's default context. ${FACTS.readOnlyWho}`);
  return toolText(lines.join("\n"), { defaultContext: current, contexts });
}

/** Names only. An entry with "=" may hold a value: refuse the call and never echo it. */
function checkNames(raw: string[]): { names: string[] } | { error: string } {
  if (raw.some((n) => n.includes("="))) {
    return {
      error:
        "declare_variables takes names only, never values. An entry has \"=\", so it is not shown and nothing was sent. Pass names like API_KEY, then call ask_human_for_values so the human types the values in a hidden prompt.",
    };
  }
  // A rejected entry may be a secret, so it is named by position, never echoed.
  const trimmed = raw.map((n) => n.trim());
  for (const [i, name] of trimmed.entries()) {
    if (looksLikeSecret(name)) {
      return {
        error: `Entry ${i + 1} looks like a secret value, such as an API key, not a variable name. It is not shown and nothing was sent. Pass names like API_KEY, then call ask_human_for_values so the human types the values in a hidden prompt.`,
      };
    }
    if (!variableNameSchema.safeParse(name).success) {
      return { error: `Entry ${i + 1} is not a valid variable name. ${VARIABLE_NAME_HELP} Nothing was sent.` };
    }
  }
  const names = [...new Set(trimmed)];
  const own = ownEnvNameError(names);
  if (own) return { error: own };
  return { names };
}

async function declareVariablesTool(args: Record<string, unknown>, opts: McpToolOpts): Promise<ToolResult> {
  const checked = checkNames(args.names as string[]);
  if ("error" in checked) return toolError(checked.error);
  const { names } = checked;
  const link = await linked(opts);
  const ctx = resolveContext(link.who, link.meta, str(args.context));
  assertWritable(link, ctx);
  const res = await uploadValues({ linked: link, context: ctx, pairs: Object.fromEntries(names.map((n) => [n, ""])) });
  syncFromLinked(link, { added: res.declared });
  const current = defaultContextSlug(link.who, link.meta);
  const existing = names.filter((n) => !res.declared.includes(n));
  const withValue = existing.filter((n) => isSet(link.who.keys.find((k) => k.name === n)?.status[ctx.slug]));
  const missing = missingNames(
    [...link.who.keys, ...res.declared.map((name) => ({ name, status: {} }))],
    ctx.slug
  );
  const lines = [
    res.declared.length > 0
      ? `Declared in ${ctx.slug}, no value yet: ${res.declared.join(", ")}`
      : `No new names in ${ctx.slug}.`,
    ...(existing.length > 0 ? [`Already in the project: ${existing.join(", ")}. Their values did not change.`] : []),
  ];
  const unsafe = unsafeEnvWarning(names);
  if (unsafe) lines.push(unsafe);
  if (missing.length > 0) {
    lines.push(
      "",
      `${plural(missing.length, "variable")} ${missing.length === 1 ? "has" : "have"} no value in ${ctx.slug}. Next: call ask_human_for_values, or ask the human to run ${setMissingCommand(ctx.slug, current)} in their own terminal.`
    );
  }
  return toolText(lines.join("\n"), {
    context: ctx.slug,
    declared: res.declared,
    existing,
    withValue,
    missing,
  });
}

async function createGuestProjectTool(args: Record<string, unknown>, opts: McpToolOpts): Promise<ToolResult> {
  if (getSessionToken()) {
    return toolError(
      "This folder is already linked to a getmyenv project. Call status to see it. To start over, the human runs npx getmyenv unlink in a terminal."
    );
  }
  const read = readTemplateFile();
  const file = read?.ok ? read.file : null;
  const name = str(args.name) ?? file?.name;
  const created = await createGuestProject({ apiUrl: opts.apiUrl, ...(name ? { name } : {}) });
  let declared: string[] = [];
  if (file && file.keys.length > 0) {
    const { applyTemplateFile } = await import("./template.js");
    await applyTemplateFile(file, { apiUrl: opts.apiUrl, ask: false });
    declared = file.keys.map((k) => k.name);
  }
  const lines = [
    `Guest project ${created.projectName} created. Context: development. No account needed.`,
    `Active until ${created.guestExpiresAt} unless used again. ${FACTS.guestShort}`,
    ...(declared.length > 0 ? [`Names from ${TEMPLATE_FILE} declared, no values yet: ${declared.join(", ")}`] : []),
    "",
    "Tell the human: to keep this project, run npx getmyenv claim in this folder, in your own terminal. It reads .getmyenv/claim.json and asks you to sign in.",
    FACTS.claimHandoff,
    FACTS.claimLoss,
    "",
    "Next: declare_variables with the names the app needs, then ask_human_for_values.",
  ];
  return toolText(lines.join("\n"), {
    project: { id: created.projectId, name: created.projectName },
    context: "development",
    guestExpiresAt: created.guestExpiresAt,
    declared,
    claimCommand: "npx getmyenv claim",
  });
}

async function createContextTool(args: Record<string, unknown>, opts: McpToolOpts): Promise<ToolResult> {
  const name = String(args.name).trim();
  if (!isValidContextName(name)) return toolError(`Invalid context name. ${CONTEXT_NAME_HELP} Up to ${CONTEXT_NAME_MAX} characters.`);
  if (!getSessionToken()) throw new Error(`${notLinkedMessage()}\n${NOT_LINKED_AGENT_HINT}`);
  const { created, source, copied, copyError } = await createContext(name, {
    apiUrl: opts.apiUrl,
    from: str(args.from),
    softCopy: true,
  });
  const lines = [`Context ${created.name} (${created.slug}) created, open.`];
  if (source && copyError) {
    lines.push(
      `Values were not copied from ${source.slug}: ${copyError}`,
      "The context exists with no values. Declare the names with declare_variables, then call ask_human_for_values."
    );
  } else if (source) {
    lines.push(`${plural(copied, "value")} copied from ${source.slug}, encrypted on this machine.`);
  }
  lines.push(`Run with it: npx getmyenv run ${created.slug} -- <command>`);
  return toolText(lines.join("\n"), {
    context: { slug: created.slug, name: created.name, protection: protectionLabel(created) },
    ...(source ? { copiedFrom: source.slug, copied, ...(copyError ? { copyError } : {}) } : {}),
  });
}

/** Stands in for every value: never compared equal to a parent value, never shown. */
const NOT_READ = "\u0000getmyenv-mcp-not-read";

async function explainRunTool(args: Record<string, unknown>, opts: McpToolOpts): Promise<ToolResult> {
  const { who, meta } = await linked(opts);
  const ctx = resolveContext(who, meta, str(args.context));
  const current = defaultContextSlug(who, meta);
  // whoami says which names have a value. Nothing is decrypted, so no Vault password and no approval.
  const values: Record<string, string> = {};
  const missing: MissingKey[] = [];
  for (const k of who.keys) {
    const s = k.status[ctx.slug] ?? "missing";
    if (isSet(s)) values[k.name] = NOT_READ;
    else missing.push({ name: k.name, reason: s === "expired" ? "expired" : "missing" });
  }
  const merged = mergeEnv(process.env, values, missing, false);
  const run = runLine(ctx.slug);
  const lines = [`${who.project.name} / ${runContextLabel(ctx)}`, ...explainLines(merged, ctx.slug), ""];
  lines.push("Parent env is this MCP server's environment. Names only, values are not read.");
  if (ctx.protection === "locked" && who.token.kind !== "server") {
    lines.push(`${ctx.slug} is Read-only. run reads it on servers with a server token, not with this folder's token.`);
  }
  const notSet = validationError(merged, ctx.slug, false);
  const unsafe = unsafeEnvError(merged.applied, ctx.slug);
  if (notSet) lines.push("", notSet.replace(`npx getmyenv set --missing -c ${ctx.slug}`, setMissingCommand(ctx.slug, current)));
  if (unsafe) lines.push("", unsafe);
  if (!notSet && !unsafe) lines.push("", `Ready: ${run}`);
  return toolText(lines.join("\n"), {
    project: who.project,
    context: { slug: ctx.slug, name: ctx.name, protection: protectionLabel(ctx) },
    entries: merged.entries.map((e) => ({ name: e.name, origin: e.origin, ...(e.reason ? { reason: e.reason } : {}) })),
    counts: {
      fromGetmyenv: merged.applied.length,
      replaced: merged.overridden.length,
      kept: merged.kept.length,
      fromParentEnv: merged.filledByParent.length,
      notSet: merged.unresolved.length,
    },
    notSet: merged.unresolved.map((m) => m.name),
    ready: !notSet && !unsafe,
    runCommand: run,
  });
}

async function askHumanTool(args: Record<string, unknown>, opts: McpToolOpts): Promise<ToolResult> {
  const link = await linked(opts);
  const { who, meta } = link;
  const ctx = resolveContext(who, meta, str(args.context));
  assertWritable(link, ctx);
  const current = defaultContextSlug(who, meta);
  if (who.keys.length === 0) {
    return toolText(`No variable names yet. Declare them first with declare_variables, then call this again.`, {
      context: ctx.slug,
      missing: [],
      expired: [],
      command: null,
    });
  }
  const missing = missingNames(who.keys, ctx.slug);
  const expired = who.keys.filter((k) => k.status[ctx.slug] === "expired").map((k) => k.name);
  if (missing.length === 0 && expired.length === 0) {
    return toolText(`Every variable in ${ctx.slug} has a value. Nothing to ask.`, {
      context: ctx.slug,
      missing,
      expired,
      command: null,
    });
  }
  const command = missing.length > 0 ? setMissingCommand(ctx.slug, current) : null;
  const flag = ctx.slug === current ? "" : ` -c ${ctx.slug}`;
  const lines: string[] = [];
  if (command) {
    lines.push(
      `${plural(missing.length, "variable")} ${missing.length === 1 ? "has" : "have"} no value in ${ctx.slug}: ${missing.join(", ")}`,
      "",
      "Ask the human to run this in their own terminal (not through you):",
      `  ${command}`,
      "",
      "It asks for each value in a hidden prompt, so the values never enter this chat. Leaving one empty skips it."
    );
  }
  if (expired.length > 0) {
    lines.push(
      ...(command ? [""] : []),
      `Expired in ${ctx.slug}: ${expired.join(", ")}. The human sets a new value in a terminal, with a hidden prompt:`,
      ...expired.map((n) => `  npx getmyenv set ${n}${flag}`)
    );
  }
  lines.push(
    "",
    "Do not ask for values in chat. If the human pastes one, it is sent to your AI provider, so tell them to rotate it at its provider afterwards.",
    "When they are done, call explain_run to check."
  );
  return toolText(lines.join("\n"), { context: ctx.slug, missing, expired, command });
}

/** The tools in CLI_MCP_TOOLS order. */
export function getmyenvTools(opts: McpToolOpts = {}): McpTool[] {
  const tools: Array<McpTool & { name: CliMcpTool }> = [
    {
      name: "status",
      title: "Project status",
      description:
        "Show the linked getmyenv project for this folder: project name, token kind, contexts, and which variable names have a value in each context (set, missing, expired, expiring_soon). Never values. Use it first, to see what is set up and what is missing.",
      inputSchema: inputSchema({}),
      annotations: READ_ONLY,
      run: () => statusTool(opts),
    },
    {
      name: "list_contexts",
      title: "List contexts",
      description:
        "List the project's contexts (like development, staging, production) with slug, name and protection (open or read-only), and mark this folder's default. Use it to pick the context for another tool.",
      inputSchema: inputSchema({}),
      annotations: READ_ONLY,
      run: () => listContextsTool(opts),
    },
    {
      name: "declare_variables",
      title: "Declare variable names",
      description:
        "Add variable names to the project with no values, like `npx getmyenv set KEY=`. Names only: uppercase letters, numbers and underscores, like API_KEY. Never pass a value here; an entry with \"=\" is refused. Names that already exist keep their values. Then call ask_human_for_values so the human types the values in a hidden prompt.",
      inputSchema: inputSchema(
        {
          names: {
            type: "array",
            items: { type: "string", minLength: 1, maxLength: 256 },
            minItems: 1,
            maxItems: MAX_VALUES_PER_REQUEST,
            description: "Variable names, like [\"DATABASE_URL\", \"STRIPE_SECRET_KEY\"]. Names only.",
          },
          context: CONTEXT_SCHEMA,
        },
        ["names"]
      ),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
      run: (args) => declareVariablesTool(args, opts),
    },
    {
      name: "create_guest_project",
      title: "Create a guest project",
      description: `Create a getmyenv guest project for this folder without an account, like \`npx getmyenv guest\`. Use it when status says the folder is not linked. ${FACTS.guestShort} Returns the project name, when it expires and how the human claims it. The token and claim code stay in .getmyenv/ and are never returned.`,
      inputSchema: inputSchema({
        name: { type: "string", minLength: 1, maxLength: 120, description: "Project name. Default: the folder name." },
      }),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
      run: (args) => createGuestProjectTool(args, opts),
    },
    {
      name: "create_context",
      title: "Create a context",
      description: `Create an open context, like \`npx getmyenv context create "Customer Acme"\`. With from, copy the values of an open context into it; they are decrypted and encrypted again on this machine and never returned. ${FACTS.guestContexts}`,
      inputSchema: inputSchema(
        {
          name: { type: "string", minLength: 1, maxLength: CONTEXT_NAME_MAX, description: "Context name, like Staging or Customer Acme." },
          from: { type: "string", minLength: 1, maxLength: 120, description: "Slug of an open context to copy values from." },
        },
        ["name"]
      ),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
      run: (args) => createContextTool(args, opts),
    },
    {
      name: "explain_run",
      title: "Explain run",
      description:
        "Show what `npx getmyenv run -- <command>` would pass for a context, like `run --explain`: each variable name and where its value comes from (getmyenv, the parent env, or not set). Names only, values are not read. Use it before starting the app, and after the human sets values.",
      inputSchema: inputSchema({ context: CONTEXT_SCHEMA }),
      annotations: READ_ONLY,
      run: (args) => explainRunTool(args, opts),
    },
    {
      name: "ask_human_for_values",
      title: "Ask the human for values",
      description:
        "Get the names with no value in a context and the exact command the human runs in their own terminal to type them in a hidden prompt (`npx getmyenv set --missing`). It does not prompt. Use it whenever values are needed: never ask for secret values in chat.",
      inputSchema: inputSchema({ context: CONTEXT_SCHEMA }),
      annotations: READ_ONLY,
      run: (args) => askHumanTool(args, opts),
    },
  ];
  return tools.map((t) => ({ ...t, run: (args) => inFolder(args.cwd, () => t.run(args)) }));
}
