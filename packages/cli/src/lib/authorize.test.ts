import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "./api.js";

const { writeFolderToken, writeProjectMeta } = vi.hoisted(() => ({ writeFolderToken: vi.fn(), writeProjectMeta: vi.fn() }));
vi.mock("./credentials.js", async (orig) => ({ ...(await orig<object>()), writeFolderToken }));
vi.mock("./fs.js", async (orig) => ({
  ...(await orig<object>()),
  ensureGitignoreHasEnv: vi.fn(),
  promptHidden: vi.fn(async () => "pasted_token"),
  readProjectMeta: vi.fn(() => ({ projectId: "p1", projectName: "Acme" })),
  writeProjectMeta,
}));

const {
  authorizeFolder,
  browserSignInFallsBack,
  isTransientPollError,
  otherProjectMessage,
  pollBackoffMs,
  pollWithRetry,
} = await import("./authorize.js");

const API = "http://127.0.0.1:9";
const ttyBefore = Object.getOwnPropertyDescriptor(process.stdin, "isTTY");

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

/** /api/cli-auth/start answers `start`; whoami says the token is for `projectId`. */
function stubServer(start: () => Response | Promise<Response>, projectId: string) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      const p = new URL(url).pathname;
      if (p === "/api/cli-auth/start") return start();
      if (p === "/api/cli/whoami") return json({ project: { id: projectId, name: projectId === "p1" ? "Acme" : "Other" } });
      return json({ error: "not found" }, 404);
    })
  );
}

beforeEach(() => {
  Object.defineProperty(process.stdin, "isTTY", { value: true, configurable: true });
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  writeFolderToken.mockReset();
  writeProjectMeta.mockReset();
});

afterEach(() => {
  if (ttyBefore) Object.defineProperty(process.stdin, "isTTY", ttyBefore);
  else delete (process.stdin as { isTTY?: boolean }).isTTY;
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("browser sign-in fallback", () => {
  it("pastes a token only when browser sign-in is missing or broken", () => {
    expect(browserSignInFallsBack(new ApiError("x", 404))).toBe(true);
    expect(browserSignInFallsBack(new ApiError("x", 500))).toBe(true);
    expect(browserSignInFallsBack(new ApiError("x", 503))).toBe(true);
    expect(browserSignInFallsBack(new ApiError("Update the CLI", 426))).toBe(false);
    expect(browserSignInFallsBack(new ApiError("Slow down", 429))).toBe(false);
    expect(browserSignInFallsBack(new ApiError("Could not reach", 0))).toBe(false);
    expect(browserSignInFallsBack(new ApiError("timeout", 0, "timeout"))).toBe(false);
    expect(browserSignInFallsBack(new Error("x"))).toBe(false);
  });

  it("rethrows a 426 instead of asking for a token", async () => {
    stubServer(() => json({ error: "This CLI is too old. Update: npx getmyenv@latest" }, 426), "p1");
    await expect(authorizeFolder({ apiUrl: API })).rejects.toThrow("This CLI is too old");
    expect(writeFolderToken).not.toHaveBeenCalled();
  });

  it("rethrows an unreachable server", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("fetch failed")));
    await expect(authorizeFolder({ apiUrl: API })).rejects.toThrow("Could not reach");
  });

  it("falls back to paste on a 404", async () => {
    stubServer(() => json({ error: "not found" }, 404), "p1");
    const who = await authorizeFolder({ apiUrl: API });
    expect(who.project.id).toBe("p1");
    expect(writeFolderToken).toHaveBeenCalledWith({ token: "pasted_token", apiUrl: API, projectId: "p1" });
  });
});

describe("a folder that belongs to another project", () => {
  it("saves nothing when the sign-in picked a different project", async () => {
    stubServer(() => json({ error: "not found" }, 404), "p2");
    await expect(authorizeFolder({ apiUrl: API, expected: { id: "p1", name: "Acme" } })).rejects.toThrow(
      otherProjectMessage("Acme", "Other")
    );
    expect(writeFolderToken).not.toHaveBeenCalled();
    expect(writeProjectMeta).not.toHaveBeenCalled();
  });

  it("links as before when the project matches", async () => {
    stubServer(() => json({ error: "not found" }, 404), "p1");
    await authorizeFolder({ apiUrl: API, expected: { id: "p1", name: "Acme" } });
    expect(writeProjectMeta).toHaveBeenCalled();
  });

  it("says to ask for an invite", () => {
    const msg = otherProjectMessage("Acme", "Other");
    expect(msg).toContain("This folder belongs to Acme");
    expect(msg).toContain("ask the owner for an invite");
    expect(msg).toContain("Nothing was saved.");
  });
});

describe("pollWithRetry", () => {
  function clock() {
    let t = 0;
    const waits: number[] = [];
    return {
      waits,
      now: () => t,
      wait: async (ms: number) => {
        waits.push(ms);
        t += ms;
      },
    };
  }

  it("retries network errors, timeouts, 5xx and 429 with backoff", async () => {
    const c = clock();
    const errors = [
      new ApiError("down", 0),
      new ApiError("timeout", 0, "timeout"),
      new ApiError("oops", 502),
      new ApiError("slow", 429),
    ];
    const poll = vi.fn(async () => {
      const err = errors.shift();
      if (err) throw err;
      return { status: "approved" };
    });
    expect(await pollWithRetry(poll, 60_000, c)).toEqual({ status: "approved" });
    expect(poll).toHaveBeenCalledTimes(5);
    expect(c.waits).toEqual([2000, 4000, 8000, 15_000]);
  });

  it("stops on a definitive error", async () => {
    const c = clock();
    const poll = vi.fn(async () => {
      throw new ApiError("Session not found", 404);
    });
    await expect(pollWithRetry(poll, 60_000, c)).rejects.toThrow("Session not found");
    expect(poll).toHaveBeenCalledTimes(1);
  });

  it("gives up at the deadline", async () => {
    const c = clock();
    const poll = vi.fn(async () => {
      throw new ApiError("down", 0);
    });
    expect(await pollWithRetry(poll, 10_000, c)).toBeNull();
    expect(c.waits.reduce((a, b) => a + b, 0)).toBe(10_000);
  });

  it("classifies errors and caps the backoff", () => {
    expect(isTransientPollError(new ApiError("x", 401))).toBe(false);
    expect(isTransientPollError(new ApiError("x", 410))).toBe(false);
    expect(isTransientPollError(new Error("x"))).toBe(false);
    expect(pollBackoffMs(10)).toBe(15_000);
  });
});
