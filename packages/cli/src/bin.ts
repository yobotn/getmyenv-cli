#!/usr/bin/env node
import { formatCliError } from "@getmyenv/shared";
import { runCli } from "./cli.js";
import { ApiError, cliErrorLines } from "./lib/api.js";
import { maybeSuggestUpdate } from "./lib/update-check.js";

/** After a timeout, how long the event loop may take to drain before we force the exit. */
const EXIT_GRACE_MS = 1_000;

async function main(): Promise<void> {
  await maybeSuggestUpdate();
  await runCli(process.argv);
}

main().catch((err: unknown) => {
  // Never print secret values: the message and the server's hint only.
  const [message, ...rest] = cliErrorLines(err);
  console.error([formatCliError(message!), ...rest].join("\n"));
  // Not process.exit(): on Windows it can abort while sockets are still closing.
  process.exitCode = process.exitCode ? Number(process.exitCode) : 1;
  // A stalled socket can ignore the abort and keep the process (and npx's cache lock)
  // alive. Give it a moment to close, then exit anyway. unref: a clean drain wins.
  if (err instanceof ApiError && err.code === "timeout") {
    setTimeout(() => process.exit(), EXIT_GRACE_MS).unref();
  }
});
