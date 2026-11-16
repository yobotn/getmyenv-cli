import fs from "node:fs";
import path from "node:path";
import { pcErr as pc } from "../lib/colors.js";
import {
  DEFAULT_CONTEXT_SLUG,
  FACTS,
  TEMPLATE_FILE,
  type PublicTemplate,
  type TemplateFile,
} from "@getmyenv/shared";
import {
  promptChoice,
  promptConfirm,
  readClaimFile,
  readLine,
  readProjectMeta,
  rootEnvFiles,
  writeProjectMeta,
  type ProjectMeta,
} from "../lib/fs.js";
import { ApiClient, getSessionToken, resolveApiUrl, type WhoamiResponse } from "../lib/api.js";
import { authorizeFolder } from "../lib/authorize.js";
import { notLinkedMessage } from "../lib/bootstrap.js";
import { readTemplateFile } from "../lib/template-file.js";
import { createGuestProject, folderNameHint } from "./guest.js";
import { statusCommand } from "./status.js";
import { applyTemplate, applyTemplateFile, fetchTemplate, printTemplate } from "./template.js";

/** Best guess at the app's start command, for the printed `run` line. */
export function suggestedStartCommand(cwd = process.cwd()): string {
  const pkgFile = path.join(cwd, "package.json");
  if (fs.existsSync(pkgFile)) {
    try {
      const pkg = JSON.parse(fs.readFileSync(pkgFile, "utf8")) as {
        scripts?: Record<string, string>;
      };
      if (pkg.scripts?.dev) return "npm run dev";
      if (pkg.scripts?.start) return "npm start";
    } catch {
      /* ignore */
    }
    return "node index.js";
  }
  if (fs.existsSync(path.join(cwd, "manage.py"))) return "python manage.py runserver";
  if (fs.existsSync(path.join(cwd, "go.mod"))) return "go run .";
  if (fs.existsSync(path.join(cwd, "Cargo.toml"))) return "cargo run";
  return "<your start command>";
}

export function runLine(context: string | null, cwd = process.cwd(), startCommand?: string | null): string {
  const ctx = context && context !== DEFAULT_CONTEXT_SLUG ? ` ${context}` : "";
  return `npx getmyenv run${ctx} -- ${startCommand || suggestedStartCommand(cwd)}`;
}

async function nameFirstContext(apiUrl: string): Promise<string> {
  const answer = (
    await readLine(`Name your first context ${pc.dim("[Development]")}: `)
  ).trim();
  if (!answer || answer.toLowerCase() === "development") return DEFAULT_CONTEXT_SLUG;
  const token = getSessionToken();
  const created = await new ApiClient(apiUrl, token).request<{ slug: string; name: string }>(
    "POST",
    "/api/cli/contexts",
    { name: answer }
  );
  console.error(`${pc.green("✓")} Context ${pc.bold(created.name)} (${created.slug})`);
  return created.slug;
}

/** A project that already has keys or its own contexts is set up. Do not ask for a first context. */
function isFreshProject(who: WhoamiResponse): boolean {
  if (who.token.member || who.keys.length > 0) return false;
  return who.contexts.every((c) => c.slug === DEFAULT_CONTEXT_SLUG || c.protection === "locked");
}

function defaultContextFor(who: WhoamiResponse): string {
  const open = who.contexts.filter((c) => c.protection === "open");
  return (open.find((c) => c.slug === DEFAULT_CONTEXT_SLUG) ?? open[0])?.slug ?? DEFAULT_CONTEXT_SLUG;
}

/**
 * Guided setup for an unlinked folder, in a terminal.
 * Start without an account, or sign in. Then offer to import a detected .env.
 */
export async function startSetup(opts: {
  apiUrl?: string;
  thenContinue?: boolean;
  template?: PublicTemplate;
}): Promise<void> {
  console.error(pc.bold("\ngetmyenv"));
  console.error(pc.dim("Keep using environment variables. Stop managing them as files.\n"));
  if (opts.template) printTemplate(opts.template);

  const apiUrl = resolveApiUrl(opts.apiUrl);
  const existing = readProjectMeta();

  if (readClaimFile()) {
    throw new Error(
      "This folder has a guest project (claim.json) but no token on this machine. Claim it: npx getmyenv claim"
    );
  }

  const file = opts.template ? null : loadTemplateFile();
  if (file && existing?.projectId) {
    const choices = startChoices(existing, file);
    const pick = await promptChoice("How do you want to start?", choices, 0);
    console.error("");
    if (pick === 1) {
      await startFromTemplateFile(file, { apiUrl, previous: existing, thenContinue: opts.thenContinue });
      return;
    }
  } else if (file) {
    await startFromTemplateFile(file, { apiUrl, thenContinue: opts.thenContinue });
    return;
  }

  if (existing?.projectId) {
    console.error(`This folder uses ${pc.bold(existing.projectName ?? existing.projectId)}. Sign in to get a token.\n`);
    await authorizeFolder({ apiUrl });
    if (opts.template) {
      const { context } = await applyTemplate(opts.template, { apiUrl });
      if (!opts.thenContinue) printRunLine(context, opts.template.startCommand);
    }
    return;
  }

  const choice = await promptChoice(
    "How do you want to start?",
    [`Start without an account (guest project, active while you use it)`, "Sign in"],
    0
  );
  console.error("");

  let context: string = DEFAULT_CONTEXT_SLUG;
  let dashboardUrl: string | null = null;
  if (choice === 0) {
    const name =
      (await readLine(`Project name ${pc.dim(`[${folderNameHint()}]`)}: `)).trim() ||
      folderNameHint();
    await createGuestProject({ name, apiUrl });
  } else {
    const who = await authorizeFolder({ apiUrl });
    context =
      isFreshProject(who) && !opts.template ? await nameFirstContext(apiUrl) : defaultContextFor(who);
    const meta = readProjectMeta();
    if (meta) writeProjectMeta({ ...meta, context });
    dashboardUrl = `${apiUrl.replace(/\/$/, "")}/projects/${who.project.id}/${context}`;
  }

  if (opts.template) {
    const applied = await applyTemplate(opts.template, { apiUrl });
    if (!opts.thenContinue) printRunLine(applied.context, opts.template.startCommand);
    return;
  }

  if (!(await offerEnvImport(apiUrl))) {
    console.error("No .env file in this folder. Add values with:\n");
    console.error(pc.cyan("  npx getmyenv set API_KEY"));
    if (dashboardUrl) console.error(pc.dim(`  or in the dashboard: ${dashboardUrl}`));
    console.error("");
  }

  if (!opts.thenContinue) printRunLine(context);
}

