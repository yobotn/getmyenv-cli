import { describe, expect, it } from "vitest";
import {
  KNOWN_KEYS,
  KNOWN_KEY_CATEGORIES,
  compileHintPattern,
  createKnownKeyIndex,
  guessKnownKeyFromValue,
  knownKeyEntrySchema,
  knownKeyFormatHint,
  linkDomain,
  nearMissKnownKey,
  suggestKnownKeys,
  toKnownKeyEntry,
} from "./known-keys.js";
import { publicSecretWarning } from "./public-env.js";
import { VARIABLE_NAME_RE } from "./slug.js";
import { parseTemplateRef, templateInputSchema } from "./templates.js";

describe("known keys catalog", () => {
  it("has unique, valid names and https links", () => {
    const names = KNOWN_KEYS.map((k) => k.name);
    expect(new Set(names).size).toBe(names.length);
    for (const k of KNOWN_KEYS) {
      expect(k.name).toMatch(VARIABLE_NAME_RE);
      expect(k.docsUrl.startsWith("https://")).toBe(true);
      for (const p of k.pair ?? []) expect(names).toContain(p);
    }
  });

  it("suggests by name and provider", () => {
    expect(suggestKnownKeys("open").map((k) => k.name)).toContain("OPENAI_API_KEY");
    const goo = suggestKnownKeys("goo").map((k) => k.name);
    expect(goo).toEqual(expect.arrayContaining(["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET", "GEMINI_API_KEY"]));
    expect(suggestKnownKeys("o")).toEqual([]);
  });

  it("finds near misses without flagging known names", () => {
    expect(nearMissKnownKey("OPEN_AI_KEY")?.name).toBe("OPENAI_API_KEY");
    expect(nearMissKnownKey("STRIPE_KEY")?.name).toBe("STRIPE_SECRET_KEY");
    expect(nearMissKnownKey("OPENAI_API_KEY")).toBeUndefined();
    expect(nearMissKnownKey("MY_OWN_THING")).toBeUndefined();
  });

  it("guesses a name from a value format", () => {
    expect(guessKnownKeyFromValue(`sk-ant-${"a".repeat(30)}`)?.name).toBe("ANTHROPIC_API_KEY");
    expect(guessKnownKeyFromValue(`whsec_${"a".repeat(30)}`)?.name).toBe("STRIPE_WEBHOOK_SECRET");
    expect(guessKnownKeyFromValue("hello world")).toBeUndefined();
  });

  it("gives a soft format hint", () => {
    expect(knownKeyFormatHint("ANTHROPIC_API_KEY", "nope")).toContain("sk-ant-");
    expect(knownKeyFormatHint("ANTHROPIC_API_KEY", `sk-ant-${"a".repeat(30)}`)).toBeNull();
    expect(knownKeyFormatHint("MY_KEY", "x")).toBeNull();
  });

  it("shows link domains", () => {
    expect(linkDomain("https://www.example.com/a")).toBe("example.com");
    expect(linkDomain("nope")).toBeNull();
  });

  it("has 100 to 150 entries with known categories and allowed patterns", () => {
    expect(KNOWN_KEYS.length).toBeGreaterThanOrEqual(100);
    expect(KNOWN_KEYS.length).toBeLessThanOrEqual(150);
    for (const k of KNOWN_KEYS) {
      expect(KNOWN_KEY_CATEGORIES).toContain(k.category);
      if (k.valuePattern) expect(compileHintPattern(`/${k.valuePattern.source}/${k.valuePattern.flags}`).ok, k.name).toBe(true);
      expect(knownKeyEntrySchema.safeParse(toKnownKeyEntry(k)).success, k.name).toBe(true);
    }
  });

  it("covers the platform and automation names", () => {
    const names = KNOWN_KEYS.map((k) => k.name);
    for (const n of ["VERCEL_TOKEN", "NETLIFY_AUTH_TOKEN", "FLY_API_TOKEN", "ZAPIER_WEBHOOK_URL", "MAKE_WEBHOOK_URL", "N8N_WEBHOOK_URL", "DISCORD_BOT_TOKEN", "TELEGRAM_BOT_TOKEN", "SHOPIFY_ACCESS_TOKEN", "HUBSPOT_ACCESS_TOKEN"]) {
      expect(names).toContain(n);
    }
    expect(guessKnownKeyFromValue("https://hooks.zapier.com/hooks/catch/123/abc/")?.name).toBe("ZAPIER_WEBHOOK_URL");
    expect(guessKnownKeyFromValue(`123456789:${"A".repeat(35)}`)?.name).toBe("TELEGRAM_BOT_TOKEN");
  });

  it("never runs patterns on long values", () => {
    expect(guessKnownKeyFromValue(`sk-ant-${"a".repeat(600)}`)).toBeUndefined();
    expect(knownKeyFormatHint("ANTHROPIC_API_KEY", "x".repeat(600))).toBeNull();
  });
});

