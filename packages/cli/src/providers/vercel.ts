import fs from "node:fs";
import path from "node:path";
import { isPublicEnvName, isReservedPushName } from "@getmyenv/shared";
import { pushApiBase } from "../lib/api-url.js";
import { PlatformError, platformRequest } from "./http.js";
import type { ApplyResult, Destination, PlannedVar, PushAdapter, Skipped, VarType } from "./types.js";

export const VERCEL_API = "https://api.vercel.com";
const MAX_TOTAL_BYTES = 64 * 1024;

export const isVercelReserved = (name: string) => isReservedPushName("vercel", name);

type VercelEnv = {
  id: string;
  key: string;
  type: string;
  target?: string[] | string;
  gitBranch?: string | null;
  customEnvironmentIds?: string[];
};

type ProjectRef = { projectId: string; teamId?: string };

/** `.vercel/project.json`, written by `vercel link`. */
export function readVercelProjectFile(cwd = process.cwd()): ProjectRef | null {
  const file = path.join(cwd, ".vercel", "project.json");
  if (!fs.existsSync(file)) return null;
  try {
    const raw = JSON.parse(fs.readFileSync(file, "utf8")) as { projectId?: unknown; orgId?: unknown };
    if (typeof raw.projectId !== "string" || !raw.projectId) return null;
    const teamId = typeof raw.orgId === "string" && raw.orgId.startsWith("team_") ? raw.orgId : undefined;
    return { projectId: raw.projectId, teamId };
  } catch {
    return null;
  }
}

function targetsOf(env: VercelEnv): string[] {
  if (Array.isArray(env.target)) return env.target;
  return env.target ? [env.target] : [];
}

function vercelType(type: VarType): string {
  return type === "sensitive" ? "sensitive" : "encrypted";
}

