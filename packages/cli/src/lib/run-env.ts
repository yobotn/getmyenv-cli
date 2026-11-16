/**
 * Pure pieces of `getmyenv run`. Merge, validate and explain live in
 * @getmyenv/shared so the homepage demo prints the same text.
 */
import fs from "node:fs";
import path from "node:path";
import { isValidVariableName } from "@getmyenv/shared";

export { explainLines, mergeEnv, runContextLabel, validationError, type MissingKey } from "@getmyenv/shared";

/** Names from the server go into an environment or a file. Refuse any that are not variable names. */
export function assertVariableNames(names: Iterable<string>): void {
  for (const name of names) {
    if (!isValidVariableName(name)) {
      throw new Error("The server sent a name that is not a valid variable name. Nothing was run or written.");
    }
  }
}

/** Characters cmd.exe treats as special. Each one gets a ^ in front, outside or inside quotes. */
const CMD_META = /([()\][%!^"`<>&|;, *?])/g;
/** Args made only of these go through as they are. */
const PLAIN_ARG = /^[\w\-.:/\\+@]+$/;

/**
 * One argument for a Windows program: quoted by the MSVCRT rules (backslashes
 * before a quote or the end are doubled, inner quotes become \"), then every
 * cmd.exe metacharacter, quotes included, is escaped with ^ so cmd passes the
 * text through untouched and never expands %VAR%. A .cmd or .bat file reads
 * its arguments through cmd a second time, so those get a second ^.
 */
export function windowsArgument(arg: string, batch = false): string {
  if (arg !== "" && PLAIN_ARG.test(arg)) return arg;
  const quoted = `"${msvcrtEscape(arg)}"`.replace(CMD_META, "^$1");
  return batch ? quoted.replace(CMD_META, "^$1") : quoted;
}

/**
 * MSVCRT escaping inside double quotes: backslashes before a quote are doubled
 * and the quote becomes \", backslashes at the end are doubled, others stay.
 * One pass; the regex form /(\\*)"/g is quadratic on long runs of backslashes.
 */
function msvcrtEscape(arg: string): string {
  let out = "";
  let backslashes = 0;
  for (const ch of arg) {
    if (ch === "\\") {
      backslashes++;
      continue;
    }
    out += ch === '"' ? "\\".repeat(backslashes * 2 + 1) + '"' : "\\".repeat(backslashes) + ch;
    backslashes = 0;
  }
  return out + "\\".repeat(backslashes * 2);
}

/**
 * One cmd.exe command line from argv. Windows needs the shell to find `npm.cmd`
 * and friends, and Node does not quote args passed alongside `shell: true`.
 * Arguments follow cross-spawn's rules (see `windowsArgument`). The command
 * is quoted when it holds a space, so a path like C:\Program Files works.
 */
export function windowsCommandLine(args: string[], opts: { batch?: boolean } = {}): string {
  const [command = "", ...rest] = args;
  return [windowsCommandName(command), ...rest.map((a) => windowsArgument(a, opts.batch === true))].join(" ");
}

/**
 * The program to start. cmd finds it by its own quote rules, and the program
 * reads its own name from the same text, so a path with spaces is plainly
 * quoted. A % is closed out of the quotes and escaped, so cmd does not expand it.
 */
function windowsCommandName(command: string): string {
  if (PLAIN_ARG.test(command)) return command;
  return `"${command.replace(/"/g, "").replace(/%/g, '"^%"')}"`;
}

function envValue(env: Record<string, string | undefined>, name: string): string | undefined {
  const key = Object.keys(env).find((k) => k.toUpperCase() === name);
  return key ? env[key] : undefined;
}

/**
 * True when cmd.exe would start `command` from a .cmd or .bat file (npm, npx,
 * pnpm and most node_modules/.bin shims). Looks in the current folder, then
 * PATH, with PATHEXT, the way cmd does.
 */
export function isWindowsBatch(
  command: string,
  env: Record<string, string | undefined>,
  cwd = process.cwd()
): boolean {
  if (/\.(cmd|bat)$/i.test(command)) return true;
  if (path.extname(command)) return false;
  const exts = (envValue(env, "PATHEXT") ?? ".COM;.EXE;.BAT;.CMD").split(";").filter(Boolean);
  const hasDir = /[\\/]/.test(command);
  const dirs = hasDir ? [""] : [cwd, ...(envValue(env, "PATH") ?? "").split(";").filter(Boolean)];
  for (const dir of dirs) {
    for (const ext of exts) {
      const file = path.resolve(dir || cwd, `${command}${ext}`);
      try {
        if (fs.statSync(file).isFile()) return /^\.(cmd|bat)$/i.test(ext);
      } catch {
        /* not here */
      }
    }
  }
  return false;
}

/** Exit code for a child that ended by signal: 128 + signal number, like a shell. */
export function signalExitCode(signal: NodeJS.Signals, numbers: Record<string, number>): number {
  const n = numbers[signal];
  return typeof n === "number" ? 128 + n : 1;
}
