import { spawn } from "node:child_process";
import { pcErr as pc } from "./colors.js";
import {
  ensureGitignoreHasEnv,
  promptHidden,
  readProjectMeta,
  writeProjectMeta,
} from "./fs.js";
import { writeFolderToken } from "./credentials.js";
import { ApiClient, ApiError, parseSafeUrl, resolveApiUrl, type WhoamiResponse } from "./api.js";

/** Command + argv to open a URL. No shell, so the URL is never parsed as a command. */
export function browserCommand(
  raw: string,
  platform: NodeJS.Platform = process.platform
): { cmd: string; args: string[] } | null {
  const url = parseSafeUrl(raw);
  if (!url) return null;
  const href = url.href;
  if (platform === "win32") {
    return { cmd: "rundll32.exe", args: ["url.dll,FileProtocolHandler", href] };
  }
  if (platform === "darwin") return { cmd: "open", args: [href] };
  return { cmd: "xdg-open", args: [href] };
}

export function openBrowser(url: string): void {
  const command = browserCommand(url);
  if (!command) return;
  try {
    const child = spawn(command.cmd, command.args, {
      stdio: "ignore",
      detached: true,
      windowsHide: true,
    });
    child.on("error", () => undefined);
    child.unref();
  } catch {
    /* the URL is printed too; opening is best effort */
  }
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Browser sign-in is missing (404) or broken (5xx) on this server: paste a token instead.
 * An old CLI (426), rate limit (429) or unreachable server (status 0) would fail the paste too.
 */
export function browserSignInFallsBack(err: unknown): boolean {
  return err instanceof ApiError && (err.status === 404 || err.status >= 500);
}

/** A poll failure worth retrying: no answer, a timeout, a server error or a rate limit. */
export function isTransientPollError(err: unknown): boolean {
  return err instanceof ApiError && (err.status === 0 || err.status === 429 || err.status >= 500);
}

/** Wait before retry n (1, 2, 3...): 2s, 4s, 8s, then 15s at most. */
export function pollBackoffMs(failures: number): number {
  return Math.min(2000 * 2 ** Math.max(0, failures - 1), 15_000);
}

/**
 * One poll that survives brief failures. Transient errors are retried with
 * backoff until `deadline`; any other error is thrown. Null when time runs out.
 */
export async function pollWithRetry<T>(
  poll: () => Promise<T>,
  deadline: number,
  deps: { wait?: (ms: number) => Promise<void>; now?: () => number } = {}
): Promise<T | null> {
  const wait = deps.wait ?? sleep;
  const now = deps.now ?? Date.now;
  let failures = 0;
  while (now() < deadline) {
    try {
      return await poll();
    } catch (err) {
      if (!isTransientPollError(err)) throw err;
      failures++;
      const left = deadline - now();
      if (left <= 0) break;
      await wait(Math.min(pollBackoffMs(failures), left));
    }
  }
  return null;
}

/**
 * The project this folder already belongs to. Signing in to another one saves nothing,
 * so a committed project.json is never rewritten to a project the user happened to pick.
 */
export type ExpectedProject = {
  id: string;
  name?: string;
  /** The error when the sign-in picked another project. Defaults to `otherProjectMessage`. */
  mismatch?: (picked: string) => string;
};

/**
 * The sign-in page preselects the folder's project only for its members,
 * so another project here usually means the user is not in this one.
 */
export function otherProjectMessage(folderProject: string, picked: string): string {
  return (
    `This folder belongs to ${folderProject}, and you signed in to ${picked}. Nothing was saved. ` +
    `If you are not in ${folderProject}, ask the owner for an invite. ` +
    `To use ${picked} here instead, delete .getmyenv/project.json and run npx getmyenv again.`
  );
}

/** Write token.json + project.json together. Authorize = link. */
async function saveVerifiedToken(
  token: string,
  apiUrl: string,
  expected?: ExpectedProject
): Promise<WhoamiResponse> {
  const client = new ApiClient(apiUrl, token);
  let who: WhoamiResponse;
  try {
    who = await client.request<WhoamiResponse>("GET", "/api/cli/whoami");
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`Could not verify token: ${msg}`);
  }
  if (expected && who.project.id !== expected.id) {
    throw new Error(
      expected.mismatch
        ? expected.mismatch(who.project.name)
        : otherProjectMessage(expected.name ?? expected.id, who.project.name)
    );
  }

  writeFolderToken({ token, apiUrl, projectId: who.project.id });
  const existing = readProjectMeta() ?? {};
  const sameProject = existing.projectId === who.project.id;
  writeProjectMeta({
    ...(sameProject ? existing : {}),
    projectId: who.project.id,
    projectName: who.project.name,
  });
  ensureGitignoreHasEnv();

  console.error(`\n${pc.green("✓")} Signed in. Project: ${pc.bold(who.project.name)}\n`);
  return who;
}

