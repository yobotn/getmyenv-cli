import { pc } from "../lib/colors.js";
import { pushFingerprint } from "@getmyenv/crypto";
import {
  describePushDestination,
  PUSH_PROVIDER_TARGETS,
  PUSH_PROVIDER_TITLES,
  PUSH_TOKEN_ENV,
  publicSecretWarning,
} from "@getmyenv/shared";
import { ensureTokenAndLink } from "../lib/bootstrap.js";
import { resolveContext } from "../lib/context.js";
import { promptConfirm } from "../lib/fs.js";
import { readContextValues } from "../lib/read-context.js";
import { createNetlifyAdapter } from "../providers/netlify.js";
import type { PlannedVar, PushAdapter, PushProviderId, Skipped } from "../providers/types.js";
import { createVercelAdapter } from "../providers/vercel.js";

export type PushOpts = {
  context?: string;
  apiUrl?: string;
  project?: string;
  team?: string;
  site?: string;
  target?: string;
  prune?: boolean;
  dryRun?: boolean;
  yes?: boolean;
};

type PastPush = { provider: string; externalId: string; target: string; fingerprint: string; pushedAt: string };

const TOKEN_URLS: Record<PushProviderId, string> = {
  vercel: "https://vercel.com/account/tokens",
  netlify: "https://app.netlify.com/user/applications#personal-access-tokens",
};

function variables(n: number): string {
  return `${n} ${n === 1 ? "variable" : "variables"}`;
}

export function createAdapter(provider: PushProviderId, token: string, opts: PushOpts): PushAdapter {
  const target = opts.target ?? "production";
  if (provider === "vercel") {
    return createVercelAdapter({ token, target, project: opts.project, team: opts.team });
  }
  return createNetlifyAdapter({ token, target, site: opts.site });
}

/** Names-only plan. Values never leave this function except to the platform. */
export function buildPlan(
  adapter: PushAdapter,
  values: Record<string, string>,
  remote: string[],
  prune: boolean
): { upserts: PlannedVar[]; prune: string[]; reserved: string[] } {
  const remoteSet = new Set(remote);
  const reserved: string[] = [];
  const upserts: PlannedVar[] = [];
  for (const name of Object.keys(values).sort()) {
    if (adapter.isReserved(name)) {
      reserved.push(name);
      continue;
    }
    upserts.push({
      name,
      value: values[name]!,
      type: adapter.typeFor(name),
      change: remoteSet.has(name) ? "update" : "add",
    });
  }
  const local = new Set(Object.keys(values));
  const toPrune = prune ? remote.filter((n) => !local.has(n) && !adapter.isReserved(n)).sort() : [];
  return { upserts, prune: toPrune, reserved };
}

export function formatPlan(upserts: PlannedVar[], prune: string[]): string[] {
  const width = Math.max(0, ...upserts.map((u) => u.name.length), ...prune.map((n) => n.length));
  return [
    ...upserts.map((u) => {
      const mark = u.change === "add" ? pc.green("+") : pc.yellow("~");
      return `  ${mark} ${u.name.padEnd(width)}  ${pc.dim(u.type)}`;
    }),
    ...prune.map((n) => `  ${pc.red("-")} ${n.padEnd(width)}  ${pc.dim("(prune)")}`),
  ];
}

function printSkipped(title: string, items: Skipped[]): void {
  if (items.length === 0) return;
  console.log(pc.yellow(title));
  for (const s of items) console.log(`  ${s.name} ${pc.dim(`- ${s.reason}`)}`);
}

/**
 * `push vercel|netlify`: decrypt one context on this machine and write it to
 * the platform with the user's own token. The token never reaches getmyenv.
 */
