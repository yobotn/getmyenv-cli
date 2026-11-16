import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { PassThrough } from "node:stream";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CLI_MCP_TOOLS } from "@getmyenv/shared";
import { NOT_LINKED_STEPS } from "../lib/bootstrap.js";
import { MCP_PROTOCOL_VERSION } from "../lib/mcp-protocol.js";
import { createMcpServer, mcpCommand } from "./mcp.js";

const API = "http://localhost:9";
const TOKEN = "gme_fixture_folder_token_7f3a9c1d2e";
const GUEST_TOKEN = "gme_fixture_guest_token_b81c0e44aa";
const CLAIM_CODE = "CLAIM-FIXTURE-55K2-QQ9X";
const VALUE = "sk_live_fixture_value_4242424242";

const WHOAMI = {
  project: { id: "p1", name: "Demo" },
  vaultSet: true,
  token: { kind: "folder", label: null, context: null, allowedCidrs: [], newMachinePolicy: null },
  user: { email: "dev@example.com" },
  isGuest: false,
  guestExpiresAt: null,
  contexts: [
    { id: 1, slug: "development", name: "Development", protection: "open" },
    { id: 2, slug: "production", name: "Production", protection: "locked" },
  ],
  keys: [
    { name: "DATABASE_URL", status: { development: "set", production: "set" } },
    { name: "STRIPE_SECRET_KEY", status: { development: "missing", production: "set" } },
  ],
};

type Call = { method: string; url: string; body: unknown };

let dir = "";
let calls: Call[] = [];
const envBefore = { ...process.env };

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

function stubServer(): void {
  calls = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init: RequestInit = {}) => {
      const method = init.method ?? "GET";
      const body = init.body ? JSON.parse(String(init.body)) : undefined;
      calls.push({ method, url, body });
      const p = new URL(url).pathname;
      if (p === "/api/cli/whoami") return json(WHOAMI);
      if (p === "/api/cli/values" && method === "POST") {
        const declare: string[] = body.declare ?? [];
        return json({ set: [], pruned: [], declared: declare.filter((n) => !WHOAMI.keys.some((k) => k.name === n)) });
      }
      if (p === "/api/cli/contexts") return json({ id: 3, slug: "staging", name: body.name, protection: "open" });
      if (p === "/api/anon-projects") {
        return json({
          projectId: "g1",
          projectName: body.name,
          token: GUEST_TOKEN,
          claimCode: CLAIM_CODE,
          guestExpiresAt: "2027-01-01T00:00:00.000Z",
          context: "development",
        });
      }
      return json({ error: "not found" }, 404);
    })
  );
}

function linkedFolder(): void {
  fs.mkdirSync(path.join(dir, ".getmyenv"), { recursive: true });
  fs.writeFileSync(
    path.join(dir, ".getmyenv", "token.json"),
    JSON.stringify({ version: 2, token: TOKEN, apiUrl: API, projectId: "p1", addedAt: "2026-01-01T00:00:00Z" })
  );
  fs.writeFileSync(
    path.join(dir, ".getmyenv", "project.json"),
    JSON.stringify({ projectId: "p1", projectName: "Demo", context: "development" })
  );
}

let nextId = 1;
async function rpc(server: ReturnType<typeof createMcpServer>, method: string, params?: unknown) {
  const line = await server.handleLine(JSON.stringify({ jsonrpc: "2.0", id: nextId++, method, params }));
  return JSON.parse(line!);
}

