import { afterEach, describe, expect, it, vi } from "vitest";
import { TOKEN_ENDED_CODE } from "@getmyenv/shared";
import { ApiError, type ApiClient } from "./api.js";
import { fetchWhoami, NOT_LINKED_STEPS, notLinkedMessage } from "./bootstrap.js";

function failingClient(err: Error): ApiClient {
  return { request: vi.fn().mockRejectedValue(err) } as unknown as ApiClient;
}

describe("notLinkedMessage", () => {
  it("names the project of a clone with project.json", () => {
    const msg = notLinkedMessage({ projectId: "p1", projectName: "Acme" });
    expect(msg).toContain("This folder belongs to Acme, but this machine has no token for it.");
    expect(msg).toContain("In a terminal: npx getmyenv (sign in)");
    expect(msg).not.toContain("not linked");
  });

  it("keeps the generic steps without project.json", () => {
    expect(notLinkedMessage(null)).toBe(NOT_LINKED_STEPS);
  });
});

describe("fetchWhoami", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("prints the server's reason when the token ended", async () => {
    const reason = 'The project "my-app" was deleted. Its values are no longer available.';
    const client = failingClient(new ApiError(reason, 401, TOKEN_ENDED_CODE));
    await expect(fetchWhoami(client)).rejects.toThrow(reason);
  });

  it("keeps the generic message for a 401 without a reason", async () => {
    vi.stubEnv("GETMYENV_TOKEN", "");
    const client = failingClient(new ApiError("Unauthorized", 401));
    await expect(fetchWhoami(client)).rejects.toThrow("This folder's token no longer works");
  });
});
