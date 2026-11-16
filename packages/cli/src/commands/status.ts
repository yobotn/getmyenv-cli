import { pc } from "../lib/colors.js";
import { NEW_MACHINE_POLICY_LABELS } from "@getmyenv/shared";
import { isDefaultApiUrl } from "../lib/api.js";
import { ensureTokenAndLink } from "../lib/bootstrap.js";
import { defaultContextSlug } from "../lib/context.js";
import { syncFromLinked } from "../lib/template-file.js";
import { runLine } from "./start.js";

const TOKEN_KIND: Record<string, string> = {
  folder: "folder (open contexts, read and write)",
  guest: "guest (Development, read and write)",
  server: "server (one Read-only context)",
};

/** Project, token, contexts with value counts, and the run command. Names only. */
export async function statusCommand(opts: { apiUrl?: string } = {}): Promise<void> {
  const { who, apiUrl, meta } = await ensureTokenAndLink({ apiUrl: opts.apiUrl });
  syncFromLinked({ who });
  const current = defaultContextSlug(who, meta);

  console.log(`${pc.bold(who.project.name)}${who.user ? pc.dim(`  ${who.user.email}`) : ""}`);
  console.log(
    pc.dim(
      who.token.member
        ? "Token: folder, shared project (the contexts the owner shared with you)"
        : `Token: ${TOKEN_KIND[who.token.kind] ?? who.token.kind}`
    )
  );
  if (who.token.kind === "server" && who.token.newMachinePolicy) {
    console.log(pc.dim(`New machines: ${NEW_MACHINE_POLICY_LABELS[who.token.newMachinePolicy]}`));
  }
  if (process.env.GETMYENV_TOKEN?.trim()) console.log(pc.dim("Source: GETMYENV_TOKEN"));
  if (!isDefaultApiUrl(apiUrl)) console.log(pc.dim(`API: ${apiUrl}`));
  console.log("");

  const total = who.keys.length;
  const width = Math.max(...who.contexts.map((c) => c.slug.length), 4);
  console.log(`Contexts (${total} variable${total === 1 ? "" : "s"}):`);
  for (const c of who.contexts) {
    const set = who.keys.filter((k) => {
      const s = k.status[c.slug];
      return s === "set" || s === "expiring_soon";
    }).length;
    const marker = c.slug === current ? pc.green("*") : " ";
    const lock = c.protection === "locked" ? pc.yellow(" Read-only") : "";
    const name = c.name.toLowerCase() === c.slug ? "" : pc.dim(`  ${c.name}`);
    console.log(`  ${marker} ${c.slug.padEnd(width)}  ${set}/${total} set${lock}${name}`);
  }
  console.log("");
  console.log("Run your app:");
  console.log(pc.cyan(`  ${runLine(current)}`));
  console.log("");
}