async function call(server: ReturnType<typeof createMcpServer>, name: string, args: Record<string, unknown> = {}) {
  return rpc(server, "tools/call", { name, arguments: { cwd: dir, ...args } });
}

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "getmyenv-mcp-"));
  fs.mkdirSync(path.join(dir, ".git"));
  delete process.env.GETMYENV_TOKEN;
  delete process.env.GETMYENV_API_URL;
  process.env.GETMYENV_CONFIG_DIR = path.join(dir, ".config");
  process.env.GETMYENV_KEYCHAIN = "0";
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  stubServer();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  process.env = { ...envBefore };
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("MCP protocol", () => {
  const server = createMcpServer({ apiUrl: API });

  it("answers initialize with the asked version, tools capability and server info", async () => {
    const res = await rpc(server, "initialize", {
      protocolVersion: MCP_PROTOCOL_VERSION,
      capabilities: {},
      clientInfo: { name: "test", version: "1" },
    });
    expect(res.jsonrpc).toBe("2.0");
    expect(res.result.protocolVersion).toBe("2025-06-18");
    expect(res.result.capabilities).toEqual({ tools: {} });
    expect(res.result.serverInfo.name).toBe("getmyenv");
    expect(res.result.serverInfo.version).toMatch(/^\d+\.\d+\.\d+/);
    expect(res.result.instructions).toContain("never");
  });

  it("offers its own version for a version it does not speak", async () => {
    const res = await rpc(server, "initialize", { protocolVersion: "1999-01-01", capabilities: {} });
    expect(res.result.protocolVersion).toBe(MCP_PROTOCOL_VERSION);
  });

  it("does not answer notifications", async () => {
    expect(await server.handleLine(JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }))).toBeNull();
  });

  it("answers ping", async () => {
    expect((await rpc(server, "ping")).result).toEqual({});
  });

  it("returns -32601 for an unknown method", async () => {
    const res = await rpc(server, "resources/list");
    expect(res.error.code).toBe(-32601);
    expect(res.id).toBe(nextId - 1);
  });

  it("returns -32700 with a null id for malformed JSON", async () => {
    const res = JSON.parse((await server.handleLine("{not json"))!);
    expect(res).toEqual({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } });
  });

  it("returns -32600 for a message that is not a request", async () => {
    expect(JSON.parse((await server.handleLine("[1,2]"))!).error.code).toBe(-32600);
    expect(JSON.parse((await server.handleLine(JSON.stringify({ jsonrpc: "1.0", id: 1, method: "ping" })))!).error.code).toBe(-32600);
    expect(JSON.parse((await server.handleLine(JSON.stringify({ jsonrpc: "2.0", id: 1 })))!).error.code).toBe(-32600);
  });

  it("returns -32602 for an unknown tool or arguments that do not match the schema", async () => {
    expect((await rpc(server, "tools/call", { name: "read_values", arguments: {} })).error.code).toBe(-32602);
    expect((await rpc(server, "tools/call", { name: "declare_variables", arguments: { names: "API_KEY" } })).error.code).toBe(-32602);
    expect((await rpc(server, "tools/call", { name: "declare_variables", arguments: {} })).error.code).toBe(-32602);
    expect((await rpc(server, "tools/call", { name: "status", arguments: { value: "x" } })).error.code).toBe(-32602);
  });
});

describe("tools/list", () => {
  it("lists exactly the tools in the contract, each with a schema, cwd and annotations", async () => {
    const res = await rpc(createMcpServer(), "tools/list");
    const tools = res.result.tools as Array<Record<string, any>>;
    expect(tools.map((t) => t.name)).toEqual([...CLI_MCP_TOOLS]);
    for (const t of tools) {
      expect(t.description.length).toBeGreaterThan(40);
      expect(t.inputSchema.type).toBe("object");
      expect(t.inputSchema.additionalProperties).toBe(false);
      expect(t.inputSchema.properties.cwd.type).toBe("string");
      for (const hint of ["readOnlyHint", "destructiveHint", "idempotentHint", "openWorldHint"]) {
        expect(typeof t.annotations[hint]).toBe("boolean");
      }
      expect(t.annotations.destructiveHint).toBe(false);
    }
    const byName = Object.fromEntries(tools.map((t) => [t.name, t]));
    expect(byName.declare_variables.inputSchema.required).toEqual(["names"]);
    expect(byName.declare_variables.inputSchema.properties.names).toMatchObject({ type: "array", items: { type: "string" } });
    expect(byName.declare_variables.inputSchema.properties.context.type).toBe("string");
    expect(byName.create_context.inputSchema.required).toEqual(["name"]);
    expect(Object.keys(byName.create_context.inputSchema.properties).sort()).toEqual(["cwd", "from", "name"]);
    expect(Object.keys(byName.create_guest_project.inputSchema.properties).sort()).toEqual(["cwd", "name"]);
    expect(Object.keys(byName.explain_run.inputSchema.properties).sort()).toEqual(["context", "cwd"]);
    expect(Object.keys(byName.ask_human_for_values.inputSchema.properties).sort()).toEqual(["context", "cwd"]);
    for (const name of ["status", "list_contexts", "explain_run", "ask_human_for_values"]) {
      expect(byName[name].annotations.readOnlyHint).toBe(true);
    }
    for (const name of ["declare_variables", "create_guest_project", "create_context"]) {
      expect(byName[name].annotations.readOnlyHint).toBe(false);
    }
  });
});

