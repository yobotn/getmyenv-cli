import { describe, expect, it } from "vitest";
import {
  DEFAULT_CONTEXT_SLUG,
  DEFAULT_CONTEXTS,
  defaultProtectionForSlug,
} from "./constants.js";
import { isValidContextSlug, slugify, uniqueSlug } from "./slug.js";
import { compareVersions } from "./version.js";

describe("slugify", () => {
  it("turns names into slugs", () => {
    expect(slugify("Customer Acme")).toBe("customer-acme");
    expect(slugify("Staging EU")).toBe("staging-eu");
    expect(slugify("  Préprod / QA  ")).toBe("preprod-qa");
    expect(slugify("Production")).toBe("production");
  });

  it("returns empty when nothing is usable", () => {
    expect(slugify("!!!")).toBe("");
    expect(slugify("")).toBe("");
  });

  it("caps length without a trailing hyphen", () => {
    const s = slugify("a".repeat(39) + " b c");
    expect(s.length).toBeLessThanOrEqual(40);
    expect(s.endsWith("-")).toBe(false);
    expect(isValidContextSlug(s)).toBe(true);
  });
});

describe("uniqueSlug", () => {
  it("adds numeric suffixes", () => {
    expect(uniqueSlug("staging", [])).toBe("staging");
    expect(uniqueSlug("staging", ["staging"])).toBe("staging-2");
    expect(uniqueSlug("staging", ["staging", "staging-2"])).toBe("staging-3");
  });

  it("stays within the length limit", () => {
    const base = "x".repeat(40);
    const next = uniqueSlug(base, [base]);
    expect(next.length).toBeLessThanOrEqual(40);
    expect(next.endsWith("-2")).toBe(true);
  });
});

describe("isValidContextSlug", () => {
  it("accepts and rejects", () => {
    expect(isValidContextSlug("development")).toBe(true);
    expect(isValidContextSlug("customer-acme")).toBe(true);
    expect(isValidContextSlug("-bad")).toBe(false);
    expect(isValidContextSlug("Bad")).toBe(false);
    expect(isValidContextSlug("")).toBe(false);
  });
});

describe("context defaults", () => {
  it("new projects start with Development open and Production locked", () => {
    expect(DEFAULT_CONTEXTS.map((c) => [c.slug, c.protection])).toEqual([
      ["development", "open"],
      ["production", "locked"],
    ]);
    expect(DEFAULT_CONTEXTS[0].slug).toBe(DEFAULT_CONTEXT_SLUG);
  });

  it("a production slug defaults to locked, others to open", () => {
    expect(defaultProtectionForSlug("production")).toBe("locked");
    expect(defaultProtectionForSlug(slugify("Production"))).toBe("locked");
    expect(defaultProtectionForSlug("staging")).toBe("open");
    expect(defaultProtectionForSlug("production-2")).toBe("open");
  });
});

describe("compareVersions", () => {
  it("orders semver", () => {
    expect(compareVersions("0.6.0", "0.5.3")).toBeGreaterThan(0);
    expect(compareVersions("0.6.0", "0.6.0")).toBe(0);
    expect(compareVersions("0.5.10", "0.6.0")).toBeLessThan(0);
  });
});
