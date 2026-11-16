import { describe, expect, it } from "vitest";
import { knownKey } from "./known-keys.js";
import { mergeTemplateFile, templateFileSchema, TEMPLATE_FILE_MAX_KEYS, type TemplateFile } from "./templates.js";

describe("mergeTemplateFile", () => {
  const file: TemplateFile = {
    name: "app",
    startCommand: "npm run dev",
    keys: [
      { name: "SITE_NAME", description: "Shown in the title" },
      { name: "ANALYTICS_ID", optional: true },
      { name: "OLD_KEY" },
    ],
  };

  it("keeps edits and order, drops removed names, adds new ones at the end", () => {
    const merged = mergeTemplateFile(file, ["ANALYTICS_ID", "NEW_KEY", "SITE_NAME"], "Other name");
    expect(merged).toEqual({
      name: "app",
      startCommand: "npm run dev",
      keys: [
        { name: "SITE_NAME", description: "Shown in the title" },
        { name: "ANALYTICS_ID", optional: true },
        { name: "NEW_KEY" },
      ],
    });
  });

  it("adds the catalog description and link for known names", () => {
    const merged = mergeTemplateFile(null, ["OPENAI_API_KEY"], "My app");
    const known = knownKey("OPENAI_API_KEY")!;
    expect(merged).toEqual({
      name: "My app",
      keys: [{ name: "OPENAI_API_KEY", description: known.description, link: known.docsUrl }],
    });
    expect(templateFileSchema.safeParse(merged).success).toBe(true);
  });

  it("returns the same content when nothing changed", () => {
    const merged = mergeTemplateFile(file, ["SITE_NAME", "ANALYTICS_ID", "OLD_KEY"], "app");
    expect(JSON.stringify(merged)).toBe(JSON.stringify(file));
  });
});

describe("templateFileSchema", () => {
  it("accepts a plain file", () => {
    expect(templateFileSchema.safeParse({ name: "x", keys: [{ name: "A" }] }).success).toBe(true);
  });

  it("rejects control characters in printed fields", () => {
    const esc = "\u001b[2J";
    for (const bad of [
      { name: `x${esc}`, keys: [] },
      { startCommand: `npm start${esc}`, keys: [] },
      { description: `hi${esc}`, keys: [] },
      { keys: [{ name: "A", description: `a${esc}` }] },
    ]) {
      expect(templateFileSchema.safeParse(bad).success).toBe(false);
    }
  });

  it("allows newlines in descriptions only", () => {
    expect(templateFileSchema.safeParse({ description: "one\ntwo", keys: [] }).success).toBe(true);
    expect(templateFileSchema.safeParse({ name: "one\ntwo", keys: [] }).success).toBe(false);
  });

  it("rejects links that are not https, duplicates, and more names than one request holds", () => {
    expect(templateFileSchema.safeParse({ keys: [{ name: "A", link: "http://x.dev" }] }).success).toBe(false);
    expect(templateFileSchema.safeParse({ keys: [{ name: "A" }, { name: "A" }] }).success).toBe(false);
    const many = Array.from({ length: TEMPLATE_FILE_MAX_KEYS + 1 }, (_, i) => ({ name: `K${i}` }));
    expect(templateFileSchema.safeParse({ keys: many }).success).toBe(false);
  });
});
