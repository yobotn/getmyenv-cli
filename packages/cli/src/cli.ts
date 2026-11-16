import { Command } from "commander";
import {
  CLI_API_OPTION,
  CLI_DESCRIPTION,
  CLI_GLOBAL_OPTIONS,
  type CliCommand,
  cliCommand,
  cliEnvHelp,
  formatCliError,
} from "@getmyenv/shared";
import { backupCommand } from "./commands/backup.js";
import { claimCommand } from "./commands/claim.js";
import {
  contextCreateCommand,
  contextListCommand,
  contextUseCommand,
} from "./commands/context.js";
import { exportCommand } from "./commands/export.js";
import { guestCommand } from "./commands/guest.js";
import { importCommand } from "./commands/import.js";
import { pushCommand } from "./commands/push.js";
import { lockCommand } from "./commands/lock.js";
import { lsCommand } from "./commands/ls.js";
import { mcpCommand } from "./commands/mcp.js";
import { restoreCommand } from "./commands/restore.js";
import { runCommand } from "./commands/run.js";
import { setCommand, unsetCommand } from "./commands/set.js";
import { startCommand } from "./commands/start.js";
import { statusCommand } from "./commands/status.js";
import { unlinkCommand } from "./commands/unlink.js";
import { CLI_VERSION } from "./lib/api.js";

/**
 * Split `run` operands around `--`.
 * `run staging -- npm start`: context staging, command npm start.
 * `run -- npm start`: default context.
 * `run npm start` (no `--`): the whole thing is the command.
 */
export function splitRunArgs(
  operands: string[],
  argv: string[],
  explain: boolean
): { context?: string; command: string[] } {
  const dash = argv.indexOf("--");
  if (dash >= 0) {
    const command = argv.slice(dash + 1);
    const before = operands.slice(0, Math.max(0, operands.length - command.length));
    return { context: before[0], command };
  }
  if (explain && operands.length <= 1) return { context: operands[0], command: [] };
  return { command: operands };
}

