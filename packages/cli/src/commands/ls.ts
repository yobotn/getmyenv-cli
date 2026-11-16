import { pc } from "../lib/colors.js";
import type { ValueStatus } from "../lib/api.js";
import { ensureTokenAndLink } from "../lib/bootstrap.js";
import { resolveContext } from "../lib/context.js";
import { syncFromLinked } from "../lib/template-file.js";

const CELL: Record<ValueStatus, string> = {
  set: "set",
  expiring_soon: "expiring",
  expired: "expired",
  missing: "missing",
};

function paint(status: ValueStatus, text: string): string {
  if (status === "set") return pc.green(text);
  if (status === "missing") return pc.dim(text);
  return pc.yellow(text);
}

/** Key names by context with status. Never values. */
export async function lsCommand(opts: { context?: string; apiUrl?: string }): Promise<void> {
  const { who, meta } = await ensureTokenAndLink({ apiUrl: opts.apiUrl, quiet: true });
  syncFromLinked({ who });
  const contexts = opts.context ? [resolveContext(who, meta, opts.context)] : who.contexts;

  if (who.keys.length === 0) {
    console.log(pc.dim("No variables yet. Add one: npx getmyenv set API_KEY"));
    return;
  }

  const nameWidth = Math.max(4, ...who.keys.map((k) => k.name.length));
  const headers = contexts.map((c) => (c.protection === "locked" ? `${c.slug} (Read-only)` : c.slug));
  const widths = headers.map((h) => Math.max(h.length, 8));

  console.log(
    pc.bold(["NAME".padEnd(nameWidth), ...headers.map((h, i) => h.padEnd(widths[i]!))].join("  "))
  );
  for (const k of who.keys) {
    const cells = contexts.map((c, i) => {
      const status = k.status[c.slug] ?? "missing";
      return paint(status, CELL[status].padEnd(widths[i]!));
    });
    console.log([k.name.padEnd(nameWidth), ...cells].join("  "));
  }
}
