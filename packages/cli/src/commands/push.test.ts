import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { pushFingerprint } from "@getmyenv/crypto";

const key = new Uint8Array(32).fill(7);
const values = { API_KEY: "sk_live_x", NEXT_PUBLIC_URL: "https://x" };
const request = vi.fn();

vi.mock("../lib/bootstrap.js", () => ({
  ensureTokenAndLink: vi.fn(async () => ({
    who: { isGuest: false, project: { id: "p1" }, contexts: [{ id: 1, slug: "production", name: "Production", protection: "locked" }] },
    meta: {},
    client: { request },
  })),
}));
vi.mock("../lib/context.js", () => ({
  resolveContext: () => ({ id: 1, slug: "production", name: "Production", protection: "locked" }),
}));
vi.mock("../lib/read-context.js", () => ({
  readContextValues: vi.fn(async () => ({ values, missing: [], key })),
}));
const apply = vi.fn();
vi.mock("../providers/vercel.js", () => ({
  createVercelAdapter: () => ({
    id: "vercel",
    title: "Vercel",
    target: "production",
    isReserved: () => false,
    typeFor: (n: string) => (n.startsWith("NEXT_PUBLIC_") ? "readable" : "sensitive"),
    check: () => ({ skip: [], warnings: [] }),
    planNotes: () => [],
    destination: async () => ({
      provider: "vercel",
      title: "Vercel",
      externalId: "prj_1",
      externalName: "web",
      ownerSlug: "acme",
      label: "acme/web",
      target: "production",
    }),
    remoteNames: async () => ["API_KEY"],
    apply,
  }),
}));

const { pushCommand } = await import("./push.js");

let out: string[] = [];
beforeEach(() => {
  out = [];
  vi.spyOn(console, "log").mockImplementation((...a: unknown[]) => {
    out.push(a.join(" "));
  });
  request.mockReset();
  apply.mockReset();
  vi.stubEnv("VERCEL_TOKEN", "tok");
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe("push", () => {
  it("asks for the platform token once the folder is linked", async () => {
    vi.stubEnv("VERCEL_TOKEN", "");
    await expect(pushCommand("vercel", {})).rejects.toThrow(/VERCEL_TOKEN/);
  });

  it("tells a guest to claim before asking for a platform token", async () => {
    vi.stubEnv("VERCEL_TOKEN", "");
    const { ensureTokenAndLink } = await import("../lib/bootstrap.js");
    vi.mocked(ensureTokenAndLink).mockResolvedValueOnce({
      who: { isGuest: true },
    } as unknown as Awaited<ReturnType<typeof ensureTokenAndLink>>);
    await expect(pushCommand("vercel", {})).rejects.toThrow(/npx getmyenv claim/);
  });

  it("refuses unknown providers and targets", async () => {
    await expect(pushCommand("heroku", {})).rejects.toThrow(/vercel or netlify/);
    await expect(pushCommand("vercel", { target: "staging" })).rejects.toThrow(/--target/);
  });

  it("dry-run prints names and types, never values, and writes nothing", async () => {
    request.mockResolvedValue({
      pushes: [{ provider: "vercel", externalId: "prj_1", target: "production", fingerprint: pushFingerprint(key, values) }],
    });
    await pushCommand("vercel", { dryRun: true });
    const text = out.join("\n");
    expect(text).toContain("API_KEY");
    expect(text).toContain("readable");
    expect(text).not.toContain("sk_live_x");
    expect(text).toContain("No changes in getmyenv since the last push to Vercel acme/web (Production).");
    expect(apply).not.toHaveBeenCalled();
    expect(request).toHaveBeenCalledWith("GET", "/api/cli/push?context=production");
  });

  it("pushes with --yes, prints the summary and records names and a fingerprint", async () => {
    apply.mockResolvedValue({
      written: [
        { name: "API_KEY", type: "sensitive" },
        { name: "NEXT_PUBLIC_URL", type: "readable" },
      ],
      pruned: [],
      notPruned: [],
      notWritten: [],
      notes: [],
    });
    request.mockResolvedValue({ ok: true });
    await pushCommand("vercel", { yes: true });
    const text = out.join("\n");
    expect(text).toContain("Pushed 2 variables to Vercel acme/web (Production). Readable: 1. Sensitive: 1.");
    expect(text).toContain("That copy lives in Vercel.");
    expect(text).toContain("Future changes in getmyenv are not pushed automatically.");
    const body = request.mock.calls.find((c) => c[0] === "POST")?.[2] as Record<string, unknown>;
    expect(body.names).toEqual(["API_KEY", "NEXT_PUBLIC_URL"]);
    expect(body.fingerprint).toBe(pushFingerprint(key, values));
    expect(JSON.stringify(body)).not.toContain("sk_live_x");
  });

  it("exits 1 when a variable could not be pruned", async () => {
    apply.mockResolvedValue({
      written: [{ name: "API_KEY", type: "sensitive" }],
      pruned: [],
      notPruned: [{ name: "OLD_KEY", reason: "403 Forbidden" }],
      notWritten: [],
      notes: [],
    });
    request.mockResolvedValue({ ok: true });
    const before = process.exitCode;
    try {
      process.exitCode = undefined;
      await pushCommand("vercel", { yes: true, prune: true });
      expect(process.exitCode).toBe(1);
      expect(out.join("\n")).toContain("Not pruned:");
    } finally {
      process.exitCode = before;
    }
  });

  it("exits 0 when everything was pushed and pruned", async () => {
    apply.mockResolvedValue({
      written: [{ name: "API_KEY", type: "sensitive" }],
      pruned: ["OLD_KEY"],
      notPruned: [],
      notWritten: [],
      notes: [],
    });
    request.mockResolvedValue({ ok: true });
    const before = process.exitCode;
    try {
      process.exitCode = undefined;
      await pushCommand("vercel", { yes: true, prune: true });
      expect(process.exitCode).toBeUndefined();
    } finally {
      process.exitCode = before;
    }
  });
});
