import fs from "node:fs";
import path from "node:path";
import { isPublicEnvName, isReservedPushName } from "@getmyenv/shared";
import { pushApiBase } from "../lib/api-url.js";
import { PlatformError, platformRequest } from "./http.js";
import type { ApplyResult, Destination, PlannedVar, PushAdapter, Skipped, VarType } from "./types.js";

export const NETLIFY_API = "https://api.netlify.com";
const MAX_VALUE_CHARS = 5000;
const LAMBDA_TOTAL_BYTES = 4 * 1024;

export const isNetlifyReserved = (name: string) => isReservedPushName("netlify", name);

type NetlifyValue = { id?: string; context: string; context_parameter?: string; value?: string };
type NetlifyVar = { key: string; is_secret?: boolean; values?: NetlifyValue[] };

/** `.netlify/state.json`, written by `netlify link`. */
export function readNetlifyStateFile(cwd = process.cwd()): string | null {
  const file = path.join(cwd, ".netlify", "state.json");
  if (!fs.existsSync(file)) return null;
  try {
    const raw = JSON.parse(fs.readFileSync(file, "utf8")) as { siteId?: unknown };
    return typeof raw.siteId === "string" && raw.siteId ? raw.siteId : null;
  } catch {
    return null;
  }
}

export function createNetlifyAdapter(opts: {
  token: string;
  target: string;
  site?: string;
  cwd?: string;
}): PushAdapter {
  const target = opts.target;
  const base = pushApiBase(NETLIFY_API);
  let siteId = "";
  let accountId = "";
  let vars: NetlifyVar[] | null = null;
  const secretRefused: string[] = [];

  const request = <T>(method: "GET" | "POST" | "PATCH" | "DELETE", p: string, body?: unknown) =>
    platformRequest<T>({ title: "Netlify", base, token: opts.token, method, path: p, body });
  const envPath = (suffix = "") =>
    `/api/v1/accounts/${encodeURIComponent(accountId)}/env${suffix}?site_id=${encodeURIComponent(siteId)}`;

  const valuesOf = (v: NetlifyVar) => v.values ?? [];
  const find = (name: string) => (vars ?? []).find((v) => v.key === name);
  const ownValue = (v: NetlifyVar) => valuesOf(v).find((x) => x.context === target);
  const hasAll = (v: NetlifyVar) => valuesOf(v).some((x) => x.context === "all");

  async function loadVars(): Promise<NetlifyVar[]> {
    if (!vars) vars = (await request<NetlifyVar[]>("GET", envPath())) ?? [];
    return vars;
  }

  async function create(name: string, value: string, secret: boolean): Promise<boolean> {
    try {
      await request("POST", envPath(), [{ key: name, values: [{ context: target, value }], is_secret: secret }]);
      return secret;
    } catch (err) {
      if (secret && err instanceof PlatformError && err.status >= 400 && err.status < 500 && /secret/i.test(err.message)) {
        await request("POST", envPath(), [{ key: name, values: [{ context: target, value }], is_secret: false }]);
        secretRefused.push(name);
        return false;
      }
      throw err;
    }
  }

  async function write(v: PlannedVar, result: ApplyResult): Promise<VarType | null> {
    const existing = find(v.name);
    const secret = v.type === "sensitive";
    if (!existing) {
      return (await create(v.name, v.value, secret)) ? "sensitive" : "readable";
    }
    if (hasAll(existing)) {
      result.notWritten.push({
        name: v.name,
        reason: "it has one value for all deploy contexts in Netlify. Give it per-context values there, or remove it, then push again",
      });
      return null;
    }
    const onlyOurs = valuesOf(existing).every((x) => x.context === target);
    if (Boolean(existing.is_secret) !== secret && onlyOurs) {
      // Netlify sets is_secret for the whole variable. It only serves this target, so replace it.
      await request("DELETE", envPath(`/${encodeURIComponent(v.name)}`));
      try {
        return (await create(v.name, v.value, secret)) ? "sensitive" : "readable";
      } catch (err) {
        throw new Error(
          `${v.name} was removed from Netlify to change its type, then adding it again failed: ${(err as Error).message} Run push again.`
        );
      }
    }
    await request("PATCH", envPath(`/${encodeURIComponent(v.name)}`), { context: target, value: v.value });
    const kept: VarType = existing.is_secret ? "sensitive" : "readable";
    if (kept !== v.type) {
      result.notes.push(
        `${v.name} keeps its Netlify type (${kept}). Netlify sets it for every deploy context of the variable.`
      );
    }
    return kept;
  }

  return {
    id: "netlify",
    title: "Netlify",
    target,
    isReserved: isNetlifyReserved,
    typeFor: (name) => (isPublicEnvName(name) || target === "dev" ? "readable" : "sensitive"),
    check(values) {
      const skip: Skipped[] = [];
      const warnings: string[] = [];
      let total = 0;
      for (const [name, value] of Object.entries(values)) {
        if (value.length > MAX_VALUE_CHARS) {
          skip.push({ name, reason: `longer than ${MAX_VALUE_CHARS} characters, the Netlify limit` });
          continue;
        }
        total += Buffer.byteLength(name) + Buffer.byteLength(value) + 1;
      }
      if (total > LAMBDA_TOTAL_BYTES) {
        warnings.push(
          `These values add up to ${Math.ceil(total / 1024)} KB. Netlify Functions in Lambda compatibility mode get at most 4 KB of variables.`
        );
      }
      return { skip, warnings };
    },
    planNotes() {
      if (target !== "dev") return [];
      return ["Netlify does not keep secret values for local development. Values for dev are readable."];
    },
    async destination(): Promise<Destination> {
      const id = opts.site ?? readNetlifyStateFile(opts.cwd);
      if (!id) {
        throw new Error("No Netlify site. Run `netlify link` in this folder, or pass --site <id>.");
      }
      const site = await request<{ id: string; name: string; account_id: string; account_slug: string }>(
        "GET",
        `/api/v1/sites/${encodeURIComponent(id)}`
      );
      siteId = site.id;
      accountId = site.account_id;
      return {
        provider: "netlify",
        title: "Netlify",
        externalId: site.id,
        externalName: site.name,
        ownerSlug: site.account_slug,
        label: `${site.account_slug}/${site.name}`,
        target,
      };
    },
    async remoteNames() {
      await loadVars();
      return (vars ?? [])
        .filter((v) => !isNetlifyReserved(v.key) && (ownValue(v) || hasAll(v)))
        .map((v) => v.key);
    },
    async apply(upserts, prune): Promise<ApplyResult> {
      await loadVars();
      const result: ApplyResult = { written: [], pruned: [], notPruned: [], notWritten: [], notes: [] };
      for (const v of upserts) {
        try {
          const type = await write(v, result);
          if (type) result.written.push({ name: v.name, type });
        } catch (err) {
          result.notWritten.push({ name: v.name, reason: (err as Error).message });
        }
      }
      if (secretRefused.length > 0) {
        result.notes.push(
          `Netlify refused secret values for this account. Pushed as readable: ${secretRefused.join(", ")}.`
        );
      }
      for (const name of prune) {
        const existing = find(name);
        if (!existing) continue;
        if (hasAll(existing)) {
          result.notPruned.push({ name, reason: "one value for all deploy contexts, cannot remove only " + target });
          continue;
        }
        const own = ownValue(existing);
        if (!own) continue;
        try {
          if (valuesOf(existing).length === 1) {
            await request("DELETE", envPath(`/${encodeURIComponent(name)}`));
          } else if (own.id) {
            await request("DELETE", envPath(`/${encodeURIComponent(name)}/value/${encodeURIComponent(own.id)}`));
          } else {
            result.notPruned.push({ name, reason: `Netlify did not return an id for its ${target} value` });
            continue;
          }
          result.pruned.push(name);
        } catch (err) {
          result.notPruned.push({ name, reason: (err as Error).message });
        }
      }
      return result;
    },
  };
}
