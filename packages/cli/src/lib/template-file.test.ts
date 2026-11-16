import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TEMPLATE_FILE_MAX_KEYS } from "@getmyenv/shared";
import { mayWriteTemplateFile, readTemplateFile, syncTemplateFile, templateFilePath } from "./template-file.js";

let dir: string;
let stderr: string[];

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "getmyenv-template-file-"));
  fs.mkdirSync(path.join(dir, ".git"));
  stderr = [];
  vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => {
    stderr.push(args.join(" "));
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  fs.rmSync(dir, { recursive: true, force: true });
});

const file = () => templateFilePath(dir);
const write = (content: string) => {
  fs.mkdirSync(path.dirname(file()), { recursive: true });
  fs.writeFileSync(file(), content);
};

describe("syncTemplateFile", () => {
  it("does not create the file when the project has no names", () => {
    expect(syncTemplateFile([], "App", dir)).toBe("unchanged");
    expect(fs.existsSync(file())).toBe(false);
  });

  it("writes 2-space JSON with a trailing newline, then leaves it alone", () => {
    expect(syncTemplateFile(["A", "B"], "App", dir)).toBe("written");
    expect(fs.readFileSync(file(), "utf8")).toBe(
      `${JSON.stringify({ name: "App", keys: [{ name: "A" }, { name: "B" }] }, null, 2)}\n`
    );
    const mtime = fs.statSync(file()).mtimeMs;
    expect(syncTemplateFile(["A", "B"], "Renamed", dir)).toBe("unchanged");
    expect(fs.statSync(file()).mtimeMs).toBe(mtime);
  });

  it("keeps hand edits and drops removed names", () => {
    write(JSON.stringify({ name: "app", startCommand: "npm run dev", keys: [{ name: "A", description: "kept" }, { name: "B" }] }));
    expect(syncTemplateFile(["A", "C"], "App", dir)).toBe("written");
    expect(readTemplateFile(dir)).toEqual({
      ok: true,
      file: { name: "app", startCommand: "npm run dev", keys: [{ name: "A", description: "kept" }, { name: "C" }] },
    });
  });

  it("never overwrites a file it cannot read, and says so", () => {
    write("{ not json");
    expect(syncTemplateFile(["A"], "App", dir)).toBe("skipped");
    expect(fs.readFileSync(file(), "utf8")).toBe("{ not json");
    expect(stderr.join("\n")).toContain(".getmyenv/template.json is not valid (not JSON). Not updated.");
  });

  it("does not write a file with control characters", () => {
    write(JSON.stringify({ name: "x\u001b[2J", keys: [] }));
    expect(syncTemplateFile(["A"], "App", dir)).toBe("skipped");
    expect(stderr.join("\n")).toContain("is not valid (name: No control characters)");
  });

  it("does not write over the cap, and warns every time", () => {
    const names = Array.from({ length: TEMPLATE_FILE_MAX_KEYS + 1 }, (_, i) => `K${i}`);
    expect(syncTemplateFile(names, "App", dir)).toBe("skipped");
    expect(syncTemplateFile(names, "App", dir)).toBe("skipped");
    expect(fs.existsSync(file())).toBe(false);
    expect(stderr.filter((l) => l.includes(`The project has ${names.length} names, the file holds ${TEMPLATE_FILE_MAX_KEYS}.`))).toHaveLength(2);
  });

  it("does not write through a symlink", () => {
    const target = path.join(dir, "elsewhere.txt");
    fs.writeFileSync(target, "keep");
    fs.mkdirSync(path.dirname(file()), { recursive: true });
    try {
      fs.symlinkSync(target, file());
    } catch {
      return; // Symlinks need extra rights on Windows.
    }
    expect(syncTemplateFile(["A"], "App", dir)).toBe("skipped");
    expect(fs.readFileSync(target, "utf8")).toBe("keep");
  });
});

describe("mayWriteTemplateFile", () => {
  const who = (kind: "folder" | "guest" | "server") => ({ who: { token: { kind } } }) as never;

  afterEach(() => {
    delete process.env.GETMYENV_TOKEN;
  });

  it("writes with folder and guest tokens only", () => {
    expect(mayWriteTemplateFile(who("folder"))).toBe(true);
    expect(mayWriteTemplateFile(who("guest"))).toBe(true);
    expect(mayWriteTemplateFile(who("server"))).toBe(false);
  });

  it("never writes with GETMYENV_TOKEN", () => {
    process.env.GETMYENV_TOKEN = "abc";
    expect(mayWriteTemplateFile(who("folder"))).toBe(false);
  });
});
