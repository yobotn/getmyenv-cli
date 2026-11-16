import { describe, expect, it } from "vitest";
import { CONTEXT_SLUG_MAX, slugify } from "./slug.js";

describe("slugify", () => {
  it("folds accents and joins words with hyphens", () => {
    expect(slugify("Customer Acme")).toBe("customer-acme");
    expect(slugify("  Café -- Prod!! ")).toBe("cafe-prod");
    expect(slugify("---")).toBe("");
    expect(slugify("")).toBe("");
  });

  it("never ends with a hyphen after cutting to the length limit", () => {
    const name = "a".repeat(CONTEXT_SLUG_MAX - 1) + " b";
    const slug = slugify(name);
    expect(slug.length).toBeLessThanOrEqual(CONTEXT_SLUG_MAX);
    expect(slug.endsWith("-")).toBe(false);
  });

  it("stays fast on a long run of separators", () => {
    const name = "a" + "-".repeat(100_000) + "!";
    const start = performance.now();
    expect(slugify(name)).toBe("a");
    expect(performance.now() - start).toBeLessThan(500);
  });
});