describe("hint patterns", () => {
  it("accepts slashed and bare sources with no flags or i", () => {
    expect(compileHintPattern("/^abc_[a-z]+$/").ok).toBe(true);
    expect(compileHintPattern("/^abc$/i").ok).toBe(true);
    expect(compileHintPattern("^abc$").ok).toBe(true);
  });

  it("refuses other flags, long sources, bad syntax and nested repetition", () => {
    expect(compileHintPattern("/abc/g").ok).toBe(false);
    expect(compileHintPattern("/abc/m").ok).toBe(false);
    expect(compileHintPattern(`/${"a".repeat(201)}/`).ok).toBe(false);
    expect(compileHintPattern("/(abc/").ok).toBe(false);
    expect(compileHintPattern("/^(a+)+$/").ok).toBe(false);
    expect(compileHintPattern("").ok).toBe(false);
  });
});

describe("layered known key index", () => {
  const remoteNew = {
    name: "ACME_API_KEY",
    provider: "Acme",
    category: "ai",
    description: "Acme key.",
    docsUrl: "https://acme.example/keys",
    valueHint: "Starts with acme_",
    valuePattern: "/^acme_[a-z0-9]{20}$/",
    pair: [],
    source: "convention",
    iconSlug: null,
  };

  it("adds remote names with checked patterns", () => {
    const index = createKnownKeyIndex(KNOWN_KEYS, [remoteNew]);
    expect(index.get("ACME_API_KEY")?.provider).toBe("Acme");
    expect(index.guessFromValue(`acme_${"a".repeat(20)}`)?.name).toBe("ACME_API_KEY");
    expect(index.suggest("acme").map((k) => k.name)).toContain("ACME_API_KEY");
    expect(guessKnownKeyFromValue(`acme_${"a".repeat(20)}`)).toBeUndefined();
  });

  it("changes display fields of a bundled name only", () => {
    const index = createKnownKeyIndex(KNOWN_KEYS, [
      {
        ...toKnownKeyEntry(KNOWN_KEYS.find((k) => k.name === "ANTHROPIC_API_KEY")!),
        provider: "Other",
        category: "generic",
        description: "Changed.",
        docsUrl: "https://docs.anthropic.com/keys",
        valuePattern: "/^x+$/",
        source: "convention",
      },
    ]);
    const k = index.get("ANTHROPIC_API_KEY")!;
    expect(k.description).toBe("Changed.");
    expect(k.docsUrl).toBe("https://docs.anthropic.com/keys");
    expect(k.provider).toBe("Anthropic");
    expect(k.category).toBe("ai");
    expect(k.source).toBe("sdk");
    expect(k.valuePattern?.source).toContain("sk-ant-");
  });

  it("drops invalid remote entries", () => {
    const index = createKnownKeyIndex(KNOWN_KEYS, [
      { ...remoteNew, name: "BAD_ONE", valuePattern: "/^(a+)+$/" },
      { ...remoteNew, name: "BAD_TWO", docsUrl: "http://acme.example" },
      { ...remoteNew, name: "bad three" },
      null,
      "nope",
    ]);
    expect(index.get("BAD_ONE")).toBeUndefined();
    expect(index.get("BAD_TWO")).toBeUndefined();
    expect(index.all.length).toBe(KNOWN_KEYS.length);
  });

  it("keeps the public secret warning on bundled patterns", () => {
    expect(publicSecretWarning("NEXT_PUBLIC_THING", `acme_${"a".repeat(20)}`)).toBeNull();
    expect(publicSecretWarning("NEXT_PUBLIC_THING", `sk-ant-${"a".repeat(30)}`)).toContain("looks like a secret");
  });
});

describe("templates", () => {
  it("parses ids and URLs", () => {
    expect(parseTemplateRef("abcDEF1234")).toBe("abcDEF1234");
    expect(parseTemplateRef("https://getmyenv.com/t/abcDEF1234")).toBe("abcDEF1234");
    expect(parseTemplateRef("https://getmyenv.com/t/abcDEF1234/?x=1")).toBe("abcDEF1234");
    expect(parseTemplateRef("../../etc")).toBeNull();
  });

  it("refuses duplicate names, http links and value fields", () => {
    const base = { name: "App", keys: [{ name: "A" }] };
    expect(templateInputSchema.safeParse(base).success).toBe(true);
    expect(templateInputSchema.safeParse({ ...base, keys: [{ name: "A" }, { name: "A" }] }).success).toBe(false);
    expect(
      templateInputSchema.safeParse({ ...base, keys: [{ name: "A", link: "http://x.com" }] }).success
    ).toBe(false);
    const parsed = templateInputSchema.parse({ ...base, keys: [{ name: "A", value: "secret" }] });
    expect(parsed.keys[0]).not.toHaveProperty("value");
  });
});

describe("turned-off defaults", () => {
  it("leaves out defaults an admin turned off, and ignores bad names", () => {
    const index = createKnownKeyIndex(KNOWN_KEYS, [], ["OPENAI_API_KEY", 42, null]);
    expect(index.get("OPENAI_API_KEY")).toBeUndefined();
    expect(index.all.some((k) => k.name === "OPENAI_API_KEY")).toBe(false);
    expect(index.get("STRIPE_SECRET_KEY")).toBeDefined();
  });
});
