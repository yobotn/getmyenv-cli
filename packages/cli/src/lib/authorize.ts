import { spawn } from "node:child_process";
import { pcErr as pc } from "./colors.js";
import {
  ensureGitignoreHasEnv,
  promptHidden,
  readProjectMeta,
  writeProjectMeta,
} from "./fs.js";
import { writeFolderToken } from "./credentials.js";
import { ApiClient, parseSafeUrl, resolveApiUrl, type WhoamiResponse } from "./api.js";

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

/** Write token.json + project.json together. Authorize = link. */
async function saveVerifiedToken(
  token: string,
  apiUrl: string
): Promise<WhoamiResponse> {
  const client = new ApiClient(apiUrl, token);
  let who: WhoamiResponse;
  try {
    who = await client.request<WhoamiResponse>("GET", "/api/cli/whoami");
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`Could not verify token: ${msg}`);
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

async function authorizeViaPaste(apiUrl: string): Promise<WhoamiResponse> {
  const projectsPage = `${apiUrl.replace(/\/$/, "")}/projects`;
  console.error(pc.dim(`Create a folder token in Project settings, Tokens: ${projectsPage}\n`));
  const token = (await promptHidden("Paste the folder token (hidden): ")).trim();
  if (!token) {
    throw new Error("No token entered.");
  }
  return saveVerifiedToken(token, apiUrl);
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
  newProject?: { name: string }
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
    const msg = err instanceof Error ? err.message : String(err);
    console.error(pc.yellow(`Browser sign-in unavailable (${msg}).`));
    console.error(pc.dim("Falling back to paste.\n"));
    return authorizeViaPaste(apiUrl);
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
    let poll: PollRes;
    try {
      poll = await client.request<PollRes>(
        "GET",
        `/api/cli-auth/poll?sessionId=${encodeURIComponent(start.sessionId)}`,
        undefined,
        { "X-Getmyenv-Poll-Secret": start.pollSecret }
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new Error(`Could not poll sign-in: ${msg}`);
    }

    if (poll.status === "approved" && poll.token) {
      process.stderr.write("\n");
      return saveVerifiedToken(poll.token, apiUrl);
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
  opts: { apiUrl?: string; newProject?: { name: string } } = {}
): Promise<WhoamiResponse> {
  if (!process.stdin.isTTY) {
    throw new Error(
      "No token in this folder. Run in a terminal to sign in, or set GETMYENV_TOKEN to a server token."
    );
  }
  return authorizeViaBrowser(resolveApiUrl(opts.apiUrl), opts.newProject);
}
