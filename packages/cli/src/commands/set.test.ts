import { describe, expect, it } from "vitest";
import { invalidNameMessage, parseExpires, unsetNoChangeLines } from "./set.js";

describe("parseExpires", () => {
  const now = new Date("2026-10-10T12:00:00Z");

  it("takes a future date or never", () => {
    expect(parseExpires("2026-12-31", now)).toBe("2026-12-31T00:00:00.000Z");
    expect(parseExpires("never", now)).toBeNull();
    expect(parseExpires(undefined, now)).toBeUndefined();
  });

  it("refuses a past date before asking the server, with an example a year out", () => {
    expect(() => parseExpires("2020-01-01", now)).toThrow("--expires must be a future date, like 2027-10-10, or never.");
  });

  it("refuses text that is not a date", () => {
    expect(() => parseExpires("soon", now)).toThrow("--expires takes a date like 2027-10-10, or never.");
  });
});

describe("unsetNoChangeLines", () => {
  const keys = [{ name: "API_KEY", status: { development: "missing" } }];

  it("explains that a declared name stays, and points to --all", () => {
    expect(unsetNoChangeLines(["API_KEY"], keys, "development", false)).toEqual([
      "API_KEY has no value in development. The name stays in the project, and run asks for it. Remove it: npx getmyenv unset API_KEY --all",
    ]);
  });

  it("says No change for names the project does not have", () => {
    expect(unsetNoChangeLines(["NOPE"], keys, "development", false)).toEqual(["No change: NOPE"]);
    expect(unsetNoChangeLines(["API_KEY"], keys, "development", true)).toEqual(["No change: API_KEY"]);
  });
});

describe("invalidNameMessage", () => {
  it("names a short invalid name and suggests a fix", () => {
    expect(invalidNameMessage("database_url")).toContain("Invalid name: database_url.");
    expect(invalidNameMessage("database_url")).toContain("Did you mean DATABASE_URL?");
  });

  it("never prints what looks like a value", () => {
    // The fake Stripe key is joined at runtime so secret scanners do not flag the source.
    for (const value of [["sk", "live", "51HxYzAbCdEfGhIjKlMnOp"].join("_"), "postgres://u:p@h/db", "abc+def"]) {
      const msg = invalidNameMessage(value);
      expect(msg).not.toContain(value);
      expect(msg).not.toContain(value.toUpperCase());
      expect(msg).toContain("It looks like a value");
    }
  });
});
