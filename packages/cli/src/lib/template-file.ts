import fs from "node:fs";
import path from "node:path";
import { pcErr as pc } from "./colors.js";
import {
  mergeTemplateFile,
  templateFileSchema,
  TEMPLATE_FILE,
  TEMPLATE_FILE_MAX_KEYS,
  type TemplateFile,
} from "@getmyenv/shared";
import type { Linked } from "./bootstrap.js";
import { getLocalDir } from "./fs.js";

/**
 * `.getmyenv/template.json`, committed: the project's variable names, never
 * values. The CLI keeps it up to date. A fresh clone can start a new project
 * from it.
 */

export type TemplateFileRead = { ok: true; file: TemplateFile } | { ok: false; reason: string };

export function templateFilePath(cwd = process.cwd()): string {
  return path.join(getLocalDir(cwd), "template.json");
}

/** Null when there is no file. A file that cannot be read or parsed says why. */
export function readTemplateFile(cwd = process.cwd()): TemplateFileRead | null {
  const file = templateFilePath(cwd);
  let stat: fs.Stats;
  try {
    stat = fs.lstatSync(file);
  } catch {
    return null;
  }
  if (!stat.isFile()) return { ok: false, reason: "not a regular file" };
  let raw: unknown;
  try {
    raw = JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return { ok: false, reason: "not JSON" };
  }
  const parsed = templateFileSchema.safeParse(raw);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const where = issue?.path.length ? `${issue.path.join(".")}: ` : "";
    return { ok: false, reason: `${where}${issue?.message ?? "invalid"}` };
  }
  return { ok: true, file: parsed.data };
}

export function serializeTemplateFile(file: TemplateFile): string {
  return `${JSON.stringify(file, null, 2)}\n`;
}

/**
 * Bring the file in line with the project's names. Writes only when the names
 * change. Never overwrites a file it cannot read, so hand edits are not lost,
 * and says so every time it skips.
 */
export function syncTemplateFile(
  names: readonly string[],
  projectName: string,
  cwd = process.cwd()
): "written" | "unchanged" | "skipped" {
  const unique = [...new Set(names)];
  if (unique.length > TEMPLATE_FILE_MAX_KEYS) {
    console.error(
      pc.yellow(
        `${TEMPLATE_FILE} not updated. The project has ${unique.length} names, the file holds ${TEMPLATE_FILE_MAX_KEYS}. It may not match the project.`
      )
    );
    return "skipped";
  }
  const current = readTemplateFile(cwd);
  if (current && !current.ok) {
    console.error(pc.yellow(`${TEMPLATE_FILE} is not valid (${current.reason}). Not updated.`));
    return "skipped";
  }
  if (!current && unique.length === 0) return "unchanged";

  const merged = mergeTemplateFile(current?.file ?? null, unique, projectName);
  if (current && serializeTemplateFile(current.file) === serializeTemplateFile(merged)) return "unchanged";

  const file = templateFilePath(cwd);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, serializeTemplateFile(merged));
  return "written";
}

/** CI and servers must not change the working tree. */
export function mayWriteTemplateFile(linked: Pick<Linked, "who">): boolean {
  return linked.who.token.kind !== "server" && !process.env.GETMYENV_TOKEN?.trim();
}

/**
 * Sync from the key list a command already has, plus what it just added or
 * removed. No extra request. A failure here never fails the command.
 */
export function syncFromLinked(
  linked: Pick<Linked, "who">,
  change: { added?: readonly string[]; removed?: readonly string[] } = {}
): void {
  if (!mayWriteTemplateFile(linked)) return;
  const removed = new Set(change.removed ?? []);
  const names = [...linked.who.keys.map((k) => k.name), ...(change.added ?? [])].filter((n) => !removed.has(n));
  try {
    syncTemplateFile(names, linked.who.project.name);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(pc.yellow(`${TEMPLATE_FILE} not updated: ${msg}`));
  }
}
