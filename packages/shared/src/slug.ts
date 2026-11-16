export const CONTEXT_SLUG_MAX = 40;
export const CONTEXT_NAME_MAX = 60;
export const CONTEXT_SLUG_RE = /^[a-z0-9][a-z0-9-]{0,39}$/;

/** Latin letters A-Z, numbers, space, dot, underscore, hyphen. Starts with a letter or number. */
export const CONTEXT_NAME_RE = /^[A-Za-z0-9][A-Za-z0-9 ._-]*$/;
export const CONTEXT_NAME_HELP =
  "Use letters A-Z, numbers, spaces, dots, underscores or hyphens. Start with a letter or number.";

/** Environment variable names: uppercase A-Z, numbers, underscore. No leading number. */
export const VARIABLE_NAME_RE = /^[A-Z_][A-Z0-9_]*$/;
export const VARIABLE_NAME_HELP =
  "Use uppercase letters, numbers and underscores, like API_KEY. Start with a letter or underscore.";

/** What a name field shows as you type: "my api-key" -> "MY_API_KEY". Validation stays the backstop. */
export function normalizeVariableNameInput(raw: string): string {
  return raw.toUpperCase().replace(/[\s-]/g, "_");
}

/** "api-key" -> "API_KEY" when that is a valid name, else null. For "did you mean" hints. */
export function suggestVariableName(raw: string): string | null {
  const s = normalizeVariableNameInput(raw.trim());
  return s !== raw && isValidVariableName(s) ? s : null;
}

export function isValidVariableName(name: string): boolean {
  return name.length > 0 && name.length <= 256 && VARIABLE_NAME_RE.test(name);
}

export function isValidContextName(name: string): boolean {
  const trimmed = name.trim();
  return (
    trimmed.length > 0 &&
    trimmed.length <= CONTEXT_NAME_MAX &&
    CONTEXT_NAME_RE.test(trimmed)
  );
}

export const KEY_TAG_MAX = 32;
/** Lowercase letters, numbers and hyphens. Starts with a letter or number. */
export const KEY_TAG_RE = /^[a-z0-9][a-z0-9-]*$/;
export const KEY_TAG_HELP = "Tags use lowercase letters, numbers and hyphens.";

/** " Secrets " -> "secrets". Returns null for an empty tag. */
export function normalizeKeyTag(raw: string | null | undefined): string | null {
  const tag = (raw ?? "").trim().toLowerCase();
  return tag === "" ? null : tag;
}

export function isValidKeyTag(tag: string): boolean {
  return tag.length <= KEY_TAG_MAX && KEY_TAG_RE.test(tag);
}

/**
 * "Customer Acme" -> "customer-acme". Accents are folded, other symbols become
 * hyphens. Returns "" when nothing usable is left.
 */
export function slugify(name: string): string {
  const folded = name
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
  const hyphenated = trimHyphens(folded.replace(/[^a-z0-9]+/g, "-"));
  return trimHyphens(hyphenated.slice(0, CONTEXT_SLUG_MAX));
}

/** Strip leading and trailing hyphens. A loop, since /-+$/ is quadratic on long runs of hyphens. */
function trimHyphens(s: string): string {
  let start = 0;
  let end = s.length;
  while (start < end && s[start] === "-") start++;
  while (end > start && s[end - 1] === "-") end--;
  return s.slice(start, end);
}

/** base, then base-2, base-3 ... while staying within the slug length limit. */
export function uniqueSlug(base: string, taken: Iterable<string>): string {
  const used = new Set(taken);
  if (!used.has(base)) return base;
  for (let n = 2; n < 10_000; n++) {
    const suffix = `-${n}`;
    const head = base
      .slice(0, CONTEXT_SLUG_MAX - suffix.length)
      .replace(/-+$/g, "");
    const candidate = `${head}${suffix}`;
    if (!used.has(candidate)) return candidate;
  }
  throw new Error("Could not find a free slug");
}

export function isValidContextSlug(slug: string): boolean {
  return CONTEXT_SLUG_RE.test(slug);
}
