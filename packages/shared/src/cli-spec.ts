import { FACTS } from "./facts.js";

/**
 * Every CLI command, argument, flag and environment variable. The CLI builds
 * its commander program from this, and the docs, llms.txt and README help
 * blocks are generated from it. Change a command here first.
 */

export type CliOption = {
  /** Commander flags, e.g. "-c, --context <slug>". */
  flags: string;
  description: string;
  defaultValue?: string;
};

export type CliArgument = {
  /** "<name>", "[name]", "<names...>". */
  name: string;
  description?: string;
};

export type CliCommand = {
  /** Space separated for subcommands: "context create". */
  name: string;
  description: string;
  args: CliArgument[];
  options: CliOption[];
  /** Overrides the usage line in --help. */
  usage?: string;
  examples?: string[];
  /** The default subcommand of its parent. */
  isDefault?: boolean;
};

export const CLI_CONTEXT_OPTION: CliOption = {
  flags: "-c, --context <slug>",
  description: "Context to use (default: the server token's context, then project.json, then development)",
};

export const CLI_API_OPTION: CliOption = { flags: "--api-url <url>", description: "API base URL" };

export const CLI_YES_OPTION: CliOption = { flags: "--yes", description: "Do not ask for confirmation" };

/** The MCP client config for `npx getmyenv mcp`, as one line of JSON. */
export const CLI_MCP_CLIENT_CONFIG = JSON.stringify({
  mcpServers: { getmyenv: { command: "npx", args: ["-y", "getmyenv", "mcp"] } },
});

/** The tools `npx getmyenv mcp` offers, in tools/list order. Docs list them from here. */
export const CLI_MCP_TOOLS = [
  "status",
  "list_contexts",
  "declare_variables",
  "create_guest_project",
  "create_context",
  "explain_run",
  "ask_human_for_values",
] as const;

export type CliMcpTool = (typeof CLI_MCP_TOOLS)[number];

export const CLI_DESCRIPTION ="Keep using environment variables. Stop managing them as files.";

/** On the root and on every command. */
export const CLI_GLOBAL_OPTIONS: CliOption[] = [
  { flags: "-V, --version", description: "Print the version" },
  CLI_API_OPTION,
  { flags: "-h, --help", description: "Show help" },
];