/** Each flag name of an option ("-c, --context <slug>"), and whether it takes a value. */
function flagNames(flags: string): { names: string[]; takesValue: boolean } {
  return {
    names: flags.split(/[ ,|]+/).filter((f) => f.startsWith("-")),
    takesValue: /[<[]/.test(flags),
  };
}

/**
 * `run` lets unknown options through for the child command. Before `--` (or,
 * without `--`, before the first command word), an unknown option is a typo:
 * `run --explian -- echo hi` must not make "--explian" the context.
 * Returns the first unknown option, or null.
 */
export function unknownRunOption(argv: string[]): string | null {
  const start = argv.indexOf("run", 2);
  if (start < 0) return null;
  const options = [...cliCommand("run").options, CLI_API_OPTION, ...CLI_GLOBAL_OPTIONS].map((o) => flagNames(o.flags));
  const known = new Map<string, boolean>();
  for (const o of options) for (const n of o.names) known.set(n, o.takesValue);
  const hasDash = argv.indexOf("--", start + 1) >= 0;
  for (let i = start + 1; i < argv.length; i++) {
    const arg = argv[i]!;
    if (arg === "--") break;
    if (!arg.startsWith("-") || arg === "-") {
      // Without `--`, the first plain word starts the command and its own flags.
      if (!hasDash) break;
      continue;
    }
    // `-cstaging`: a short flag with its value attached.
    if (!arg.startsWith("--") && arg.length > 2 && known.get(arg.slice(0, 2)) === true) continue;
    const eq = arg.indexOf("=");
    const name = eq > 0 ? arg.slice(0, eq) : arg;
    const takesValue = known.get(name);
    if (takesValue === undefined) return name;
    if (takesValue && eq < 0) i++;
  }
  return null;
}

/** A command, its arguments, flags and examples, all from the shared CLI spec. */
function define(parent: Command, name: string, withApi = true): Command {
  const spec: CliCommand = cliCommand(name);
  const leaf = spec.name.split(" ").at(-1)!;
  const cmd = parent.command(leaf, spec.isDefault ? { isDefault: true } : {}).description(spec.description);
  for (const a of spec.args) cmd.argument(a.name, a.description ?? "");
  for (const o of spec.options) cmd.option(o.flags, o.description, o.defaultValue);
  if (withApi) cmd.option(CLI_API_OPTION.flags, CLI_API_OPTION.description);
  if (spec.usage) cmd.usage(spec.usage);
  cmd.showHelpAfterError(`See: npx getmyenv ${spec.name} --help`);
  if (spec.examples) {
    cmd.addHelpText("after", ["", "Examples:", ...spec.examples.map((e) => `  ${e}`)].join("\n"));
  }
  return cmd;
}

export function buildProgram(argv: string[]): Command {
  const program = new Command();
  const globalOption = (flags: string) => CLI_GLOBAL_OPTIONS.find((o) => o.flags === flags)!;
  const help = cliCommand("help");
  // Set before any subcommand exists: commander copies these settings to each one.
  program
    .configureOutput({ outputError: (str, write) => write(formatCliError(str.replace(/^error: /, ""))) })
    .showHelpAfterError("See: npx getmyenv --help")
    .helpOption("-h, --help", globalOption("-h, --help").description)
    .helpCommand(`help ${help.args.map((a) => a.name).join(" ")}`, help.description);
  program
    .name("getmyenv")
    .description(CLI_DESCRIPTION)
    .version(CLI_VERSION, "-V, --version", globalOption("-V, --version").description)
    .option(CLI_API_OPTION.flags, CLI_API_OPTION.description)
    .addHelpText("after", cliEnvHelp())
    .action((opts) => startCommand(opts));

  // The root owns --api-url wherever it appears, so hand it to the command that runs.
  program.hook("preAction", (_root, actionCommand) => {
    const apiUrl = program.opts().apiUrl as string | undefined;
    if (apiUrl && actionCommand !== program && !actionCommand.opts().apiUrl) {
      actionCommand.setOptionValue("apiUrl", apiUrl);
    }
  });

  define(program, "start").action((opts) => startCommand(opts));

  define(program, "run")
    .allowUnknownOption(true)
    .allowExcessArguments(true)
    .action(async (_ctx: string | undefined, opts, cmd: Command) => {
      const unknown = unknownRunOption(argv);
      if (unknown) throw new Error(`Unknown option ${unknown}. See: npx getmyenv run --help`);
      const split = splitRunArgs(cmd.args, argv, opts.explain === true);
      if (opts.context && split.context && opts.context !== split.context) {
        throw new Error(`Two contexts given: ${split.context} and -c ${opts.context}. Pick one.`);
      }
      await runCommand({ ...opts, context: opts.context ?? split.context }, split.command);
    });

  define(program, "status").action((opts) => statusCommand(opts));

  const context = define(program, "context", false);
  define(context, "context list").action((opts) => contextListCommand(opts));
  define(context, "context create").action((name: string, opts) => contextCreateCommand(name, opts));
  define(context, "context use").action((slug: string, opts) => contextUseCommand(slug, opts));

  define(program, "set").action((pairs: string[], opts) => setCommand(pairs, opts));
  define(program, "unset").action((names: string[], opts) => unsetCommand(names, opts));
  define(program, "ls").action((opts) => lsCommand(opts));
  define(program, "import").action((file: string | undefined, opts) => importCommand(file, opts));
  define(program, "export").action((opts) => exportCommand(opts));
  define(program, "push").action((provider: string, opts) => pushCommand(provider, opts));
  define(program, "guest").action((opts) => guestCommand(opts));
  define(program, "claim").action((opts) => claimCommand(opts));
  define(program, "backup").action((opts) => backupCommand(opts));
  define(program, "restore").action((file: string, opts) => restoreCommand(file, opts));
  define(program, "lock").action((opts) => lockCommand(opts));
  define(program, "unlink").action((opts) => unlinkCommand(opts));
  define(program, "mcp").action((opts) => mcpCommand(opts));
  return program;
}

export async function runCli(argv: string[]): Promise<void> {
  const program = buildProgram(argv);
  const first = argv[2];
  if (
    first &&
    !first.startsWith("-") &&
    first !== "help" &&
    !program.commands.some((c) => c.name() === first || c.aliases().includes(first))
  ) {
    throw new Error(`Unknown command "${first}". See: npx getmyenv --help`);
  }

  await program.parseAsync(argv);
}
