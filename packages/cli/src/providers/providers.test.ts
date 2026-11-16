import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { pushDestinationUrl, pushTargetLabel as targetLabel } from "@getmyenv/shared";
import { buildPlan, formatPlan } from "../commands/push.js";
import { createNetlifyAdapter } from "./netlify.js";
import { createVercelAdapter, isVercelReserved, readVercelProjectFile } from "./vercel.js";

type Call = { method: string; url: string; body: unknown };

function mockFetch(routes: Array<[string, string | RegExp, (body: unknown) => { status?: number; json?: unknown }]>) {
  const calls: Call[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init: RequestInit) => {
      const method = init.method ?? "GET";
      const body = init.body ? JSON.parse(String(init.body)) : undefined;
      calls.push({ method, url, body });
      expect(init.redirect).toBe("error");
      const route = routes.find(
        ([m, p]) => m === method && (typeof p === "string" ? url.includes(p) : p.test(url))
      );
      if (!route) return new Response(JSON.stringify({ error: { message: "no route" } }), { status: 404 });
      const out = route[2](body);
      return new Response(out.json === undefined ? "" : JSON.stringify(out.json), { status: out.status ?? 200 });
    })
  );
  return calls;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("vercel", () => {
  it("reads .vercel/project.json and only treats team_ org ids as teams", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "gme-vercel-"));
    fs.mkdirSync(path.join(dir, ".vercel"));
    fs.writeFileSync(path.join(dir, ".vercel", "project.json"), JSON.stringify({ projectId: "prj_1", orgId: "team_9" }));
    expect(readVercelProjectFile(dir)).toEqual({ projectId: "prj_1", teamId: "team_9" });
    fs.writeFileSync(path.join(dir, ".vercel", "project.json"), JSON.stringify({ projectId: "prj_1", orgId: "user_1" }));
    expect(readVercelProjectFile(dir)).toEqual({ projectId: "prj_1", teamId: undefined });
  });

  it("reserves VERCEL_ and Lambda names", () => {
    expect(isVercelReserved("VERCEL_URL")).toBe(true);
    expect(isVercelReserved("AWS_REGION")).toBe(true);
    expect(isVercelReserved("STRIPE_SECRET_KEY")).toBe(false);
  });

  it("maps public prefixes to readable and the rest to sensitive", () => {
    const a = createVercelAdapter({ token: "t", target: "production", project: "p" });
    expect(a.typeFor("NEXT_PUBLIC_API_URL")).toBe("readable");
    expect(a.typeFor("STRIPE_SECRET_KEY")).toBe("sensitive");
  });

  it("splits a shared entry and only removes the pushed target on prune", async () => {
    const calls = mockFetch([
      ["GET", /\/env(\?|$)/, () => ({
        json: {
          envs: [
            { id: "e1", key: "DATABASE_URL", type: "sensitive", target: ["production", "preview"] },
            { id: "e2", key: "API_KEY", type: "sensitive", target: ["production"] },
            { id: "e3", key: "OLD_KEY", type: "encrypted", target: ["production", "development"] },
            { id: "e4", key: "GONE", type: "sensitive", target: ["production"] },
            { id: "e5", key: "BRANCH_ONLY", type: "sensitive", target: ["production"], gitBranch: "x" },
          ],
        },
      })],
      ["GET", "/v9/projects/web", () => ({ json: { id: "prj_1", name: "web", accountId: "team_1" } })],
      ["GET", "/v2/teams/team_1", () => ({ json: { slug: "acme" } })],
      ["PATCH", "/env/", () => ({ json: {} })],
      ["POST", "/v10/projects/", () => ({ json: {} })],
      ["DELETE", "/env/", () => ({ json: {} })],
    ]);
    const a = createVercelAdapter({ token: "t", target: "production", project: "web" });
    const dest = await a.destination();
    expect(dest.label).toBe("acme/web");
    const remote = await a.remoteNames();
    expect(remote.sort()).toEqual(["API_KEY", "DATABASE_URL", "GONE", "OLD_KEY"]);

    const plan = buildPlan(a, { DATABASE_URL: "db", API_KEY: "k", NEW_ONE: "n", VERCEL_ENV: "x" }, remote, true);
    expect(plan.reserved).toEqual(["VERCEL_ENV"]);
    expect(plan.prune).toEqual(["GONE", "OLD_KEY"]);

    const res = await a.apply(plan.upserts, plan.prune);
    expect(res.notWritten).toEqual([]);
    expect(res.pruned.sort()).toEqual(["GONE", "OLD_KEY"]);

    const writes = calls.filter((c) => c.method !== "GET").map((c) => `${c.method} ${c.url.replace("https://api.vercel.com", "").split("?")[0]} ${JSON.stringify(c.body ?? null)}`);
    expect(writes).toEqual([
      'PATCH /v9/projects/prj_1/env/e2 {"value":"k"}',
      'PATCH /v9/projects/prj_1/env/e1 {"target":["preview"]}',
      'POST /v10/projects/prj_1/env {"key":"DATABASE_URL","value":"db","type":"sensitive","target":["production"]}',
      'POST /v10/projects/prj_1/env {"key":"NEW_ONE","value":"n","type":"sensitive","target":["production"]}',
      "DELETE /v9/projects/prj_1/env/e4 null",
      'PATCH /v9/projects/prj_1/env/e3 {"target":["development"]}',
    ]);
    expect(calls.every((c) => c.method === "GET" || c.url.includes("teamId=team_1"))).toBe(true);
  });

  it("falls back to readable when Development refuses sensitive", async () => {
    mockFetch([
      ["GET", /\/env(\?|$)/, () => ({ json: { envs: [] } })],
      ["GET", "/v9/projects/web", () => ({ json: { id: "web", name: "web" } })],
      ["GET", "/v2/user", () => ({ json: { user: { username: "me" } } })],
      ["POST", "/v10/projects/", (body) =>
        (body as { type: string }).type === "sensitive"
          ? { status: 400, json: { error: { message: "not allowed" } } }
          : { json: {} }],
    ]);
    const a = createVercelAdapter({ token: "t", target: "development", project: "web" });
    await a.destination();
    const plan = buildPlan(a, { API_KEY: "k" }, await a.remoteNames(), false);
    expect(a.planNotes(plan.upserts)).toHaveLength(1);
    const res = await a.apply(plan.upserts, []);
    expect(res.written).toEqual([{ name: "API_KEY", type: "readable" }]);
    expect(res.notes.join(" ")).toContain("API_KEY");
  });

  it("explains a missing project link", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "gme-vercel-"));
    const a = createVercelAdapter({ token: "t", target: "production", cwd: dir });
    await expect(a.destination()).rejects.toThrow(/vercel link/);
  });
});

