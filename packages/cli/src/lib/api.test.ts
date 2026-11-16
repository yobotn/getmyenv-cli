import { afterEach, describe, expect, it, vi } from "vitest";
import { API_TIMEOUT_MS, ApiClient, ApiError, cliErrorLines, CONTACTING_AFTER_MS, resetContactingForTests } from "./api.js";

const client = new ApiClient("http://localhost:1", "tok");

function failWith(err: Error) {
  vi.stubGlobal("fetch", vi.fn().mockRejectedValue(err));
}

async function errorOf(p: Promise<unknown>): Promise<ApiError> {
  try {
    await p;
  } catch (err) {
    expect(err).toBeInstanceOf(ApiError);
    return err as ApiError;
  }
  throw new Error("expected a rejection");
}

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  resetContactingForTests();
});

describe("ApiClient.request", () => {
  it("passes a timeout signal to fetch", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    await client.request("GET", "/x");
    expect(fetchMock.mock.calls[0][1].signal).toBeInstanceOf(AbortSignal);
  });

  it("says the server did not answer on a timeout", async () => {
    failWith(new DOMException("timed out", "TimeoutError"));
    const err = await errorOf(client.request("GET", "/x"));
    expect(err.status).toBe(0);
    expect(err.message).toBe("The getmyenv server did not answer within 8 seconds. Try again in a moment.");
  });

  it("gives up after the deadline even when fetch ignores the abort", async () => {
    vi.useFakeTimers();
    vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    vi.stubGlobal("fetch", vi.fn(() => new Promise(() => {})));
    const p = errorOf(client.request("GET", "/x"));
    await vi.advanceTimersByTimeAsync(API_TIMEOUT_MS);
    const err = await p;
    expect(err.code).toBe("timeout");
    expect(err.message).toContain("within 8 seconds");
  });

  it("times out while reading a stalled body", async () => {
    vi.useFakeTimers();
    vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    const res = new Response("{}", { status: 200 });
    vi.spyOn(res, "json").mockReturnValue(new Promise(() => {}));
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(res));
    const p = errorOf(client.request("GET", "/x"));
    await vi.advanceTimersByTimeAsync(API_TIMEOUT_MS);
    expect((await p).code).toBe("timeout");
  });

  it("prints one Contacting line only when a request is slow", async () => {
    vi.useFakeTimers();
    const write = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    let finish!: (r: Response) => void;
    vi.stubGlobal("fetch", vi.fn(() => new Promise<Response>((r) => (finish = r))));
    const p = client.request("GET", "/x");
    await vi.advanceTimersByTimeAsync(CONTACTING_AFTER_MS - 1);
    expect(write).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(write).toHaveBeenCalledWith("Contacting http://localhost:1...\n");
    finish(new Response("{}", { status: 200 }));
    await p;
    expect(vi.getTimerCount()).toBe(0);
  });

  it("stays quiet and leaves no timers on a quick answer", async () => {
    vi.useFakeTimers();
    const write = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("{}", { status: 200 })));
    await client.request("GET", "/x");
    expect(vi.getTimerCount()).toBe(0);
    expect(write).not.toHaveBeenCalled();
  });

  it("says it could not reach the server when the connection fails", async () => {
    failWith(new TypeError("fetch failed"));
    const err = await errorOf(client.request("GET", "/x"));
    expect(err.message).toBe(
      "Could not reach http://localhost:1. Check your connection, or the API URL (GETMYENV_API_URL or --api-url)."
    );
  });

  it("says the connection closed when the body is cut off", async () => {
    const res = new Response("{}", { status: 200 });
    vi.spyOn(res, "json").mockRejectedValue(new TypeError("terminated"));
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(res));
    const err = await errorOf(client.request("GET", "/x"));
    expect(err.message).toContain("closed before the answer arrived");
  });

  it("hides the server message on a 5xx", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: "stack trace" }), { status: 503 }))
    );
    const err = await errorOf(client.request("GET", "/x"));
    expect(err.status).toBe(503);
    expect(err.message).toBe("The getmyenv server had an error (HTTP 503). Try again in a moment.");
  });
});

describe("API error hints", () => {
  function respond(body: unknown, status: number) {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify(body), { status })));
  }

  it("keeps the server's code and hint on a 4xx", async () => {
    respond({ error: "Token ended.", code: "token_ended", hint: "Run npx getmyenv to sign in.", docs: "https://x" }, 401);
    const err = await errorOf(client.request("GET", "/x"));
    expect(err.message).toBe("Token ended.");
    expect(err.code).toBe("token_ended");
    expect(err.hint).toBe("Run npx getmyenv to sign in.");
  });

  it("ignores a hint that is not text", async () => {
    respond({ error: "Bad.", code: "bad_request", hint: 42 }, 400);
    expect((await errorOf(client.request("GET", "/x"))).hint).toBeUndefined();
  });

  it("drops the hint on a 5xx", async () => {
    respond({ error: "boom", code: "internal_error", hint: "Contact support." }, 500);
    const err = await errorOf(client.request("GET", "/x"));
    expect(err.hint).toBeUndefined();
    expect(cliErrorLines(err)).toEqual(["The getmyenv server had an error (HTTP 500). Try again in a moment."]);
  });

  it("prints the hint as a second line", () => {
    expect(cliErrorLines(new ApiError("Token ended.", 401, "token_ended", "Run npx getmyenv to sign in."))).toEqual([
      "Token ended.",
      "Run npx getmyenv to sign in.",
    ]);
    expect(cliErrorLines(new ApiError("No hint.", 400))).toEqual(["No hint."]);
    expect(cliErrorLines(new Error("Plain."))).toEqual(["Plain."]);
    expect(cliErrorLines("x")).toEqual(["Unexpected error"]);
  });
});
