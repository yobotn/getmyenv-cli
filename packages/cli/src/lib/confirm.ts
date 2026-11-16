import { plural } from "@getmyenv/shared";
import { pcErr as pc } from "./colors.js";
import { promptConfirm } from "./fs.js";

export type ConflictItem = {
  name: string;
  /** Short human detail, e.g. "local differs from remote". */
  detail?: string;
};

function printItems(title: string, items: ConflictItem[]): void {
  if (items.length === 0) return;
  console.error(pc.yellow(`\n${title}:`));
  for (const c of items.slice(0, 20)) {
    console.error(`  ${c.name}${c.detail ? pc.dim(` - ${c.detail}`) : ""}`);
  }
  if (items.length > 20) {
    console.error(pc.dim(`  …and ${items.length - 20} more`));
  }
}

/**
 * Prompt only when something would be lost. Returns true to proceed.
 * `conflicts` are names whose value changes, `removed` names that go away.
 * Each list is counted on its own. Non-TTY: requires `yes`.
 */
export async function confirmDiff(opts: {
  conflicts: ConflictItem[];
  removed?: ConflictItem[];
  /** Heading after the count of `removed`. */
  removedLabel?: string;
  /** What will happen if the user confirms, e.g. "Overwrite local values". */
  action: string;
  /** Skip the prompt when true. */
  yes?: boolean;
}): Promise<boolean> {
  const { conflicts, action, yes } = opts;
  const removed = opts.removed ?? [];
  if (conflicts.length === 0 && removed.length === 0) return true;

  printItems(plural(conflicts.length, "conflict"), conflicts);
  printItems(`${plural(removed.length, "name")} ${opts.removedLabel ?? "will be removed"}`, removed);
  console.error("");

  if (yes) return true;

  if (!process.stdin.isTTY) {
    throw new Error(
      `${conflicts.length > 0 ? "Conflicts require" : "Removing them requires"} confirmation. Re-run with --yes to ${action.toLowerCase()}.`
    );
  }

  return promptConfirm(`${action}?`, { defaultYes: false });
}
