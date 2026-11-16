/**
 * Hints printed by the first `run` of a project on this machine. Never in CI,
 * with GETMYENV_TOKEN or a server token, or when stderr is not a terminal.
 * The marker is written once the child has spawned, so a run that fails before
 * that shows the hints again. Marker errors never change what `run` does.
 */
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { FACTS } from "@getmyenv/shared";
import { getConfigDir } from "./fs.js";
import { keychainAccount } from "./keychain.js";

export type HintContext = {
  isTTY: boolean;
  env: NodeJS.ProcessEnv;
  tokenKind: "folder" | "guest" | "server";
};

export function hintsEnabled({ isTTY, env, tokenKind }: HintContext): boolean {
  if (!isTTY || tokenKind === "server" || env.GETMYENV_TOKEN?.trim()) return false;
  const ci = env.CI?.trim().toLowerCase();
  return !ci || ci === "false" || ci === "0";
}

const MANAGERS = new Set(["npm", "pnpm", "yarn", "bun"]);

/** The package.json script a command like `npm start` or `pnpm run dev` starts, if any. */
export function packageScriptName(childArgs: string[]): string | null {
  const [cmd, ...rest] = childArgs;
  if (!cmd) return null;
  const manager = path.basename(cmd).replace(/\.(cmd|exe|ps1)$/i, "").toLowerCase();
  if (!MANAGERS.has(manager)) return null;
  const args = rest.filter((a) => !a.startsWith("-"));
  if (args[0] === "run" || args[0] === "run-script") return args[1] ?? null;
  if (manager === "npm") return args[0] === "start" || args[0] === "test" ? args[0] : null;
  return args[0] ?? null;
}

/** True when that script passes --env-file to node. */
export function scriptUsesEnvFile(childArgs: string[], packageJson: unknown): boolean {
  const name = packageScriptName(childArgs);
  if (!name) return false;
  const scripts = (packageJson as { scripts?: Record<string, unknown> } | null)?.scripts;
  const script = scripts?.[name];
  return typeof script === "string" && /--env-file\b/.test(script);
}

function readPackageJson(cwd: string): unknown {
  try {
    return JSON.parse(fs.readFileSync(path.join(cwd, "package.json"), "utf8"));
  } catch {
    return null;
  }
}

export function hintLines(childArgs: string[], cwd: string): string[] {
  const lines: string[] = [FACTS.runExplainHint];
  if (fs.existsSync(path.join(cwd, ".env"))) lines.push(FACTS.runIgnoresEnvFile);
  if (scriptUsesEnvFile(childArgs, readPackageJson(cwd))) lines.push(FACTS.envFileScripts);
  return lines;
}

/** One marker per server origin and project, in the CLI config dir. */
export function hintMarkerPath(configDir: string, apiUrl: string, projectId: string): string {
  const id = createHash("sha256").update(keychainAccount(apiUrl, projectId)).digest("hex").slice(0, 32);
  return path.join(configDir, "hints", `${id}.json`);
}

export type PendingHints = { lines: string[]; markShown: () => void };

const NONE: PendingHints = { lines: [], markShown: () => undefined };

export function pendingFirstRunHints(
  input: HintContext & {
    apiUrl: string;
    projectId: string;
    childArgs: string[];
    cwd: string;
    configDir?: () => string;
  }
): PendingHints {
  if (!hintsEnabled(input)) return NONE;
  let marker: string | null = null;
  try {
    marker = hintMarkerPath((input.configDir ?? getConfigDir)(), input.apiUrl, input.projectId);
    if (fs.existsSync(marker)) return NONE;
  } catch {
    marker = null;
  }
  return {
    lines: hintLines(input.childArgs, input.cwd),
    markShown: () => {
      if (!marker) return;
      try {
        fs.mkdirSync(path.dirname(marker), { recursive: true, mode: 0o700 });
        fs.writeFileSync(marker, `${JSON.stringify({ shownAt: new Date().toISOString() })}\n`, { mode: 0o600 });
      } catch {
        /* the hints show again next time */
      }
    },
  };
}
