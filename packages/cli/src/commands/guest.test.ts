import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { FACTS } from "@getmyenv/shared";
import { createGuestProject, guestNextLines } from "./guest.js";

describe("guestNextLines", () => {
  const lines = guestNextLines();
  const runAt = lines.findIndex((l) => l.includes("npx getmyenv run --"));
  const exportAt = lines.findIndex((l) => l.includes("npx getmyenv export"));
  const headingAt = lines.indexOf("Only if a tool needs a .env file:");

  it("lists run before export", () => {
    expect(runAt).toBeGreaterThan(0);
    expect(exportAt).toBeGreaterThan(runAt);
  });

  it("puts export under its own heading, after the main steps", () => {
    expect(headingAt).toBeGreaterThan(runAt);
    expect(exportAt).toBe(headingAt + 1);
  });

  it("ends with the agent sentences", () => {
    expect(lines[lines.length - 2]).toContain(FACTS.agentRunOrExport);
    expect(lines[lines.length - 1]).toContain(FACTS.agentSecretInput);
  });
});

describe("createGuestProject", () => {
  const prev = process.cwd();
  let dir = "";

  afterEach(() => {
    process.chdir(prev);
    vi.unstubAllGlobals();
    if (dir) fs.rmSync(dir, { recursive: true, force: true });
  });

  function folderWithProject(): string {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "getmyenv-guest-"));
    fs.mkdirSync(path.join(dir, ".git"));
    fs.mkdirSync(path.join(dir, ".getmyenv"));
    fs.writeFileSync(
      path.join(dir, ".getmyenv", "project.json"),
      JSON.stringify({ projectId: "old", projectName: "Old", context: "development" })
    );
    process.chdir(dir);
    return path.join(dir, ".getmyenv", "project.json");
  }

  it("refuses a folder with a token, and names its project", async () => {
    folderWithProject();
    fs.writeFileSync(
      path.join(dir, ".getmyenv", "token.json"),
      JSON.stringify({ version: 2, token: "t", projectId: "old", addedAt: "2026-01-01T00:00:00Z" })
    );
    const err = await createGuestProject({ apiUrl: "http://127.0.0.1:9" }).catch((e: Error) => e);
    expect(String(err)).toContain(
      "This folder is already linked to Old. See it: npx getmyenv status. To start over: npx getmyenv unlink, then npx getmyenv guest"
    );
  });

  it("goes ahead with a committed project.json and no token (a clone)", async () => {
    folderWithProject();
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
    await expect(createGuestProject({ apiUrl: "http://127.0.0.1:9" })).rejects.toThrow(/Could not create a guest project/);
  });

  it("replaces project.json once the new project exists, and says so", async () => {
    const meta = folderWithProject();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            projectId: "new",
            projectName: "New",
            token: "tok",
            claimCode: "code",
            guestExpiresAt: "2027-01-01T00:00:00Z",
            context: "development",
          }),
          { status: 200 }
        )
      )
    );
    const errors: string[] = [];
    vi.spyOn(console, "error").mockImplementation((...a: unknown[]) => void errors.push(a.join(" ")));
    await createGuestProject({ apiUrl: "http://127.0.0.1:9" });
    expect(JSON.parse(fs.readFileSync(meta, "utf8")).projectId).toBe("new");
    expect(errors.join("\n")).toContain("project.json now points to New. It pointed to Old.");
    vi.restoreAllMocks();
  });

  it("never writes over claim.json", async () => {
    folderWithProject();
    fs.writeFileSync(
      path.join(dir, ".getmyenv", "claim.json"),
      JSON.stringify({ claimCode: "c", passphrase: "p", projectId: "old" })
    );
    await expect(createGuestProject({ apiUrl: "http://127.0.0.1:9" })).rejects.toThrow(/Claim it: npx getmyenv claim/);
  });

  it("leaves project.json unchanged when the new project cannot be created", async () => {
    const meta = folderWithProject();
    const before = fs.readFileSync(meta, "utf8");
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
    await expect(
      createGuestProject({ apiUrl: "http://127.0.0.1:9", replaceProjectMeta: true })
    ).rejects.toThrow(/Could not create a guest project/);
    expect(fs.readFileSync(meta, "utf8")).toBe(before);
    expect(fs.existsSync(path.join(dir, ".getmyenv", "token.json"))).toBe(false);
    expect(fs.existsSync(path.join(dir, ".getmyenv", "claim.json"))).toBe(false);
  });
});
