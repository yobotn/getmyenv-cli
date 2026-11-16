import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const contexts: Array<{ id: number; slug: string; name: string; protection: string }> = [];

vi.mock("../lib/bootstrap.js", () => ({
  ensureTokenAndLink: vi.fn(async () => ({ who: { contexts, token: { kind: "folder", context: null } }, meta: {} })),
}));

const { contextListCommand } = await import("./context.js");

let out: string[] = [];
beforeEach(() => {
  out = [];
  contexts.length = 0;
  vi.spyOn(console, "log").mockImplementation((...a: unknown[]) => void out.push(a.join(" ")));
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe("context list", () => {
  it("prints a next step when there are no contexts", async () => {
    await contextListCommand({});
    expect(out.join("\n")).toContain("No contexts yet. Add one: npx getmyenv context create staging");
  });

  it("lists contexts", async () => {
    contexts.push({ id: 1, slug: "development", name: "Development", protection: "open" });
    await contextListCommand({});
    expect(out.join("\n")).toContain("development");
    expect(out.join("\n")).not.toContain("No contexts yet");
  });
});
