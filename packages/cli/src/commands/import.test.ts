import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { contextSlugFromEnvFile, parseEnvFile } from "../lib/fs.js";
import { planImport } from "./import.js";

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

describe("contextSlugFromEnvFile", () => {
  it("maps .env.<slug> and .env.<slug>.local to the slug", () => {
    expect(contextSlugFromEnvFile("/app/.env.staging")).toBe("staging");
    expect(contextSlugFromEnvFile("/app/.env.staging.local")).toBe("staging");
    expect(contextSlugFromEnvFile("/app/.env.Customer_Acme")).toBe("customer-acme");
  });

  it("maps .env and .env.local to the default context", () => {
    expect(contextSlugFromEnvFile("/app/.env")).toBeNull();
    expect(contextSlugFromEnvFile("/app/.env.local")).toBeNull();
  });

  it("ignores sample files", () => {
    expect(contextSlugFromEnvFile("/app/.env.example")).toBeNull();
    expect(contextSlugFromEnvFile("/app/.env.staging.sample")).toBeNull();
  });
});

describe("planImport", () => {
  const files = ["/app/.env.local", "/app/.env", "/app/.env.staging"];

  it("sends each file to its context, local files last", () => {
    expect(planImport(files, { explicitFile: false, defaultSlug: "development" })).toEqual([
      { slug: "development", files: ["/app/.env", "/app/.env.local"] },
      { slug: "staging", files: ["/app/.env.staging"] },
    ]);
  });

  it("-c sends .env, .env.<slug> and .env.local to that context and skips others", () => {
    expect(
      planImport([...files, "/app/.env.preview"], {
        explicitFile: false,
        context: "staging",
        defaultSlug: "development",
      })
    ).toEqual([
      { slug: "staging", files: ["/app/.env", "/app/.env.staging", "/app/.env.local"] },
    ]);
  });

  it("an explicit file goes to -c, then its own name, then the default", () => {
    expect(
      planImport(["/app/.env.staging"], {
        explicitFile: true,
        context: "customer-acme",
        defaultSlug: "development",
      })
    ).toEqual([{ slug: "customer-acme", files: ["/app/.env.staging"] }]);
    expect(
      planImport(["/app/.env.staging"], { explicitFile: true, defaultSlug: "development" })
    ).toEqual([{ slug: "staging", files: ["/app/.env.staging"] }]);
    expect(planImport(["/app/.env"], { explicitFile: true, defaultSlug: "development" })).toEqual([
      { slug: "development", files: ["/app/.env"] },
    ]);
  });
});

describe("parseEnvFile", () => {
  it("handles export, quotes, escapes and comments", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "getmyenv-parse-"));
    tempDirs.push(dir);
    const file = path.join(dir, ".env");
    fs.writeFileSync(
      file,
      [
        "# comment",
        "export API_KEY=abc",
        'MULTI="line1\\nline2"',
        'QUOTED="say \\"hi\\""',
        "SINGLE='raw \\n'",
        "EMPTY=",
        "bad-name=1",
        "",
      ].join("\n"),
      "utf8"
    );
    expect(parseEnvFile(file)).toEqual({
      API_KEY: "abc",
      MULTI: "line1\nline2",
      QUOTED: 'say \\"hi\\"',
      SINGLE: "raw \\n",
      EMPTY: "",
    });
  });
});
