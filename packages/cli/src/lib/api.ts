/**
 * CLI API client. Never prints plaintext values.
 */

import { createRequire } from "node:module";
import type { NewMachinePolicy } from "@getmyenv/shared";
import { readFolderToken, readFolderTokenLenient } from "./credentials.js";
import { pickApiUrl } from "./api-url.js";

/** From package.json, which ships with the package: src/lib and dist/lib are both two levels down. */
export const CLI_VERSION: string = (
  createRequire(import.meta.url)("../../package.json") as { version: string }
).version;

export { isDefaultApiUrl, parseSafeUrl } from "./api-url.js";

/** Short on purpose: a stuck process keeps npx's cache lock, so a second `npx getmyenv` waits silently. */
export const API_TIMEOUT_MS = 8_000;
/** A request still running after this prints one "Contacting" line on stderr. */
export const CONTACTING_AFTER_MS = 1_000;

let contactingPrinted = false;

/** Error thrown when a request runs past `API_TIMEOUT_MS`, headers and body together. */
export class RequestTimeoutError extends Error {
  constructor() {
    super("timed out");
    this.name = "TimeoutError";
  }
}

/**
 * Runs `work` with an abort signal and a hard deadline. The deadline rejects even
 * if the socket ignores the abort, and covers reading the body, not only the
 * headers. Timers are cleared when `work` settles, so nothing outlives the request.
 */
export async function withDeadline<T>(
  work: (signal: AbortSignal) => Promise<T>,
  opts: { timeoutMs?: number; contacting?: string } = {}
): Promise<T> {
  const timeoutMs = opts.timeoutMs ?? API_TIMEOUT_MS;
  const controller = new AbortController();
  let deadline: ReturnType<typeof setTimeout> | undefined;
  let contacting: ReturnType<typeof setTimeout> | undefined;
  const timedOut = new Promise<never>((_, reject) => {
    deadline = setTimeout(() => {
      const err = new RequestTimeoutError();
      controller.abort(err);
      reject(err);
    }, timeoutMs);
  });
  if (opts.contacting && !contactingPrinted) {
    const origin = opts.contacting;
    contacting = setTimeout(() => {
      contactingPrinted = true;
      process.stderr.write(`Contacting ${origin}...\n`);
    }, CONTACTING_AFTER_MS);
    contacting.unref?.();
  }
  try {
    const running = work(controller.signal);
    // After the deadline wins, the aborted work still rejects. Nobody awaits it then.
    running.catch(() => {});
    return await Promise.race([running, timedOut]);
  } finally {
    clearTimeout(deadline);
    clearTimeout(contacting);
  }
}

/** Test hook: lets the "Contacting" line print again. */
export function resetContactingForTests(): void {
  contactingPrinted = false;
}

export type Protection = "open" | "locked";
export type ValueStatus = "set" | "expiring_soon" | "expired" | "missing";

export type ContextInfo = {
  id: number;
  slug: string;
  name: string;
  protection: Protection;
};

export type WhoamiResponse = {
  project: { id: string; name: string };
  /** A Vault password (or guest passphrase) is set for this token's holder. */
  vaultSet: boolean;
  token: {
    kind: "folder" | "guest" | "server";
    label: string | null;
    /** Server tokens: the one read-only context they read. */
    context: string | null;
    allowedCidrs: string[];
    /** Server tokens: what happens when an untrusted machine reads. Null for other tokens. */
    newMachinePolicy: NewMachinePolicy | null;
    /** Folder token of a member on a shared project. Sees only the contexts shared with them. */
    member?: boolean;
  };
  user: { email: string } | null;
  isGuest: boolean;
  guestExpiresAt: string | null;
  contexts: ContextInfo[];
  keys: Array<{ name: string; status: Record<string, ValueStatus> }>;
};

export class ApiError extends Error {
  status: number;
  /** Machine-readable reason from the server, like `token_ended`. */
  code?: string;
  constructor(message: string, status: number, code?: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
  }
}

export function resolveApiUrl(cliOverride?: string): string {
  return pickApiUrl({
    override: cliOverride,
    env: process.env.GETMYENV_API_URL,
    tokenFile: readFolderTokenLenient()?.apiUrl,
  });
}

export class ApiClient {
  constructor(
    private baseUrl: string,
    private token?: string
  ) {}

  private headers(extra?: Record<string, string>): Record<string, string> {
    const h: Record<string, string> = {
      "Content-Type": "application/json",
      Accept: "application/json",
      "X-Getmyenv-CLI-Version": CLI_VERSION,
      ...extra,
    };
    if (this.token) h.Authorization = `Bearer ${this.token}`;
    return h;
  }

  async request<T>(
    method: string,
    path: string,
    body?: unknown,
    extraHeaders?: Record<string, string>
  ): Promise<T> {
    const url = `${this.baseUrl.replace(/\/$/, "")}${path}`;
    let origin = this.baseUrl;
    try {
      origin = new URL(url).origin;
    } catch {
      /* keep baseUrl */
    }
    try {
      return await withDeadline(
        async (signal) => {
          let res: Response;
          try {
            res = await fetch(url, {
              method,
              headers: this.headers(extraHeaders),
              body: body === undefined ? undefined : JSON.stringify(body),
              // The token must never follow a redirect to another host.
              redirect: "error",
              signal,
            });
          } catch (err) {
            throw networkError(
              err,
              `Could not reach ${this.baseUrl}. Check your connection, or the API URL (GETMYENV_API_URL or --api-url).`
            );
          }
          if (!res.ok) {
            let serverMessage: string | undefined;
            let code: string | undefined;
            try {
              const data = (await res.json()) as { error?: string; code?: unknown };
              serverMessage = data.error;
              if (typeof data.code === "string") code = data.code;
            } catch {
              /* ignore */
            }
            const message =
              res.status >= 500
                ? `The getmyenv server had an error (HTTP ${res.status}). Try again in a moment.`
                : (serverMessage ?? `HTTP ${res.status}`);
            throw new ApiError(message, res.status, code);
          }
          if (res.status === 204) return undefined as T;
          try {
            return (await res.json()) as T;
          } catch (err) {
            throw networkError(
              err,
              `The connection to ${this.baseUrl} closed before the answer arrived. Try again in a moment.`
            );
          }
        },
        { contacting: origin }
      );
    } catch (err) {
      if (err instanceof RequestTimeoutError) throw networkError(err, "");
      throw err;
    }
  }
}

function networkError(err: unknown, fallback: string): ApiError {
  if (err instanceof Error && err.name === "TimeoutError") {
    return new ApiError(
      `The getmyenv server did not answer within ${API_TIMEOUT_MS / 1000} seconds. Try again in a moment.`,
      0,
      "timeout"
    );
  }
  return new ApiError(fallback, 0);
}

/**
 * Env / folder token only, no prompt. A server token is `auth.privateKey`:
 * only the auth part is sent. The private key never leaves this machine.
 */
export function getSessionToken(): string | undefined {
  const env = process.env.GETMYENV_TOKEN?.trim();
  if (env) return env.split(".")[0];
  return readFolderToken()?.token;
}