describe("tools", () => {
  it("declare_variables refuses an entry with a value, never echoes it, and sends nothing", async () => {
    linkedFolder();
    const server = createMcpServer({ apiUrl: API });
    const res = await call(server, "declare_variables", { names: ["API_KEY", `STRIPE_SECRET_KEY=${VALUE}`] });
    expect(res.result.isError).toBe(true);
    expect(res.result.content[0].text).toContain("names only");
    expect(JSON.stringify(res)).not.toContain(VALUE);
    expect(calls).toEqual([]);
  });

  it("declare_variables hides a value passed in place of a name", async () => {
    linkedFolder();
    const res = await call(createMcpServer({ apiUrl: API }), "declare_variables", { names: [VALUE] });
    expect(res.result.isError).toBe(true);
    expect(JSON.stringify(res)).not.toContain(VALUE);
    expect(calls).toEqual([]);
  });

  it("declare_variables declares names with no values", async () => {
    linkedFolder();
    const res = await call(createMcpServer({ apiUrl: API }), "declare_variables", { names: ["SENTRY_DSN", "DATABASE_URL"] });
    expect(res.result.isError).toBeUndefined();
    const post = calls.find((c) => c.method === "POST")!;
    expect(post.body).toEqual({ context: "development", values: [], declare: ["SENTRY_DSN", "DATABASE_URL"] });
    expect(res.result.structuredContent).toMatchObject({
      context: "development",
      declared: ["SENTRY_DSN"],
      existing: ["DATABASE_URL"],
      missing: ["STRIPE_SECRET_KEY", "SENTRY_DSN"],
    });
  });

  it("ask_human_for_values returns the missing names and the set --missing command", async () => {
    linkedFolder();
    const res = await call(createMcpServer({ apiUrl: API }), "ask_human_for_values");
    expect(res.result.structuredContent).toMatchObject({ missing: ["STRIPE_SECRET_KEY"], command: "npx getmyenv set --missing" });
    expect(res.result.content[0].text).toContain("hidden prompt");
  });

  it("ask_human_for_values refuses a Read-only context", async () => {
    linkedFolder();
    const res = await call(createMcpServer({ apiUrl: API }), "ask_human_for_values", { context: "production" });
    expect(res.result.isError).toBe(true);
    expect(res.result.content[0].text).toContain("Read-only");
  });

  it("explain_run lists names and sources, and what is not set", async () => {
    linkedFolder();
    const res = await call(createMcpServer({ apiUrl: API }), "explain_run");
    const text = res.result.content[0].text as string;
    expect(text).toContain("DATABASE_URL");
    expect(text).toContain("getmyenv (development)");
    expect(text).toContain("not set (missing in development)");
    expect(res.result.structuredContent).toMatchObject({ notSet: ["STRIPE_SECRET_KEY"], ready: false });
  });

  it("status reports a folder with no token with the CLI's next steps", async () => {
    const res = await call(createMcpServer({ apiUrl: API }), "status");
    expect(res.result.isError).toBe(true);
    expect(res.result.content[0].text).toContain(NOT_LINKED_STEPS);
    expect(calls).toEqual([]);
  });

  it("refuses a cwd that is not a folder", async () => {
    const res = await call(createMcpServer({ apiUrl: API }), "status", { cwd: path.join(dir, "nope") });
    expect(res.result.isError).toBe(true);
    expect(res.result.content[0].text).toContain("No folder at");
  });

  it("never returns the folder token from any tool", async () => {
    linkedFolder();
    const server = createMcpServer({ apiUrl: API });
    const out: string[] = [];
    for (const [name, args] of [
      ["status", {}],
      ["list_contexts", {}],
      ["declare_variables", { names: ["NEW_NAME"] }],
      ["create_context", { name: "Staging" }],
      ["explain_run", {}],
      ["explain_run", { context: "production" }],
      ["ask_human_for_values", {}],
      ["create_guest_project", {}],
    ] as const) {
      const res = await call(server, name, args);
      expect(res.error).toBeUndefined();
      out.push(JSON.stringify(res));
    }
    expect(out.join("\n")).not.toContain(TOKEN);
    // The token did go out, as the Authorization header, so the fixture was in use.
    expect(calls.some((c) => c.url.endsWith("/api/cli/whoami"))).toBe(true);
  });

  it("create_guest_project never returns the guest token or claim code", async () => {
    const res = await call(createMcpServer({ apiUrl: API }), "create_guest_project", { name: "Agent App" });
    const text = JSON.stringify(res);
    expect(res.result.isError).toBeUndefined();
    expect(text).not.toContain(GUEST_TOKEN);
    expect(text).not.toContain(CLAIM_CODE);
    expect(text).toContain("npx getmyenv claim");
    expect(res.result.structuredContent).toMatchObject({
      project: { name: "Agent App" },
      guestExpiresAt: "2027-01-01T00:00:00.000Z",
    });
    // Saved for the human in the folder, not returned.
    expect(fs.readFileSync(path.join(dir, ".getmyenv", "token.json"), "utf8")).toContain(GUEST_TOKEN);
  });
});

describe("mcp on stdio", () => {
  it("writes only JSON-RPC lines to stdout, and stops when stdin ends", async () => {
    const input = new PassThrough();
    const output = new PassThrough();
    const chunks: string[] = [];
    output.on("data", (c) => chunks.push(String(c)));
    const log = console.log;
    const done = mcpCommand({ apiUrl: API }, { input, output });
    input.write(`${JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18" } })}\n`);
    input.write(`${JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" })}\n`);
    input.write("\n");
    input.write("garbage\n");
    input.write(`${JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list" })}\n`);
    input.end();
    await done;
    console.log("this goes to stderr now");
    console.log = log;
    const lines = chunks.join("").split("\n").filter(Boolean);
    expect(lines).toHaveLength(3);
    const replies = lines.map((l) => JSON.parse(l));
    expect(replies.find((r) => r.id === 1).result.protocolVersion).toBe("2025-06-18");
    expect(replies.find((r) => r.id === 2).result.tools).toHaveLength(CLI_MCP_TOOLS.length);
    expect(replies.find((r) => r.id === null).error.code).toBe(-32700);
  });
});
