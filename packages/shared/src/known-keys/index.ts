/**
 * Variable names that SDKs and providers already use. Suggestions only:
 * nothing is renamed or blocked. Value hints run on the client, before
 * encryption. Values never leave the device in plaintext.
 */
import safeRegex from "safe-regex2";
import { z } from "zod";
import { VARIABLE_NAME_RE } from "../slug.js";
import { AI_KEYS } from "./ai.js";
import { AUTH_KEYS } from "./auth.js";
import { AUTOMATION_KEYS } from "./automation.js";
import { CLOUD_KEYS } from "./cloud.js";
import { COMMERCE_KEYS } from "./commerce.js";
import { CONTENT_KEYS } from "./content.js";
import { DATA_KEYS } from "./data.js";
import { EMAIL_KEYS } from "./email.js";
import { GENERIC_KEYS } from "./generic.js";
import { MESSAGING_KEYS } from "./messaging.js";
import { OBSERVABILITY_KEYS } from "./observability.js";
import { PAYMENTS_KEYS } from "./payments.js";
import { KNOWN_KEY_CATEGORIES, type KnownKey, type KnownKeyEntry } from "./types.js";

export * from "./types.js";

export const KNOWN_KEYS: KnownKey[] = [
  ...AI_KEYS,
  ...AUTH_KEYS,
  ...EMAIL_KEYS,
  ...PAYMENTS_KEYS,
  ...DATA_KEYS,
  ...CLOUD_KEYS,
  ...OBSERVABILITY_KEYS,
  ...MESSAGING_KEYS,
  ...AUTOMATION_KEYS,
  ...COMMERCE_KEYS,
  ...CONTENT_KEYS,
  ...GENERIC_KEYS,
];

export const HINT_PATTERN_MAX_SOURCE = 200;
/** Value patterns never run on longer values. */
export const HINT_VALUE_MAX_CHARS = 512;

const SLASHED = /^\/(.*)\/([a-z]*)$/s;

export type HintPatternResult = { ok: true; re: RegExp } | { ok: false; error: string };

/**
 * Compiles a value pattern written as `/source/`, `/source/i` or a bare
 * source. Only the `i` flag, at most 200 characters, and no nested
 * repetition.
 */
export function compileHintPattern(raw: string): HintPatternResult {
  const text = raw.trim();
  const slashed = SLASHED.exec(text);
  const source = slashed ? slashed[1] : text;
  const flags = slashed ? slashed[2] : "";
  if (!source) return { ok: false, error: "The pattern is empty." };
  if (flags !== "" && flags !== "i") return { ok: false, error: "Only the i flag is allowed." };
  if (source.length > HINT_PATTERN_MAX_SOURCE) {
    return { ok: false, error: `Keep the pattern to ${HINT_PATTERN_MAX_SOURCE} characters or less.` };
  }
  let re: RegExp;
  try {
    re = new RegExp(source, flags);
  } catch {
    return { ok: false, error: "The pattern does not compile." };
  }
  if (!safeRegex(source)) return { ok: false, error: "The pattern has nested repetition. Simplify it." };
  return { ok: true, re };
}

export function formatHintPattern(re: RegExp): string {
  return `/${re.source}/${re.flags}`;
}

/** Runs a value pattern within the length limit. */
export function testHintPattern(re: RegExp, value: string): boolean {
  const v = value.trim();
  return v.length <= HINT_VALUE_MAX_CHARS && re.test(v);
}

export const knownKeyEntrySchema = z.object({
  name: z.string().regex(VARIABLE_NAME_RE).max(100),
  provider: z.string().trim().min(1).max(60),
  category: z.enum(KNOWN_KEY_CATEGORIES),
  description: z.string().trim().min(1).max(300),
  docsUrl: z.url().max(500).refine((u) => u.startsWith("https://"), "Use an https link."),
  valueHint: z.string().trim().max(120).nullable(),
  valuePattern: z
    .string()
    .max(HINT_PATTERN_MAX_SOURCE + 4)
    .nullable()
    .refine((p) => p == null || compileHintPattern(p).ok, "The pattern is not allowed."),
  pair: z.array(z.string().regex(VARIABLE_NAME_RE)).max(10),
  source: z.enum(["sdk", "convention"]),
  iconSlug: z
    .string()
    .regex(/^[a-z0-9]{1,50}$/)
    .nullable(),
});

export function toKnownKeyEntry(k: KnownKey): KnownKeyEntry {
  return {
    name: k.name,
    provider: k.provider,
    category: k.category,
    description: k.description,
    docsUrl: k.docsUrl,
    valueHint: k.valueHint ?? null,
    valuePattern: k.valuePattern ? formatHintPattern(k.valuePattern) : null,
    pair: k.pair ?? [],
    source: k.source,
    iconSlug: k.iconSlug ?? null,
  };
}

function fromEntry(e: KnownKeyEntry): KnownKey {
  const compiled = e.valuePattern ? compileHintPattern(e.valuePattern) : null;
  return {
    name: e.name,
    provider: e.provider,
    category: e.category,
    description: e.description,
    docsUrl: e.docsUrl,
    ...(e.valueHint ? { valueHint: e.valueHint } : {}),
    ...(compiled?.ok ? { valuePattern: compiled.re } : {}),
    ...(e.pair.length ? { pair: e.pair } : {}),
    source: e.source,
    ...(e.iconSlug ? { iconSlug: e.iconSlug } : {}),
  };
}

