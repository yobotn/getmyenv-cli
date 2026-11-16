import { describe, expect, it } from "vitest";
import type { ContextInfo, WhoamiResponse } from "./api.js";
import { defaultContextSlug, findContext, resolveContext } from "./context.js";

const contexts = [
  { id: 1, slug: "development", name: "Development", protection: "open" },
  { id: 2, slug: "production", name: "Production", protection: "locked" },
  { id: 3, slug: "customer-acme", name: "Customer Acme", protection: "open" },
] as unknown as ContextInfo[];

type Who = Pick<WhoamiResponse, "token" | "contexts">;

function who(kind: "folder" | "guest" | "server", context: string | null = null): Who {
  return {
    token: { kind, label: "t", context, allowedCidrs: [] },
    contexts,
  } as unknown as Who;
}

describe("defaultContextSlug", () => {
  it("server token uses its bound context", () => {
    expect(defaultContextSlug(who("server", "production"), { context: "customer-acme" })).toBe(
      "production"
    );
  });

  it("then project.json context", () => {
    expect(defaultContextSlug(who("folder"), { context: "customer-acme" })).toBe("customer-acme");
  });

  it("ignores a project.json context that no longer exists", () => {
    expect(defaultContextSlug(who("folder"), { context: "gone" })).toBe("development");
  });

  it("then development", () => {
    expect(defaultContextSlug(who("folder"), null)).toBe("development");
  });
});

describe("findContext", () => {
  it("finds by slug, name, or slugified name", () => {
    expect(findContext(contexts, "customer-acme")?.id).toBe(3);
    expect(findContext(contexts, "customer acme")?.id).toBe(3);
    expect(findContext(contexts, "Customer Acme!")?.id).toBe(3);
    expect(findContext(contexts, "nope")).toBeNull();
    expect(findContext(contexts, "  ")).toBeNull();
  });
});

describe("resolveContext", () => {
  it("explicit context wins", () => {
    expect(resolveContext(who("folder"), { context: "development" }, "customer-acme").slug).toBe(
      "customer-acme"
    );
  });

  it("unknown context lists the available slugs", () => {
    expect(() => resolveContext(who("folder"), null, "staging")).toThrow(
      /Available: development, production, customer-acme/
    );
  });
});
