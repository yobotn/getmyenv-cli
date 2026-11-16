import { DEFAULT_CONTEXT_SLUG, FACTS, slugify } from "@getmyenv/shared";
import type { ContextInfo, WhoamiResponse } from "./api.js";
import type { ProjectMeta } from "./fs.js";

/**
 * Default context for this folder:
 * server token's bound context, then project.json `context`, then `development`.
 */
export function defaultContextSlug(
  who: Pick<WhoamiResponse, "token" | "contexts">,
  meta: ProjectMeta | null
): string {
  if (who.token.kind === "server" && who.token.context) return who.token.context;
  const slugs = new Set(who.contexts.map((c) => c.slug));
  if (meta?.context && slugs.has(meta.context)) return meta.context;
  if (slugs.has(DEFAULT_CONTEXT_SLUG)) return DEFAULT_CONTEXT_SLUG;
  return who.contexts[0]?.slug ?? DEFAULT_CONTEXT_SLUG;
}

/** Find a context by slug, or by name ("Customer Acme" finds customer-acme). */
export function findContext(
  contexts: ContextInfo[],
  input: string
): ContextInfo | null {
  const raw = input.trim();
  if (!raw) return null;
  const exact = contexts.find((c) => c.slug === raw);
  if (exact) return exact;
  const lower = raw.toLowerCase();
  const byName = contexts.find((c) => c.name.toLowerCase() === lower);
  if (byName) return byName;
  const slug = slugify(raw);
  return contexts.find((c) => c.slug === slug) ?? null;
}

/** The context a command acts on. Throws with the available slugs when unknown. */
export function resolveContext(
  who: Pick<WhoamiResponse, "token" | "contexts"> & { isGuest?: boolean },
  meta: ProjectMeta | null,
  explicit?: string
): ContextInfo {
  const wanted = explicit?.trim() || defaultContextSlug(who, meta);
  const found = findContext(who.contexts, wanted);
  if (found) return found;
  if (who.token.kind === "server") {
    throw new Error(
      `This server token reads ${who.token.context ?? "one Read-only context"} only.`
    );
  }
  const available = who.contexts.map((c) => c.slug).join(", ") || "none";
  const next = who.isGuest
    ? `${FACTS.guestContexts} Claim it to add contexts: npx getmyenv claim`
    : `Create one: npx getmyenv context create "${wanted}"`;
  throw new Error(`No context "${wanted}". Available: ${available}\n${next}`);
}