async function authorizeViaPaste(apiUrl: string, expected?: ExpectedProject): Promise<WhoamiResponse> {
  const projectsPage = `${apiUrl.replace(/\/$/, "")}/projects`;
  console.error(pc.dim(`Create a folder token in Project settings, Tokens: ${projectsPage}\n`));
  const token = (await promptHidden("Paste the folder token (hidden): ")).trim();
  if (!token) {
    throw new Error("No token entered.");
  }
  return saveVerifiedToken(token, apiUrl, expected);
}

/** The sign-in page preselects the folder's project, or "New project" with a name. */
export function verifyUrlFor(
  base: string,
  pick: { projectId?: string; newProject?: { name: string } }
): string {
  const params = pick.newProject
    ? `project=new&name=${encodeURIComponent(pick.newProject.name)}`
    : pick.projectId
      ? `project=${encodeURIComponent(pick.projectId)}`
      : "";
  if (!params) return base;
  return `${base}${base.includes("?") ? "&" : "?"}${params}`;
}

async function authorizeViaBrowser(
  apiUrl: string,
  newProject?: { name: string },
  expected?: ExpectedProject
): Promise<WhoamiResponse> {
  const client = new ApiClient(apiUrl);
  type StartRes = {
    sessionId: string;
    pollSecret: string;
    userCode: string;
    verifyUrl: string;
    expiresAt: string;
  };
  let start: StartRes;
  try {
    start = await client.request<StartRes>("POST", "/api/cli-auth/start");
  } catch (err) {
    if (!browserSignInFallsBack(err)) throw err;
    const msg = err instanceof Error ? err.message : String(err);
    console.error(pc.yellow(`Browser sign-in unavailable (${msg}).`));
    console.error(pc.dim("Falling back to paste.\n"));
    return authorizeViaPaste(apiUrl, expected);
  }

  const verifyUrl = verifyUrlFor(start.verifyUrl, {
    projectId: readProjectMeta()?.projectId,
    newProject,
  });
  console.error("Open this URL to sign in and pick a project:\n");
  console.error(`  ${verifyUrl}\n`);
  console.error(`Enter this code on the page: ${pc.bold(start.userCode)}\n`);
  openBrowser(verifyUrl);
  console.error(pc.dim("Opened in your browser. Waiting...\n"));

  const deadline = new Date(start.expiresAt).getTime();
  while (Date.now() < deadline) {
    type PollRes = {
      status: "pending" | "approved" | "denied" | "expired";
      token?: string;
    };
    let poll: PollRes | null;
    try {
      poll = await pollWithRetry(
        () =>
          client.request<PollRes>(
            "GET",
            `/api/cli-auth/poll?sessionId=${encodeURIComponent(start.sessionId)}`,
            undefined,
            { "X-Getmyenv-Poll-Secret": start.pollSecret }
          ),
        deadline
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new Error(`Could not poll sign-in: ${msg}`);
    }
    if (!poll) break;

    if (poll.status === "approved" && poll.token) {
      process.stderr.write("\n");
      return saveVerifiedToken(poll.token, apiUrl, expected);
    }
    if (poll.status === "denied") {
      throw new Error("Sign-in was denied in the browser.");
    }
    if (poll.status === "expired") {
      throw new Error("Sign-in expired. Run the command again.");
    }

    const remaining = Math.max(0, Math.ceil((deadline - Date.now()) / 1000));
    process.stderr.write(
      `\r${pc.dim(`Waiting... ${String(remaining).padStart(2, "0")}s`)}   `
    );
    await sleep(2000);
  }
  process.stderr.write("\n");
  throw new Error("Sign-in timed out. Run the command again.");
}

/**
 * Sign in via the browser and link this folder (writes token.json + project.json).
 * CI uses GETMYENV_TOKEN instead.
 */
export async function authorizeFolder(
  opts: { apiUrl?: string; newProject?: { name: string }; expected?: ExpectedProject } = {}
): Promise<WhoamiResponse> {
  if (!process.stdin.isTTY) {
    throw new Error(
      "No token in this folder. Run in a terminal to sign in, or set GETMYENV_TOKEN to a server token."
    );
  }
  return authorizeViaBrowser(resolveApiUrl(opts.apiUrl), opts.newProject, opts.expected);
}