export const CLI_COMMANDS: CliCommand[] = [
  {
    name: "start",
    description: "Set up this folder (same as bare npx getmyenv). Status when already linked.",
    args: [],
    options: [{ flags: "--template <id>", description: "Add a template's variables and ask for their values (id or link)" }],
  },
  {
    name: "run",
    description: "Run a command with a context's variables in its environment",
    usage: "[context] [options] -- <command...>",
    args: [{ name: "[context]", description: "Context slug (same as -c)" }],
    options: [
      CLI_CONTEXT_OPTION,
      { flags: "--explain", description: "List each variable and where its value comes from (names only)" },
      { flags: "--keep-existing", description: "Keep variables already set in the parent environment" },
      { flags: "--allow-missing", description: "Run even when some variables have no value in this context" },
      {
        flags: "--allow-unsafe-env",
        description:
          "Run even when the context sets NODE_OPTIONS, PATH, LD_PRELOAD, GIT_*, *_PROXY or similar. The list is best effort",
      },
    ],
    examples: [
      "npx getmyenv run -- npm run dev",
      "npx getmyenv run staging -- node server.js",
      "npx getmyenv run staging --explain -- npm start",
      "npx getmyenv run --explain staging",
      "GETMYENV_TOKEN=<server token> npx getmyenv run production -- node server.js",
    ],
  },
  {
    name: "status",
    description: "Show project, token, contexts and the run command",
    args: [],
    options: [],
  },
  {
    name: "context",
    description: "List, create or pick contexts",
    args: [],
    options: [],
  },
  {
    name: "context list",
    description: "List contexts (* marks this folder's default)",
    args: [],
    options: [],
    isDefault: true,
  },
  {
    name: "context create",
    description: 'Create an open context, e.g. context create "Customer Acme"',
    args: [{ name: "<name>" }],
    options: [
      { flags: "--from <slug>", description: "Copy values from an open context" },
      { flags: "--use", description: "Make it this folder's default" },
    ],
  },
  {
    name: "context use",
    description: "Set this folder's default context (saved in project.json)",
    args: [{ name: "<slug>" }],
    options: [],
  },
  {
    name: "set",
    description: "Set values: set KEY=VALUE, set KEY to be prompted, or set --missing",
    args: [{ name: "[pairs...]", description: "KEY, KEY=VALUE, or KEY= to declare a name with no value" }],
    options: [
      CLI_CONTEXT_OPTION,
      { flags: "--expires <date>", description: "Expiry date, e.g. 2026-12-31, or never" },
      { flags: "--stdin", description: "Read the value of one KEY from stdin (keeps it out of argv)" },
      { flags: "--missing", description: "Ask (hidden) for every variable with no value in the context" },
    ],
    examples: [
      "npx getmyenv set API_KEY",
      "npx getmyenv set LOG_LEVEL=debug",
      "npx getmyenv set STRIPE_SECRET_KEY= DATABASE_URL=",
      "npx getmyenv set --missing",
    ],
  },
  {
    name: "unset",
    description: "Remove values from a context",
    args: [{ name: "<names...>", description: "Variable names" }],
    options: [CLI_CONTEXT_OPTION, { flags: "--all", description: "Delete the variable from every context" }],
  },
  {
    name: "ls",
    description: "Variable names by context with status (never values)",
    args: [],
    options: [CLI_CONTEXT_OPTION],
  },
  {
    name: "import",
    description: "Encrypt a .env file and upload it (.env.<slug> goes to that context)",
    args: [{ name: "[file]", description: "Env file (default: .env files in this folder)" }],
    options: [
      CLI_CONTEXT_OPTION,
      { flags: "--prune", description: "Unset values in the context that are not in the file" },
      { flags: "--dry-run", description: "Show what would change without uploading" },
      CLI_YES_OPTION,
    ],
  },
  {
    name: "export",
    description: "Write a context to a plaintext .env file, for tools that need one",
    args: [],
    options: [
      CLI_CONTEXT_OPTION,
      { flags: "-o, --output <file>", description: "Output file", defaultValue: ".env" },
      { flags: "--stdout", description: "Write to stdout instead of a file" },
      { flags: "--yes", description: "Change an existing file without asking" },
    ],
  },
  {
    name: "push",
    description: "Copy a context to Vercel or Netlify with your platform token (VERCEL_TOKEN, NETLIFY_AUTH_TOKEN)",
    args: [{ name: "<provider>", description: "vercel or netlify" }],
    options: [
      CLI_CONTEXT_OPTION,
      { flags: "--project <id>", description: "Vercel project id or name (default: .vercel/project.json)" },
      { flags: "--team <id>", description: "Vercel team id (default: .vercel/project.json)" },
      { flags: "--site <id>", description: "Netlify site id (default: .netlify/state.json)" },
      {
        flags: "--target <env>",
        description: "Vercel: production, preview or development. Netlify: production, deploy-preview, branch-deploy or dev",
        defaultValue: "production",
      },
      { flags: "--prune", description: "Also remove variables from this target that are not in the context" },
      { flags: "--dry-run", description: "Show what would change (names and types only) without writing" },
      CLI_YES_OPTION,
    ],
    examples: [
      "npx getmyenv push vercel -c production --dry-run",
      "VERCEL_TOKEN=<token> npx getmyenv push vercel -c production",
      "NETLIFY_AUTH_TOKEN=<token> npx getmyenv push netlify -c production",
    ],
  },
  {
    name: "guest",
    description: `Create a guest project without an account. ${FACTS.guestShort}`,
    args: [],
    options: [{ flags: "--name <name>", description: "Project name (default: folder name)" }],
  },
  {
    name: "claim",
    description: "Claim a guest project (reads .getmyenv/claim.json, or asks for the claim code)",
    args: [],
    options: [],
  },
  {
    name: "backup",
    description: "Write an encrypted backup of open contexts",
    args: [],
    options: [{ flags: "-o, --output <file>", description: "Output file (default: <project>.getmyenv-backup)" }],
  },
  {
    name: "restore",
    description: "Restore a backup into this folder's project (open contexts with the same slug)",
    args: [{ name: "<file>" }],
    options: [{ flags: "--dry-run", description: "Check the backup and show what would be restored" }, CLI_YES_OPTION],
  },
  {
    name: "lock",
    description: "Forget every unlocked context key on this machine (OS keychain)",
    args: [],
    options: [],
  },
  {
    name: "unlink",
    description: "Revoke this folder's token and remove local .getmyenv files",
    args: [],
    options: [
      CLI_YES_OPTION,
      {
        flags: "--local",
        description: "Remove the local files without revoking the token (it keeps working until it expires)",
      },
    ],
  },
  {
    name: "mcp",
    description: "Start a local MCP server on stdio for AI agents. Names and status only, never values",
    args: [],
    options: [],
    examples: [
      "npx getmyenv mcp",
      "MCP client config:",
      `  ${CLI_MCP_CLIENT_CONFIG}`,
    ],
  },
  {
    name: "help",
    description: "Show help for a command (same as <command> --help)",
    args: [{ name: "[command]" }],
    options: [],
  },
];

