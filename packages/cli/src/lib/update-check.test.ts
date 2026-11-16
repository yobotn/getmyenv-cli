import { describe, expect, it } from "vitest";
import { compareSemver, updateLine } from "./update-check.js";

describe("updateLine", () => {
  it("is null when up to date or unknown", () => {
    expect(updateLine("0.6.0", "0.6.0")).toBeNull();
    expect(updateLine("0.7.0", "0.6.0")).toBeNull();
    expect(updateLine("0.6.0", null)).toBeNull();
  });

  it("is one line when a newer version exists", () => {
    const line = updateLine("0.6.0", "0.6.1");
    expect(line).toContain("0.6.1 is available");
    expect(line).not.toContain("\n");
  });

  it("compares versions numerically", () => {
    expect(compareSemver("0.10.0", "0.9.9")).toBe(1);
  });
});
