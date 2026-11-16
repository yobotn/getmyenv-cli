import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { restrictToOwner } from "./private-file.js";

describe("restrictToOwner", () => {
  it("leaves only this user on the file, and it stays readable", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "getmyenv-acl-"));
    const file = path.join(dir, "token.json");
    fs.writeFileSync(file, "{}");
    try {
      restrictToOwner(file);
      expect(fs.readFileSync(file, "utf8")).toBe("{}");
      if (process.platform === "win32") {
        const acl = execFileSync("icacls", [file]).toString();
        expect(acl).not.toContain("(I)");
        expect(acl).toContain(`${os.userInfo().username}:(F)`);
      } else {
        expect(fs.statSync(file).mode & 0o777).toBe(0o600);
      }
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
