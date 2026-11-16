import { spawn, spawnSync } from "node:child_process";
import os from "node:os";
import { pcErr as pc } from "../lib/colors.js";
import { ensureTokenAndLink } from "../lib/bootstrap.js";
import { resolveContext } from "../lib/context.js";
import { pendingFirstRunHints } from "../lib/first-run.js";
import { readContextValues } from "../lib/read-context.js";
import { FACTS, unsafeEnvError } from "@getmyenv/shared";
import { ApiError } from "../lib/api.js";
import {
  explainLines,
  mergeEnv,
  runContextLabel,
  signalExitCode,
  validationError,
  isWindowsBatch,
  windowsCommandLine,
} from "../lib/run-env.js";

export type RunOpts = {
  context?: string;
  apiUrl?: string;
  explain?: boolean;
  keepExisting?: boolean;
  allowMissing?: boolean;
  allowUnsafeEnv?: boolean;
};

/** Status lines go to stderr so the child's stdout stays clean for pipes. */
const log = (line = "") => console.error(line);

/** An unreachable or silent server stops run before the app starts. Say why. */
async function withRunNeedsServer<T>(work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } catch (err) {
    if (err instanceof ApiError && err.status === 0) {
      throw new ApiError(`${err.message}\n${FACTS.runNeedsServer}`, 0, err.code);
    }
    throw err;
  }
}

/**
 * Stop the child when this process is told to stop. On Windows the child runs
 * under cmd.exe, and killing cmd leaves the app running, so end the whole tree.
 * Best effort: errors are ignored.
 */
function stopChild(pid: number | undefined, sig: NodeJS.Signals, kill: () => void): void {
  if (process.platform === "win32" && pid) {
    try {
      spawnSync("taskkill", ["/pid", String(pid), "/T", "/F"], { stdio: "ignore", windowsHide: true });
      return;
    } catch {
      /* fall back to kill */
    }
  }
  try {
    kill();
  } catch {
    /* already gone */
  }
}

/** Resolve, validate, merge, spawn. */
export async function runCommand(opts: RunOpts, childArgs: string[]): Promise<void> {
  if (childArgs.length === 0 && !opts.explain) {
    throw new Error("Usage: npx getmyenv run [context] -- <command>");
  }

  const { linked, res } = await withRunNeedsServer(async () => {
    const linked = await ensureTokenAndLink({ apiUrl: opts.apiUrl });
    const ctx = resolveContext(linked.who, linked.meta, opts.context);
    return { linked, res: await readContextValues(linked, ctx.slug, "run") };
  });
  const { who } = linked;

  const merged = mergeEnv(process.env, res.values, res.missing, opts.keepExisting === true);
  const label = runContextLabel(res.context);

  if (opts.explain) {
    log(pc.bold(`${who.project.name} / ${label}`));
    for (const line of explainLines(merged, res.context.slug, { allowUnsafeEnv: opts.allowUnsafeEnv })) log(line);
    log();
  }

  const invalid = validationError(merged, res.context.slug, opts.allowMissing === true);
  if (invalid) throw new Error(invalid);
  const unsafe = opts.allowUnsafeEnv ? null : unsafeEnvError(merged.applied, res.context.slug);
  if (unsafe) throw new Error(unsafe);

  if (childArgs.length === 0) return;

  if (!opts.explain) {
    log(
      `${pc.green("✓")} ${who.project.name} / ${label}: ${merged.applied.length} variable${merged.applied.length === 1 ? "" : "s"}`
    );
  }
  if (merged.ignored.length > 0) {
    log(pc.yellow(`Not passed: ${merged.ignored.join(", ")}. GETMYENV_* names are the CLI's own settings.`));
  }
  if (merged.overridden.length > 0) {
    log(pc.yellow(`Replaced from parent env: ${merged.overridden.join(", ")}`));
  }
  if (merged.kept.length > 0 && !opts.explain) {
    log(pc.dim(`Kept from parent env: ${merged.kept.join(", ")}`));
  }
  if (merged.unresolved.length > 0) {
    log(pc.yellow(`Not set: ${merged.unresolved.map((m) => m.name).join(", ")}`));
  }
  const hints = opts.explain
    ? { lines: [], markShown: () => undefined }
    : pendingFirstRunHints({
        isTTY: Boolean(process.stderr.isTTY),
        env: process.env,
        tokenKind: who.token.kind,
        apiUrl: linked.apiUrl,
        projectId: who.project.id,
        childArgs,
        cwd: process.cwd(),
      });
  for (const line of hints.lines) log(pc.dim(line));

  const [cmd, ...args] = childArgs;
  const child =
    process.platform === "win32"
      ? spawn(windowsCommandLine(childArgs, { batch: isWindowsBatch(cmd!, merged.env) }), {
          env: merged.env,
          stdio: "inherit",
          shell: true,
        })
      : spawn(cmd!, args, { env: merged.env, stdio: "inherit" });
  // Ctrl+C already reaches the child through the terminal. Only wait for it.
  process.on("SIGINT", () => undefined);
  // SIGTERM / SIGHUP (and SIGBREAK on Windows) are sent to this process only. Pass them on.
  const stops: NodeJS.Signals[] = process.platform === "win32" ? ["SIGTERM", "SIGHUP", "SIGBREAK"] : ["SIGTERM", "SIGHUP"];
  for (const sig of stops) {
    process.on(sig, () => {
      if (child.exitCode === null && child.signalCode === null) stopChild(child.pid, sig, () => child.kill(sig));
    });
  }
  child.once("spawn", hints.markShown);
  const code = await new Promise<number>((resolve) => {
    child.on("error", (err) => {
      log(pc.red(`Could not start ${cmd}: ${err.message}`));
      resolve(127);
    });
    child.on("exit", (c, signal) =>
      resolve(c ?? (signal ? signalExitCode(signal, os.constants.signals) : 0))
    );
  });
  process.exit(code);
}
