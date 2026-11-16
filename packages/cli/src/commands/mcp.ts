import readline from "node:readline";
import type { Readable, Writable } from "node:stream";
import { CLI_VERSION } from "../lib/api.js";
import { McpServer } from "../lib/mcp-protocol.js";
import { getmyenvTools, MCP_INSTRUCTIONS } from "./mcp-tools.js";

export type McpOpts = { apiUrl?: string };

export function createMcpServer(opts: McpOpts = {}): McpServer {
  return new McpServer({ name: "getmyenv", title: "getmyenv", version: CLI_VERSION }, getmyenvTools(opts), MCP_INSTRUCTIONS);
}

/**
 * Serve MCP on stdio: one JSON-RPC message per line on stdin, replies on stdout.
 * stdout carries protocol messages only. Every log line goes to stderr.
 * stdin is the protocol, never a terminal, so nothing here prompts.
 */
export async function mcpCommand(
  opts: McpOpts = {},
  io: { input: Readable; output: Writable } = { input: process.stdin, output: process.stdout }
): Promise<void> {
  // Code paths that would prompt check isTTY. The protocol owns stdin: never prompt on it.
  Object.defineProperty(process.stdin, "isTTY", { value: false, configurable: true });
  // Any console.log from shared CLI code would corrupt the protocol. Send it to stderr.
  const toStderr = (...args: unknown[]) => console.error(...args);
  console.log = toStderr;
  console.info = toStderr;
  console.debug = toStderr;

  const server = createMcpServer(opts);
  const rl = readline.createInterface({ input: io.input, crlfDelay: Infinity, terminal: false });
  const pending = new Set<Promise<void>>();
  for await (const raw of rl) {
    const line = raw.trim();
    if (!line) continue;
    // Requests run at the same time; tool calls queue among themselves (see mcp-tools).
    const p = server
      .handleLine(line)
      .then((reply) => {
        if (reply) io.output.write(`${reply}\n`);
      })
      .catch((err: unknown) => {
        console.error(`getmyenv mcp: ${err instanceof Error ? err.message : String(err)}`);
      })
      .finally(() => pending.delete(p));
    pending.add(p);
  }
  await Promise.all(pending);
}