describe("netlify", () => {
  const site = ["GET", "/api/v1/sites/s1", () => ({
    json: { id: "s1", name: "acme-web", account_id: "a1", account_slug: "acme" },
  })] as const;

  it("skips a variable with one value for all contexts, and never prunes it", async () => {
    const calls = mockFetch([
      [site[0], site[1], site[2]],
      ["GET", "/api/v1/accounts/a1/env", () => ({
        json: [
          { key: "SHARED", is_secret: false, values: [{ id: "v1", context: "all", value: "x" }] },
          { key: "OLD_ALL", values: [{ id: "v2", context: "all", value: "x" }] },
          { key: "OLD_ONE", values: [{ id: "v3", context: "production", value: "x" }] },
          { key: "OLD_MANY", values: [{ id: "v4", context: "production" }, { id: "v5", context: "dev" }] },
          { key: "PROD", is_secret: true, values: [{ id: "v6", context: "production" }] },
        ],
      })],
      ["POST", "/env?", () => ({ json: [] })],
      ["PATCH", "/env/", () => ({ json: {} })],
      ["DELETE", "/env/", () => ({ json: {} })],
    ]);
    const a = createNetlifyAdapter({ token: "t", target: "production", site: "s1" });
    expect((await a.destination()).label).toBe("acme/acme-web");
    const remote = await a.remoteNames();
    const plan = buildPlan(a, { SHARED: "1", PROD: "2", NEW_ONE: "3", NETLIFY_X: "4" }, remote, true);
    expect(plan.reserved).toEqual(["NETLIFY_X"]);
    expect(plan.prune).toEqual(["OLD_ALL", "OLD_MANY", "OLD_ONE"]);
    const res = await a.apply(plan.upserts, plan.prune);
    expect(res.notWritten.map((s) => s.name)).toEqual(["SHARED"]);
    expect(res.notPruned.map((s) => s.name)).toEqual(["OLD_ALL"]);
    expect(res.pruned).toEqual(["OLD_MANY", "OLD_ONE"]);
    const writes = calls.filter((c) => c.method !== "GET").map((c) => `${c.method} ${c.url.replace("https://api.netlify.com", "")}`);
    expect(writes).toEqual([
      "POST /api/v1/accounts/a1/env?site_id=s1",
      "PATCH /api/v1/accounts/a1/env/PROD?site_id=s1",
      "DELETE /api/v1/accounts/a1/env/OLD_MANY/value/v4?site_id=s1",
      "DELETE /api/v1/accounts/a1/env/OLD_ONE?site_id=s1",
    ]);
  });

  it("keeps dev values readable", () => {
    const a = createNetlifyAdapter({ token: "t", target: "dev", site: "s1" });
    expect(a.typeFor("STRIPE_SECRET_KEY")).toBe("readable");
    expect(a.planNotes([])).toHaveLength(1);
  });

  it("skips values over the Netlify limit", () => {
    const a = createNetlifyAdapter({ token: "t", target: "production", site: "s1" });
    const { skip } = a.check({ BIG: "x".repeat(5001), OK: "y" });
    expect(skip.map((s) => s.name)).toEqual(["BIG"]);
  });
});

describe("plan output", () => {
  it("prints names and types only", () => {
    const lines = formatPlan(
      [
        { name: "STRIPE_SECRET_KEY", value: "sk_live_secret", type: "sensitive", change: "add" },
        { name: "NEXT_PUBLIC_API_URL", value: "https://x", type: "readable", change: "update" },
      ],
      ["OLD_KEY"]
    ).join("\n");
    expect(lines).toContain("STRIPE_SECRET_KEY");
    expect(lines).toContain("(prune)");
    expect(lines).not.toContain("sk_live_secret");
    expect(lines).not.toContain("https://x");
  });

  it("labels targets", () => {
    expect(targetLabel("production")).toBe("Production");
    expect(targetLabel("deploy-preview")).toBe("Deploy preview");
  });

  it("links to fixed hosts only", () => {
    expect(pushDestinationUrl("vercel", "acme", "web")).toBe(
      "https://vercel.com/acme/web/settings/environment-variables"
    );
    expect(pushDestinationUrl("netlify", "acme", "acme-web")).toBe(
      "https://app.netlify.com/sites/acme-web/configuration/env"
    );
    expect(pushDestinationUrl("vercel", "evil.com/x", "web")).toBeNull();
    expect(pushDestinationUrl("netlify", "a", "../x")).toBeNull();
  });
});
