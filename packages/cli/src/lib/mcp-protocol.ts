/**
 * A small Model Context Protocol server: JSON-RPC 2.0, one message per line.
 * Handles initialize, ping, tools/list and tools/call. No dependencies.
 * Transport-free: `handleLine` takes one line and returns the reply line, or null.
 */

export const MCP_PROTOCOL_VERSION = "2025-06-18";
/** Versions this server speaks, newest first. */
export const MCP_SUPPORTED_VERSIONS = [MCP_PROTOCOL_VERSION, "2025-03-26", "2024-11-05"];

export const JSONRPC_PARSE_ERROR = -32700;
export const JSONRPC_INVALID_REQUEST = -32600;
export const JSONRPC_METHOD_NOT_FOUND = -32601;
export const JSONRPC_INVALID_PARAMS = -32602;
export const JSONRPC_INTERNAL_ERROR = -32603;

export type JsonRpcId = string | number;

export type JsonSchema = {
  type: "object" | "string" | "array";
  description?: string;
  properties?: Record<string, JsonSchema>;
  required?: string[];
  additionalProperties?: boolean;
  items?: JsonSchema;
  minItems?: number;
  maxItems?: number;
  minLength?: number;
  maxLength?: number;
};

export type ToolAnnotations = {
  title?: string;
  readOnlyHint: boolean;
  destructiveHint: boolean;
  idempotentHint: boolean;
  openWorldHint: boolean;
};

export type ToolResult = {
  content: Array<{ type: "text"; text: string }>;
  structuredContent?: Record<string, unknown>;
  isError?: boolean;
};

export type McpTool = {
  name: string;
  title: string;
  description: string;
  inputSchema: JsonSchema & { type: "object" };
  annotations: ToolAnnotations;
  run: (args: Record<string, unknown>) => Promise<ToolResult>;
};

export type ServerInfo = { name: string; title?: string; version: string };

type Reply = { jsonrpc: "2.0"; id: JsonRpcId | null } & (
  | { result: unknown }
  | { error: { code: number; message: string; data?: unknown } }
);

class RpcError extends Error {
  constructor(
    readonly code: number,
    message: string
  ) {
    super(message);
  }
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function isId(v: unknown): v is JsonRpcId {
  return typeof v === "string" || (typeof v === "number" && Number.isFinite(v));
}

/**
 * Check `value` against the small JSON Schema subset the tools use.
 * Returns the first problem, or null.
 */
export function schemaError(schema: JsonSchema, value: unknown, at = "arguments"): string | null {
  if (schema.type === "object") {
    if (!isObject(value)) return `${at} must be an object.`;
    for (const key of schema.required ?? []) {
      if (value[key] === undefined) return `${at}.${key} is required.`;
    }
    for (const [key, v] of Object.entries(value)) {
      const sub = schema.properties?.[key];
      if (!sub) {
        if (schema.additionalProperties === false) return `${at}.${key} is not a known argument.`;
        continue;
      }
      if (v === undefined) continue;
      const err = schemaError(sub, v, `${at}.${key}`);
      if (err) return err;
    }
    return null;
  }
  if (schema.type === "string") {
    if (typeof value !== "string") return `${at} must be a string.`;
    if (schema.minLength !== undefined && value.length < schema.minLength) return `${at} is too short.`;
    if (schema.maxLength !== undefined && value.length > schema.maxLength) return `${at} is too long.`;
    return null;
  }
  if (!Array.isArray(value)) return `${at} must be an array.`;
  if (schema.minItems !== undefined && value.length < schema.minItems) {
    return `${at} needs at least ${schema.minItems} item${schema.minItems === 1 ? "" : "s"}.`;
  }
  if (schema.maxItems !== undefined && value.length > schema.maxItems) {
    return `${at} takes at most ${schema.maxItems} items.`;
  }
  if (schema.items) {
    for (let i = 0; i < value.length; i++) {
      const err = schemaError(schema.items, value[i], `${at}[${i}]`);
      if (err) return err;
    }
  }
  return null;
}

export class McpServer {
  private readonly byName: Map<string, McpTool>;

  constructor(
    private readonly info: ServerInfo,
    private readonly tools: McpTool[],
    private readonly instructions?: string
  ) {
    this.byName = new Map(tools.map((t) => [t.name, t]));
  }