/** Offer to import the .env files in this folder. False when there are none. */
async function offerEnvImport(apiUrl: string): Promise<boolean> {
  const files = rootEnvFiles();
  if (files.length === 0) return false;
  const rel = files.map((f) => path.basename(f)).join(", ");
  const ok = await promptConfirm(`Import ${rel}? Values are encrypted before upload.`, {
    defaultYes: true,
  });
  if (ok) {
    const { importCommand } = await import("./import.js");
    await importCommand(undefined, { apiUrl, yes: true, noRunLine: true });
  }
  return true;
}

/** A template file that cannot be read is reported and not used. */
function loadTemplateFile(): TemplateFile | null {
  const read = readTemplateFile();
  if (!read) return null;
  if (!read.ok) {
    console.error(pc.yellow(`${TEMPLATE_FILE} is not valid (${read.reason}). Setup continues without it.\n`));
    return null;
  }
  return read.file;
}

/** The two ways to start when project.json and template.json both exist. Sign in comes first. */
export function startChoices(existing: ProjectMeta, file: TemplateFile): [string, string] {
  const n = file.keys.length;
  return [
    `Sign in to ${existing.projectName ?? existing.projectId}`,
    `New project from ${TEMPLATE_FILE} (${n} variable${n === 1 ? "" : "s"}). ${FACTS.templateFileNewProject}`,
  ];
}

/**
 * A new project with the names in the template file: guest or sign in, then
 * the .env import offer, then the names are declared and each missing value
 * is asked. project.json changes only once the new project exists.
 */
async function startFromTemplateFile(
  file: TemplateFile,
  opts: { apiUrl: string; previous?: ProjectMeta; thenContinue?: boolean }
): Promise<void> {
  const n = file.keys.length;
  console.error(`${TEMPLATE_FILE} lists ${n} variable${n === 1 ? "" : "s"}. Values are asked after setup.\n`);
  const choice = await promptChoice(
    "How do you want to start?",
    [`Start without an account (guest project, active while you use it)`, "Sign in"],
    0
  );
  console.error("");

  const suggested = file.name ?? folderNameHint();
  let project: { id: string; name: string };
  let fresh: boolean;
  if (choice === 0) {
    const name = (await readLine(`Project name ${pc.dim(`[${suggested}]`)}: `)).trim() || suggested;
    const created = await createGuestProject({
      name,
      apiUrl: opts.apiUrl,
      replaceProjectMeta: Boolean(opts.previous?.projectId),
    });
    project = { id: created.projectId, name: created.projectName };
    fresh = true;
  } else {
    const who = await authorizeFolder({ apiUrl: opts.apiUrl, newProject: { name: suggested } });
    const meta = readProjectMeta();
    if (meta) writeProjectMeta({ ...meta, context: defaultContextFor(who) });
    project = who.project;
    fresh = !who.token.member && who.keys.length === 0;
  }

  const before = opts.previous;
  if (before?.projectId && before.projectId !== project.id) {
    console.error(
      pc.dim(`project.json now points to ${project.name}. It pointed to ${before.projectName ?? before.projectId}.`)
    );
  }
  if (fresh) {
    console.error(
      `New project ${pc.bold(project.name)} with the names from ${TEMPLATE_FILE}. ${FACTS.templateFileNewProject}\n`
    );
  }

  await offerEnvImport(opts.apiUrl);
  const applied = await applyTemplateFile(file, { apiUrl: opts.apiUrl });
  if (!opts.thenContinue) printRunLine(applied.context, file.startCommand);
}

function printRunLine(context: string, startCommand?: string | null): void {
  console.error("Start your app with:\n");
  console.error(pc.cyan(`  ${runLine(context, process.cwd(), startCommand)}\n`));
}

/**
 * Bare `getmyenv`: setup when unlinked (terminal only), status when linked.
 * With --template, add the template's names and ask for their values.
 */
export async function startCommand(opts: { apiUrl?: string; template?: string }): Promise<void> {
  const template = opts.template ? await fetchTemplate(opts.template, opts.apiUrl) : undefined;
  if (template && !process.stdin.isTTY) {
    throw new Error("start --template asks for values. Run it in a terminal.");
  }
  if (getSessionToken()) {
    if (template) {
      printTemplate(template);
      const { context } = await applyTemplate(template, opts);
      printRunLine(context, template.startCommand);
      return;
    }
    await statusCommand(opts);
    return;
  }
  if (!process.stdin.isTTY) {
    // No terminal to set up in: an agent or a script must not read this as success.
    throw new Error(notLinkedMessage());
  }
  await startSetup({ apiUrl: opts.apiUrl, template });
}
