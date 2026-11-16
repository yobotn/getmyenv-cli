/**
 * Background child of the update check: fetch the npm latest version and write
 * the cache file. Run as `node update-check-worker.js <cache-file> <timeout-ms>`.
 * A file of its own, not `node -e`, so the package runs no generated code.
 * Fails open: any error leaves the cache as it was.
 */

import fs from "node:fs";
import path from "node:path";

async function fetchAndCache(file: string, timeoutMs: number): Promise<void> {
  const ctrl = new AbortController();
  setTimeout(() => ctrl.abort(), timeoutMs).unref();
  try {
    const res = await fetch("https://registry.npmjs.org/getmyenv/latest", {
      signal: ctrl.signal,
      redirect: "error",
    });
    if (!res.ok) return;
    const data = (await res.json()) as { version?: unknown };
    if (typeof data.version !== "string" || !/^\d+\.\d+\.\d+/.test(data.version)) return;
    fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
    fs.writeFileSync(file, JSON.stringify({ latest: data.version, checkedAt: new Date().toISOString() }), {
      mode: 0o600,
    });
  } catch {
    /* fail open */
  }
}

const [file, timeout] = process.argv.slice(2);
const timeoutMs = Number(timeout);
if (file && Number.isFinite(timeoutMs) && timeoutMs > 0) {
  void fetchAndCache(file, timeoutMs);
}