  /** One line in, one reply line out (no trailing newline), or null for notifications. */
  async handleLine(line: string): Promise<string | null> {
    let message: unknown;
    try {
      message = JSON.parse(line);
    } catch {
      return JSON.stringify(this.error(null, JSONRPC_PARSE_ERROR, "Parse error"));
    }
    const reply = await this.handleMessage(message);
    return reply ? JSON.stringify(reply) : null;
  }

  async handleMessage(message: unknown): Promise<Reply | null> {
    if (!isObject(message)) {
      // Batches were removed from MCP in 2025-06-18.
      return this.error(null, JSONRPC_INVALID_REQUEST, "Invalid Request");
    }
    const hasId = "id" in message && message.id !== undefined;
    const id = hasId && isId(message.id) ? message.id : null;
    if (message.jsonrpc !== "2.0" || (hasId && !isId(message.id))) {
      return this.error(id, JSONRPC_INVALID_REQUEST, "Invalid Request");
    }
    if (typeof message.method !== "string") {
      // A response from the client (to a request this server never sends): ignore it.
      if (hasId && ("result" in message || "error" in message)) return null;
      return this.error(id, JSONRPC_INVALID_REQUEST, "Invalid Request");
    }
    if (message.params !== undefined && !isObject(message.params) && !Array.isArray(message.params)) {
      return hasId ? this.error(id, JSONRPC_INVALID_REQUEST, "Invalid Request") : null;
    }
    // Notifications (initialized, cancelled, ...) get no reply.
    if (!hasId) return null;

    const params = isObject(message.params) ? message.params : {};
    try {
      const result = await this.dispatch(message.method, params);
      return { jsonrpc: "2.0", id, result };
    } catch (err) {
      if (err instanceof RpcError) return this.error(id, err.code, err.message);
      return this.error(id, JSONRPC_INTERNAL_ERROR, err instanceof Error ? err.message : "Internal error");
    }
  }

  private async dispatch(method: string, params: Record<string, unknown>): Promise<unknown> {
    switch (method) {
      case "initialize": {
        const asked = params.protocolVersion;
        const protocolVersion =
          typeof asked === "string" && MCP_SUPPORTED_VERSIONS.includes(asked) ? asked : MCP_PROTOCOL_VERSION;
        return {
          protocolVersion,
          capabilities: { tools: {} },
          serverInfo: this.info,
          ...(this.instructions ? { instructions: this.instructions } : {}),
        };
      }
      case "ping":
        return {};
      case "tools/list":
        return {
          tools: this.tools.map((t) => ({
            name: t.name,
            title: t.title,
            description: t.description,
            inputSchema: t.inputSchema,
            annotations: { title: t.title, ...t.annotations },
          })),
        };
      case "tools/call":
        return this.callTool(params);
      default:
        throw new RpcError(JSONRPC_METHOD_NOT_FOUND, `Method not found: ${method}`);
    }
  }

  private async callTool(params: Record<string, unknown>): Promise<ToolResult> {
    const name = params.name;
    if (typeof name !== "string") throw new RpcError(JSONRPC_INVALID_PARAMS, "params.name must be a tool name.");
    const tool = this.byName.get(name);
    if (!tool) throw new RpcError(JSONRPC_INVALID_PARAMS, `Unknown tool: ${name}`);
    const args = params.arguments ?? {};
    const invalid = schemaError(tool.inputSchema, args);
    if (invalid) throw new RpcError(JSONRPC_INVALID_PARAMS, `Invalid arguments for ${name}: ${invalid}`);
    try {
      return await tool.run(args as Record<string, unknown>);
    } catch (err) {
      // A failed call is a tool result the agent can read, not a protocol error. Message only.
      return toolError(err instanceof Error ? err.message : "Unexpected error");
    }
  }

  private error(id: JsonRpcId | null, code: number, message: string): Reply {
    return { jsonrpc: "2.0", id, error: { code, message } };
  }
}

export function toolText(text: string, structuredContent?: Record<string, unknown>): ToolResult {
  return { content: [{ type: "text", text }], ...(structuredContent ? { structuredContent } : {}) };
}

export function toolError(text: string): ToolResult {
  return { content: [{ type: "text", text }], isError: true };
}