export type KnownKeyIndex = {
  all: KnownKey[];
  get(name: string): KnownKey | undefined;
  /** Names that start with, or contain, the typed text. Prefix matches first. */
  suggest(input: string, limit?: number): KnownKey[];
  /** A known name the input probably meant. Exact known names give nothing. */
  nearMiss(name: string): KnownKey | undefined;
  /** A known name whose value format matches the pasted value. Runs on the client only. */
  guessFromValue(value: string): KnownKey | undefined;
  /** Soft format check for a value against a known name. Never blocks a save. */
  formatHint(name: string, value: string): string | null;
};

const NOISE = new Set(["API", "KEY", "SECRET", "TOKEN", "ID", "URL", "NEXT", "PUBLIC"]);

function words(name: string): string[] {
  return name.toUpperCase().split(/[^A-Z0-9]+/).filter(Boolean);
}

const squash = (s: string) => s.toUpperCase().replace(/[^A-Z0-9]/g, "");

/**
 * Bundled entries first. Remote entries (from `GET /api/known-keys`) may add
 * names and change the description, docs link, icon, pairs and hint of a
 * bundled name. They never change a bundled name's provider, category,
 * source or value pattern. Invalid remote entries are dropped. Names in
 * `disabled` (defaults an admin turned off) are left out.
 */
export function createKnownKeyIndex(
  bundled: KnownKey[],
  remote?: readonly unknown[] | null,
  disabled?: readonly unknown[] | null
): KnownKeyIndex {
  const off = new Set((disabled ?? []).filter((n): n is string => typeof n === "string"));
  const byName = new Map(bundled.filter((k) => !off.has(k.name)).map((k) => [k.name, k]));
  for (const raw of remote ?? []) {
    const parsed = knownKeyEntrySchema.safeParse(raw);
    if (!parsed.success) continue;
    const e = parsed.data;
    const base = byName.get(e.name);
    if (!base) {
      byName.set(e.name, fromEntry(e));
      continue;
    }
    byName.set(e.name, {
      ...base,
      description: e.description,
      docsUrl: e.docsUrl,
      ...(e.valueHint ? { valueHint: e.valueHint } : {}),
      ...(e.pair.length ? { pair: e.pair } : {}),
      ...(e.iconSlug ? { iconSlug: e.iconSlug } : {}),
    });
  }
  const all = [...byName.values()];

  function suggest(input: string, limit = 8): KnownKey[] {
    const q = squash(input.trim());
    if (q.length < 2) return [];
    const scored: Array<{ key: KnownKey; score: number }> = [];
    for (const key of all) {
      const name = squash(key.name);
      const provider = squash(key.provider);
      const score = name.startsWith(q) ? 0 : provider.startsWith(q) ? 1 : name.includes(q) ? 2 : -1;
      if (score >= 0) scored.push({ key, score });
    }
    return scored
      .sort((a, b) => a.score - b.score || a.key.name.localeCompare(b.key.name))
      .slice(0, limit)
      .map((s) => s.key);
  }

  function nearMiss(name: string): KnownKey | undefined {
    const upper = name.trim().toUpperCase();
    if (!upper || byName.has(upper)) return undefined;
    const squashed = squash(upper);
    for (const key of all) {
      if (key.category === "generic") continue;
      if (squash(key.name) === squashed) return key;
    }
    const mine = words(upper).filter((w) => !NOISE.has(w)).join("");
    if (!mine) return undefined;
    const kind = /SECRET/.test(upper) ? "SECRET" : /TOKEN/.test(upper) ? "TOKEN" : /KEY/.test(upper) ? "KEY" : null;
    const candidates = all.filter((key) => {
      if (key.category === "generic") return false;
      const theirs = words(key.name).filter((w) => !NOISE.has(w)).join("");
      return theirs === mine && (kind == null || key.name.includes(kind));
    });
    return candidates.length === 1 ? candidates[0] : undefined;
  }

  function guessFromValue(value: string): KnownKey | undefined {
    const v = value.trim();
    if (v.length < 8 || v.length > HINT_VALUE_MAX_CHARS) return undefined;
    const matches = all.filter((k) => k.valuePattern?.test(v));
    return matches.length === 1 ? matches[0] : undefined;
  }

  function formatHint(name: string, value: string): string | null {
    const key = byName.get(name);
    if (!key?.valuePattern || !key.valueHint || !value.trim()) return null;
    const v = value.trim();
    if (v.length > HINT_VALUE_MAX_CHARS) return null;
    return key.valuePattern.test(v) ? null : `${key.provider} values usually look like this: ${key.valueHint}.`;
  }

  return { all, get: (name) => byName.get(name), suggest, nearMiss, guessFromValue, formatHint };
}

export const BUNDLED_KNOWN_KEYS = createKnownKeyIndex(KNOWN_KEYS);

export function knownKey(name: string): KnownKey | undefined {
  return BUNDLED_KNOWN_KEYS.get(name);
}

export function suggestKnownKeys(input: string, limit = 8): KnownKey[] {
  return BUNDLED_KNOWN_KEYS.suggest(input, limit);
}

export function nearMissKnownKey(name: string): KnownKey | undefined {
  return BUNDLED_KNOWN_KEYS.nearMiss(name);
}

export function guessKnownKeyFromValue(value: string): KnownKey | undefined {
  return BUNDLED_KNOWN_KEYS.guessFromValue(value);
}

export function knownKeyFormatHint(name: string, value: string): string | null {
  return BUNDLED_KNOWN_KEYS.formatHint(name, value);
}

/** The domain shown next to a link, so people see where it goes. */
export function linkDomain(url: string): string | null {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return null;
  }
}
