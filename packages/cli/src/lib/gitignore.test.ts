import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { FOLDER_DIR, FOLDER_FILES } from "@getmyenv/shared";
import { ensureGitignoreHasEnv } from "./fs.js";

describe("FOLDER_FILES matches the .gitignore the CLI writes", () => {
  let dir = "";
  afterEach(() => {
    if (dir) fs.rmSync(dir, { recursive: true, force: true });
  });

  it("ignores every gitignored file and none of the committed ones", () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "getmyenv-gitignore-"));
    fs.mkdirSync(path.join(dir, ".git"));
    ensureGitignoreHasEnv(dir);
    const lines = fs.readFileSync(path.join(dir, ".gitignore"), "utf8").split(/\r?\n/);
    for (const f of FOLDER_FILES) {
      expect(lines.includes(`${FOLDER_DIR}/${f.name}`), f.name).toBe(f.kind === "gitignored");
    }
  });
});
