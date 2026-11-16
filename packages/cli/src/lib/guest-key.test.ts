import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { resolveVaultPassword } from "./guest-key.js";

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe("resolveVaultPassword", () => {
  it("uses claim.json passphrase for guest without prompting", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "getmyenv-guest-key-"));
    tempDirs.push(dir);
    const localDir = path.join(dir, ".getmyenv");
    fs.mkdirSync(localDir, { recursive: true });
    fs.writeFileSync(
      path.join(localDir, "claim.json"),
      JSON.stringify({
        claimCode: "test-code",
        passphrase: "guest-passphrase-value",
        projectId: "1",
        projectName: "demo",
        guestExpiresAt: new Date(Date.now() + 86400000).toISOString(),
      }),
      "utf8"
    );

    const prev = process.cwd();
    process.chdir(dir);
    try {
      const password = await resolveVaultPassword({ isGuest: true });
      expect(password).toBe("guest-passphrase-value");
    } finally {
      process.chdir(prev);
    }
  });

  it("errors when guest is missing claim.json", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "getmyenv-guest-key-"));
    tempDirs.push(dir);
    const prev = process.cwd();
    process.chdir(dir);
    try {
      await expect(resolveVaultPassword({ isGuest: true })).rejects.toThrow(
        /claim\.json/
      );
    } finally {
      process.chdir(prev);
    }
  });
});
