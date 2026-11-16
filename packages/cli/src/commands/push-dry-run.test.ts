import http from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * push --dry-run with the real command and the real Vercel and Netlify
 * adapters, over HTTP to a local stub of their APIs (GETMYENV_PUSH_API_URL).
 * Only the getmyenv side is mocked: push needs an account, and an account's
 * values need the Vault password, which the e2e scripts cannot type.
 */

const SECRET = "sk_live_dry_run_4b2e";
const PUBLIC = "https://dry-run.example";
const values = { API_KEY: SECRET, NEXT_PUBLIC_URL: PUBLIC };
const getmyenvRequest = vi.fn(async (..._args: unknown[]) => ({ pushes: [] }));

vi.mock("../lib/bootstrap.js", () => ({
  ensureTokenAndLink: vi.fn(async () => ({
    who: { isGuest: false, project: { id: "p1" }, contexts: [] },
    meta: {},
    client: { request: getmyenvRequest },
  })),
}));
vi.mock("../lib/context.js", () => ({
  resolveContext: () => ({ id: 1, slug: "production", name: "Production", protection: "locked" }),
}));
vi.mock("../lib/read-context.js", () => ({
  readContextValues: vi.fn(async () => ({ values, missing: [], key: new Uint8Array(32).fill(3) })),
}));

const { pushCommand } = await import("./push.js");

type Seen = { method: string; url: string; body: string; auth: string };
const seen: Seen[] = [];

const ROUTES: Record<string, unknown> = {
  "/v9/projects/prj_1": { id: "prj_1", name: "web", accountId: "team_1" },
  "/v2/teams/team_1?teamId=team_1": { slug: "acme" },
  "/v9/projects/prj_1/env?teamId=team_1": {
    envs: [
      { id: "env_1", key: "API_KEY", type: "encrypted", target: ["production", "development"] },
      { id: "env_2", key: "OLD_KEY", type: "encrypted", target: ["production", "development"] },
    ],
  },
  "/api/v1/sites/site_1": { id: "site_1", name: "web", account_id: "acc_1", account_slug: "acme" },
  "/api/v1/accounts/acc_1/env?site_id=site_1": [
    { key: "API_KEY", is_secret: true, values: [{ id: "v1", context: "production", value: "" }] },
    { key: "OLD_KEY", is_secret: true, values: [{ id: "v2", context: "production", value: "" }] },
  ],
};

const server = http.createServer(async (req, res) => {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  seen.push({
    method: req.method ?? "",
    url: req.url ?? "",
    body: Buffer.concat(chunks).toString("utf8"),
    auth: String(req.headers.authorization ?? ""),
  });
  const found = req.method === "GET" ? ROUTES[req.url ?? ""] : undefined;
  res.writeHead(found ? 200 : 404, { "content-type": "application/json" });
  res.end(JSON.stringify(found ?? { error: { message: "not in the stub" } }));
});

let out: string[] = [];
beforeAll(async () => {
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
});
afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});
beforeEach(() => {
  out = [];
  seen.length = 0;
  getmyenvRequest.mockClear();
  vi.spyOn(console, "log").mockImplementation((...a: unknown[]) => {
    out.push(a.join(" "));
  });
  vi.stubEnv("GETMYENV_PUSH_API_URL", `http://127.0.0.1:${(server.address() as AddressInfo).port}`);
  vi.stubEnv("VERCEL_TOKEN", "vercel_tok");
  vi.stubEnv("NETLIFY_AUTH_TOKEN", "netlify_tok");
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

function expectNothingWritten() {
  const text = out.join("\n");
  expect(text).not.toContain(SECRET);
  expect(text).not.toContain(PUBLIC);
  expect(text).toContain("Dry run. Nothing was written.");
  expect(seen.length).toBeGreaterThan(0);
  expect(seen.filter((r) => r.method !== "GET")).toEqual([]);
  for (const r of seen) {
    expect(r.body).toBe("");
    expect(r.url).not.toContain(SECRET);
    expect(r.url).not.toContain(encodeURIComponent(PUBLIC));
  }
  for (const call of getmyenvRequest.mock.calls) expect(call[0]).toBe("GET");
}

describe("push --dry-run against a stub platform API", () => {
  it("vercel: lists names, reads with GET only and sends no value", async () => {
    await pushCommand("vercel", { dryRun: true, project: "prj_1", prune: true });
    const text = out.join("\n");
    expect(text).toContain("API_KEY");
    expect(text).toContain("NEXT_PUBLIC_URL");
    expect(text).toContain("OLD_KEY");
    expect(text).toContain("Vercel acme/web (Production)");
    expectNothingWritten();
    expect(seen.every((r) => r.auth === "Bearer vercel_tok")).toBe(true);
  });

  it("vercel development target: GET only", async () => {
    await pushCommand("vercel", { dryRun: true, project: "prj_1", target: "development" });
    expect(out.join("\n")).toContain("(Development)");
    expectNothingWritten();
  });

  it("control: without --dry-run the stub does see writes", async () => {
    await pushCommand("vercel", { yes: true, project: "prj_1" });
    process.exitCode = undefined;
    expect(seen.some((r) => r.method !== "GET")).toBe(true);
  });

  it("netlify: lists names, reads with GET only and sends no value", async () => {
    vi.stubEnv("VERCEL_TOKEN", "");
    await pushCommand("netlify", { dryRun: true, site: "site_1", prune: true });
    const text = out.join("\n");
    expect(text).toContain("API_KEY");
    expect(text).toContain("OLD_KEY");
    expectNothingWritten();
    expect(seen.every((r) => r.auth === "Bearer netlify_tok")).toBe(true);
  });
});