export function createVercelAdapter(opts: {
  token: string;
  target: string;
  project?: string;
  team?: string;
  cwd?: string;
}): PushAdapter {
  const target = opts.target;
  const base = pushApiBase(VERCEL_API);
  let projectId = "";
  let teamId: string | undefined;
  let envs: VercelEnv[] | null = null;

  const request = <T>(method: "GET" | "POST" | "PATCH" | "DELETE", p: string, body?: unknown) => {
    const sep = p.includes("?") ? "&" : "?";
    const full = teamId ? `${p}${sep}teamId=${encodeURIComponent(teamId)}` : p;
    return platformRequest<T>({ title: "Vercel", base, token: opts.token, method, path: full, body });
  };

  /** Entries that set a value for the pushed target on every branch. Branch-only entries are not ours. */
  const forTarget = (key?: string) =>
    (envs ?? []).filter(
      (e) => !e.gitBranch && targetsOf(e).includes(target) && (key === undefined || e.key === key)
    );

  async function loadEnvs(): Promise<VercelEnv[]> {
    if (!envs) {
      const res = await request<{ envs?: VercelEnv[] }>("GET", `/v9/projects/${encodeURIComponent(projectId)}/env`);
      envs = res.envs ?? [];
    }
    return envs;
  }

  async function create(name: string, value: string, type: VarType): Promise<void> {
    await request("POST", `/v10/projects/${encodeURIComponent(projectId)}/env`, {
      key: name,
      value,
      type: vercelType(type),
      target: [target],
    });
  }

  async function remove(id: string): Promise<void> {
    await request("DELETE", `/v9/projects/${encodeURIComponent(projectId)}/env/${encodeURIComponent(id)}`);
  }

  async function setTargets(id: string, targets: string[]): Promise<void> {
    await request("PATCH", `/v9/projects/${encodeURIComponent(projectId)}/env/${encodeURIComponent(id)}`, {
      target: targets,
    });
  }

  async function write(v: PlannedVar): Promise<VarType> {
    const [entry] = forTarget(v.name);
    const want = vercelType(v.type);
    if (entry && targetsOf(entry).length === 1 && entry.type === want) {
      await request("PATCH", `/v9/projects/${encodeURIComponent(projectId)}/env/${encodeURIComponent(entry.id)}`, {
        value: v.value,
      });
      return v.type;
    }
    if (entry && targetsOf(entry).length === 1) {
      // Vercel does not change a variable's type in place. Remove and add it again, for this target only.
      await remove(entry.id);
    } else if (entry) {
      // The entry also serves other targets. They keep it. This target gets its own entry.
      await setTargets(
        entry.id,
        targetsOf(entry).filter((t) => t !== target)
      );
    }
    try {
      await create(v.name, v.value, v.type);
      return v.type;
    } catch (err) {
      if (v.type === "sensitive" && target === "development" && err instanceof PlatformError && err.status === 400) {
        await create(v.name, v.value, "readable");
        return "readable";
      }
      if (entry) {
        throw new Error(
          `${v.name} was taken off Vercel ${target} to write it again, then adding it failed: ${(err as Error).message} Run push again.`
        );
      }
      throw err;
    }
  }

  return {
    id: "vercel",
    title: "Vercel",
    target,
    isReserved: isVercelReserved,
    typeFor: (name) => (isPublicEnvName(name) ? "readable" : "sensitive"),
    check(values) {
      const skip: Skipped[] = [];
      const warnings: string[] = [];
      let total = 0;
      for (const [name, value] of Object.entries(values)) {
        const bytes = Buffer.byteLength(name) + Buffer.byteLength(value);
        if (bytes > MAX_TOTAL_BYTES) {
          skip.push({ name, reason: "larger than 64 KB, the Vercel limit" });
          continue;
        }
        total += bytes;
      }
      if (total > MAX_TOTAL_BYTES) {
        warnings.push(
          `These values add up to ${Math.ceil(total / 1024)} KB. Vercel allows 64 KB of variables per deployment.`
        );
      }
      return { skip, warnings };
    },
    planNotes(plan) {
      if (target !== "development" || !plan.some((p) => p.type === "sensitive")) return [];
      return [
        "If Vercel refuses Sensitive for Development, those variables are pushed as readable and listed after the push.",
      ];
    },
    async destination(): Promise<Destination> {
      const file = opts.project ? null : readVercelProjectFile(opts.cwd);
      const ref: ProjectRef | null = opts.project ? { projectId: opts.project, teamId: opts.team } : file;
      if (!ref) {
        throw new Error(
          "No Vercel project. Run `vercel link` in this folder, or pass --project <id> (and --team <id> for a team project)."
        );
      }
      projectId = ref.projectId;
      teamId = opts.team ?? ref.teamId;
      const project = await request<{ id: string; name: string; accountId?: string }>(
        "GET",
        `/v9/projects/${encodeURIComponent(projectId)}`
      );
      projectId = project.id;
      if (!teamId && project.accountId?.startsWith("team_")) teamId = project.accountId;
      let ownerSlug: string;
      if (teamId) {
        const team = await request<{ slug: string }>("GET", `/v2/teams/${encodeURIComponent(teamId)}`);
        ownerSlug = team.slug;
      } else {
        const me = await request<{ user: { username: string } }>("GET", "/v2/user");
        ownerSlug = me.user.username;
      }
      return {
        provider: "vercel",
        title: "Vercel",
        externalId: project.id,
        externalName: project.name,
        ownerSlug,
        label: `${ownerSlug}/${project.name}`,
        target,
      };
    },
    async remoteNames() {
      await loadEnvs();
      return [
        ...new Set(
          forTarget()
            .filter((e) => e.type !== "system" && !isVercelReserved(e.key))
            .map((e) => e.key)
        ),
      ];
    },
    async apply(upserts, prune): Promise<ApplyResult> {
      await loadEnvs();
      const result: ApplyResult = { written: [], pruned: [], notPruned: [], notWritten: [], notes: [] };
      for (const v of upserts) {
        try {
          const type = await write(v);
          result.written.push({ name: v.name, type });
        } catch (err) {
          result.notWritten.push({ name: v.name, reason: (err as Error).message });
        }
      }
      const fellBack = result.written.filter(
        (w) => w.type === "readable" && upserts.find((u) => u.name === w.name)?.type === "sensitive"
      );
      if (fellBack.length > 0) {
        result.notes.push(
          `Vercel refused Sensitive for Development. Pushed as readable: ${fellBack.map((w) => w.name).join(", ")}.`
        );
      }
      for (const name of prune) {
        for (const entry of forTarget(name)) {
          const targets = targetsOf(entry);
          try {
            if (targets.length === 1) await remove(entry.id);
            else await setTargets(entry.id, targets.filter((t) => t !== target));
            if (!result.pruned.includes(name)) result.pruned.push(name);
          } catch (err) {
            result.notPruned.push({ name, reason: (err as Error).message });
          }
        }
      }
      return result;
    },
  };
}
