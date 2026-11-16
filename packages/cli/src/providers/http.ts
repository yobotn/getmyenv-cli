import { withDeadline } from "../lib/api.js";

export class PlatformError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

function errorMessage(body: unknown): string | null {
  if (!body || typeof body !== "object") return null;
  const b = body as { error?: unknown; message?: unknown; code?: unknown };
  if (typeof b.message === "string") return b.message;
  if (b.error && typeof b.error === "object") {
    const e = b.error as { message?: unknown; code?: unknown };
    if (typeof e.message === "string") return e.message;
    if (typeof e.code === "string") return e.code;
  }
  if (typeof b.error === "string") return b.error;
  return null;
}

/**
 * One request to a platform API with the user's own token. No redirects,
 * fixed timeout. Error messages never include values we sent.
 */
export async function platformRequest<T>(opts: {
  title: string;
  base: string;
  token: string;
  method: "GET" | "POST" | "PATCH" | "DELETE";
  path: string;
  body?: unknown;
}): Promise<T> {
  let res: Response;
  let text: string;
  try {
    ({ res, text } = await withDeadline(async (signal) => {
      const res = await fetch(`${opts.base}${opts.path}`, {
        method: opts.method,
        headers: {
          authorization: `Bearer ${opts.token}`,
          ...(opts.body !== undefined ? { "content-type": "application/json" } : {}),
        },
        body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
        redirect: "error",
        signal,
      });
      return { res, text: await res.text() };
    }));
  } catch (err) {
    const why = err instanceof Error && err.name === "TimeoutError" ? "timed out" : "is unreachable";
    throw new PlatformError(`${opts.title} ${why}.`, 0);
  }
  let parsed: unknown = null;
  if (text) {
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = null;
    }
  }
  if (!res.ok) {
    if (res.status === 401 || res.status === 403) {
      throw new PlatformError(
        `${opts.title} refused the token (${res.status}). Check that it is valid and can reach this project.`,
        res.status
      );
    }
    const msg = errorMessage(parsed) ?? res.statusText ?? "request failed";
    throw new PlatformError(`${opts.title} returned ${res.status}: ${msg}`, res.status);
  }
  return parsed as T;
}
