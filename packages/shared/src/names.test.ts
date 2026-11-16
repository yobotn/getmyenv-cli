import { describe, expect, it } from "vitest";
import {
  contextNameSchema,
  declareKeysSchema,
  keyTagSchema,
  setKeyTagSchema,
  variableNameSchema,
} from "./schemas.js";
import {
  isValidContextName,
  isValidKeyTag,
  isValidVariableName,
  normalizeKeyTag,
  normalizeVariableNameInput,
  slugify,
  suggestVariableName,
} from "./slug.js";

describe("context names", () => {
  it.each(["Customer Acme", "staging-eu", "Preprod", "v1.2_beta", "Development"])(
    "accepts %s",
    (name) => {
      expect(isValidContextName(name)).toBe(true);
      expect(contextNameSchema.safeParse(name).success).toBe(true);
      expect(slugify(name)).not.toBe("");
    }
  );

  it.each([
    "app/prefs",
    "!!!",
    "a<b",
    "prod 🚀",
    "🚀",
    "-staging",
    " ",
    "",
    "Préprod",
    "إنتاج",
    "東京",
  ])(
    "rejects %j",
    (name) => {
      expect(isValidContextName(name)).toBe(false);
      expect(contextNameSchema.safeParse(name).success).toBe(false);
    }
  );

  it("trims before checking", () => {
    expect(contextNameSchema.parse("  Staging  ")).toBe("Staging");
  });

  it("explains the rule", () => {
    const result = contextNameSchema.safeParse("app/prefs");
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.message).toBe(
        "Use letters A-Z, numbers, spaces, dots, underscores or hyphens. Start with a letter or number."
      );
    }
  });
});

describe("variable names", () => {
  it.each(["API_KEY", "_PRIVATE", "DB2_URL", "A"])("accepts %s", (name) => {
    expect(isValidVariableName(name)).toBe(true);
    expect(variableNameSchema.safeParse(name).success).toBe(true);
  });

  it.each(["مفتاح", "КЛЮЧ", "CLÉ", "2FA", "API-KEY", "API KEY", "", "_private", "db2_url", "a", "Api_Key"])("rejects %j", (name) => {
    expect(isValidVariableName(name)).toBe(false);
    expect(variableNameSchema.safeParse(name).success).toBe(false);
  });
});

describe("name input", () => {
  it("uppercases and turns spaces and hyphens into underscores", () => {
    expect(normalizeVariableNameInput("my api-key")).toBe("MY_API_KEY");
    expect(normalizeVariableNameInput("DB2_URL")).toBe("DB2_URL");
  });

  it("suggests a valid name only when it differs", () => {
    expect(suggestVariableName("database_url")).toBe("DATABASE_URL");
    expect(suggestVariableName("api-key")).toBe("API_KEY");
    expect(suggestVariableName("API_KEY")).toBeNull();
    expect(suggestVariableName("2fa")).toBeNull();
  });
});

describe("key tags", () => {
  it("normalizes case and whitespace", () => {
    expect(normalizeKeyTag("  Secrets ")).toBe("secrets");
    expect(normalizeKeyTag("   ")).toBeNull();
    expect(normalizeKeyTag(null)).toBeNull();
    expect(keyTagSchema.parse(" Config ")).toBe("config");
  });

  it("accepts letters, numbers and hyphens", () => {
    for (const tag of ["secrets", "config", "app-prefs", "v2"]) {
      expect(isValidKeyTag(tag)).toBe(true);
    }
  });

  it("rejects other characters and long tags", () => {
    for (const tag of ["app prefs", "-x", "a_b", "é", "x".repeat(33)]) {
      expect(isValidKeyTag(tag)).toBe(false);
      expect(keyTagSchema.safeParse(tag).success).toBe(false);
    }
  });

  it("is optional when declaring keys and nullable when setting", () => {
    expect(declareKeysSchema.parse({ names: ["A"] }).tag).toBeUndefined();
    expect(declareKeysSchema.parse({ names: ["A"], tag: "Config" }).tag).toBe("config");
    expect(setKeyTagSchema.parse({ names: ["A"], tag: null }).tag).toBeNull();
    expect(setKeyTagSchema.safeParse({ names: ["A"] }).success).toBe(false);
  });
});