export type CliEnvVar = { name: string; description: string };

export const CLI_ENV_VARS: CliEnvVar[] = [
  {
    name: "GETMYENV_TOKEN",
    description: "Token for CI and servers (instead of .getmyenv/token.json). A server token holds its context key.",
  },
  { name: "GETMYENV_API_URL", description: "API base URL (https, or http://localhost)" },
  { name: "GETMYENV_CONFIG_DIR", description: "Machine identity and cache dir (default ~/.config/getmyenv)" },
  { name: "GETMYENV_SKIP_UPDATE", description: "Set to 1 to skip the update notice" },
  { name: "GETMYENV_KEYCHAIN", description: "Set to 0 to always ask for the Vault password" },
  { name: "GETMYENV_MACHINE_LABEL", description: "Name shown for this machine in access requests" },
  { name: "GETMYENV_PUSH_API_URL", description: "Vercel or Netlify API base URL, for tests (https, or http://localhost)" },
];

export function cliCommand(name: string): CliCommand {
  const found = CLI_COMMANDS.find((c) => c.name === name);
  if (!found) throw new Error(`Unknown CLI command in spec: ${name}`);
  return found;
}

/** "npx getmyenv context create <name>". */
export function cliSignature(command: CliCommand): string {
  return ["npx getmyenv", command.name, ...(command.usage ? [command.usage] : command.args.map((a) => a.name))].join(" ");
}

/** Long flag names a command accepts, including the global ones: "--context", "-c". */
export function cliFlagNames(command: CliCommand | undefined): Set<string> {
  const names = new Set<string>();
  for (const o of [...(command?.options ?? []), ...CLI_GLOBAL_OPTIONS]) {
    for (const part of o.flags.split(/[ ,]+/)) if (part.startsWith("-")) names.add(part);
  }
  return names;
}

function optionLines(options: CliOption[], indent: string): string[] {
  const width = Math.max(0, ...options.map((o) => o.flags.length)) + 2;
  return options.map((o) => {
    const def = o.defaultValue ? ` (default: ${o.defaultValue})` : "";
    return `${indent}${o.flags.padEnd(width)}${o.description}${def}`;
  });
}

/** Every command with its flags, as plain text for the docs and llms-full.txt. */
export function cliReferenceText(): string {
  const blocks = CLI_COMMANDS.filter((c) => c.name !== "context").map((c) =>
    [cliSignature(c), `  ${c.description}`, ...optionLines(c.options, "    ")].join("\n")
  );
  const global = ["Every command", ...optionLines(CLI_GLOBAL_OPTIONS, "    ")].join("\n");
  return [...blocks, global].join("\n\n");
}

/** Environment variables as plain text for the docs and llms-full.txt. */
export function cliEnvText(): string {
  return optionLines(
    CLI_ENV_VARS.map((v) => ({ flags: v.name, description: v.description })),
    ""
  ).join("\n");
}

/** The "Environment:" block after the root --help. */
export function cliEnvHelp(): string {
  const width = Math.max(...CLI_ENV_VARS.map((v) => v.name.length)) + 2;
  return ["", "Environment:", ...CLI_ENV_VARS.map((v) => `  ${v.name.padEnd(width)}${v.description}`)].join("\n");
}