export async function pushCommand(providerArg: string, opts: PushOpts): Promise<void> {
  const provider = providerArg.toLowerCase();
  if (provider !== "vercel" && provider !== "netlify") {
    throw new Error(`Unknown provider: ${providerArg}. Use vercel or netlify.`);
  }
  const title = PUSH_PROVIDER_TITLES[provider];
  const targets = PUSH_PROVIDER_TARGETS[provider];
  const target = opts.target ?? "production";
  if (!targets.includes(target)) {
    throw new Error(`--target for ${provider} is one of: ${targets.join(", ")}.`);
  }
  if (provider === "vercel" && opts.site) throw new Error("--site is for netlify. Use --project for vercel.");
  if (provider === "netlify" && (opts.project || opts.team)) {
    throw new Error("--project and --team are for vercel. Use --site for netlify.");
  }
  const linked = await ensureTokenAndLink({ apiUrl: opts.apiUrl });
  if (linked.who.isGuest) {
    throw new Error("Push needs an account. Claim this project first: npx getmyenv claim");
  }
  // After the link and guest checks: a platform token does not help an unlinked folder or a guest.
  const tokenEnv = PUSH_TOKEN_ENV[provider];
  const token = process.env[tokenEnv]?.trim();
  if (!token) {
    throw new Error(`Set ${tokenEnv} to your ${title} token. Create one at ${TOKEN_URLS[provider]}`);
  }
  const ctx = resolveContext(linked.who, linked.meta, opts.context);

  const adapter = createAdapter(provider, token, { ...opts, target });
  const dest = await adapter.destination();
  const where = describePushDestination(dest);

  const read = await readContextValues(linked, ctx.slug, "push");
  if (Object.keys(read.values).length === 0 || !read.key) {
    throw new Error(`${ctx.slug} has no values to push.`);
  }
  const contextKey = read.key;

  const { skip, warnings } = adapter.check(read.values);
  const skipNames = new Set(skip.map((s) => s.name));
  const values = Object.fromEntries(Object.entries(read.values).filter(([n]) => !skipNames.has(n)));

  const remote = await adapter.remoteNames();
  const plan = buildPlan(adapter, values, remote, Boolean(opts.prune));
  const pushed = Object.fromEntries(plan.upserts.map((u) => [u.name, u.value]));
  if (plan.upserts.length === 0) throw new Error(`Nothing to push from ${ctx.slug}.`);

  console.log(`${pc.bold(ctx.slug)} to ${where}`);
  for (const line of formatPlan(plan.upserts, plan.prune)) console.log(line);
  console.log("");
  if (plan.reserved.length > 0) {
    console.log(pc.dim(`Not pushed, ${dest.title} sets or reserves these names: ${plan.reserved.join(", ")}`));
  }
  printSkipped("Not pushed:", skip);
  if (read.missing.length > 0) {
    console.log(pc.dim(`No value in ${ctx.slug}, not pushed: ${read.missing.map((m) => m.name).join(", ")}`));
  }
  for (const w of warnings) console.log(pc.yellow(w));
  for (const u of plan.upserts) {
    const warn = publicSecretWarning(u.name, u.value);
    if (warn) console.log(pc.yellow(warn));
  }
  for (const note of adapter.planNotes(plan.upserts)) console.log(pc.dim(note));

  if (opts.dryRun) {
    const past = await linked.client
      .request<{ pushes: PastPush[] }>("GET", `/api/cli/push?context=${encodeURIComponent(ctx.slug)}`)
      .catch(() => ({ pushes: [] as PastPush[] }));
    const last = past.pushes.find(
      (p) => p.provider === dest.provider && p.externalId === dest.externalId && p.target === dest.target
    );
    if (last) {
      const same = last.fingerprint === pushFingerprint(contextKey, pushed);
      console.log(
        same
          ? `No changes in getmyenv since the last push to ${where}.`
          : `Changed in getmyenv since the last push to ${where}.`
      );
    }
    console.log(pc.dim("Dry run. Nothing was written."));
    return;
  }

  const question = `Push ${variables(plan.upserts.length)} to ${where}?`;
  if (plan.prune.length > 0) {
    console.log(pc.red(`Removes from ${where}: ${plan.prune.join(", ")}`));
  }
  if (!opts.yes) {
    if (!process.stdin.isTTY) throw new Error(`${question} Re-run with --yes to confirm.`);
    if (!(await promptConfirm(question, { defaultYes: false }))) {
      console.log(pc.dim("Nothing was written."));
      return;
    }
  }

  const result = await adapter.apply(plan.upserts, plan.prune);
  const readable = result.written.filter((w) => w.type === "readable").length;
  const sensitive = result.written.length - readable;

  if (result.written.length > 0) {
    console.log(
      `${pc.green("✓")} Pushed ${variables(result.written.length)} to ${where}. Readable: ${readable}. Sensitive: ${sensitive}.`
    );
    console.log(`That copy lives in ${dest.title}.`);
    console.log("Future changes in getmyenv are not pushed automatically.");
  }
  if (result.pruned.length > 0) console.log(`Removed: ${result.pruned.join(", ")}`);
  for (const note of result.notes) console.log(pc.yellow(note));
  printSkipped("Not pruned:", result.notPruned);
  printSkipped("Not pushed:", result.notWritten);

  if (result.written.length > 0) {
    const written = Object.fromEntries(result.written.map((w) => [w.name, pushed[w.name]!]));
    try {
      await linked.client.request("POST", "/api/cli/push", {
        context: ctx.slug,
        provider: dest.provider,
        target: dest.target,
        externalId: dest.externalId,
        externalName: dest.externalName,
        ownerSlug: dest.ownerSlug,
        names: Object.keys(written).sort(),
        fingerprint: pushFingerprint(contextKey, written),
      });
    } catch (err) {
      console.log(pc.yellow(`The push worked, but getmyenv could not record it: ${(err as Error).message}`));
    }
  }
  // Anything left undone (not pushed, or not pruned) fails the command.
  if (result.notWritten.length > 0 || result.notPruned.length > 0) process.exitCode = 1;
}
