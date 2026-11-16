import { z } from "zod";
import { MAX_VALUES_PER_REQUEST } from "./facts.js";
import { BUNDLED_KNOWN_KEYS, type KnownKeyIndex } from "./known-keys.js";
import { variableNameSchema } from "./schemas.js";

/**
 * Env templates: a shareable list of the variables an app needs.
 * Names, descriptions and links only. There is no value field.
 */

export const TEMPLATE_MAX_KEYS = 200;

const httpsUrl = z
  .string()
  .trim()
  .max(500)
  .url()
  .refine((u) => u.startsWith("https://"), "Links must start with https://");

export const templateKeySchema = z.object({
  name: variableNameSchema,
  description: z.string().trim().max(300).optional(),
  link: httpsUrl.optional(),
  optional: z.boolean().optional(),
});
export type TemplateKey = z.infer<typeof templateKeySchema>;

export const templateInputSchema = z.object({
  name: z.string().trim().min(1).max(80),
  description: z.string().trim().max(1000).optional(),
  startCommand: z.string().trim().max(200).optional(),
  keys: z
    .array(templateKeySchema)
    .min(1)
    .max(TEMPLATE_MAX_KEYS)
    .refine((keys) => new Set(keys.map((k) => k.name)).size === keys.length, "Each variable name once"),
});
export type TemplateInput = z.infer<typeof templateInputSchema>;

/** A template entry with the catalog description and link, for names we know. */
export function withCatalog(name: string, index: Pick<KnownKeyIndex, "get"> = BUNDLED_KNOWN_KEYS): TemplateKey {
  const known = index.get(name);
  return known ? { name, description: known.description, link: known.docsUrl } : { name };
}

/** What the public template API returns. */
export type PublicTemplate = {
  publicId: string;
  name: string;
  description: string | null;
  startCommand: string | null;
  keys: TemplateKey[];
};

/** The template file in the repo. */
export const TEMPLATE_FILE = ".getmyenv/template.json";
/** One declare request covers the whole file. */
export const TEMPLATE_FILE_MAX_KEYS = MAX_VALUES_PER_REQUEST;

/** Printed at a terminal, so no escape codes. Tabs and newlines are allowed in descriptions. */
const plainText = (max: number, opts: { lines?: boolean } = {}) =>
  z
    .string()
    .trim()
    .max(max)
    .refine(
      (s) => !(opts.lines ? /[\u0000-\u0008\u000b-\u001f\u007f-\u009f]/ : /[\u0000-\u001f\u007f-\u009f]/).test(s),
      "No control characters"
    );

/**
 * `.getmyenv/template.json`: the project's variable names, committed with the
 * repo. Same fields as a template. There is no value field.
 */
export const templateFileSchema = z.object({
  name: plainText(80).pipe(z.string().min(1)).optional(),
  description: plainText(1000, { lines: true }).optional(),
  startCommand: plainText(200).optional(),
  keys: z
    .array(templateKeySchema.extend({ description: plainText(300, { lines: true }).optional() }))
    .max(TEMPLATE_FILE_MAX_KEYS)
    .refine((keys) => new Set(keys.map((k) => k.name)).size === keys.length, "Each variable name once"),
});
export type TemplateFile = z.infer<typeof templateFileSchema>;

/**
 * The template file for this project's names. Names in the file keep their
 * description, link and optional. New names go at the end, with the catalog
 * entry for known names. Names no longer in the project are dropped.
 */
export function mergeTemplateFile(
  file: TemplateFile | null,
  names: readonly string[],
  projectName: string,
  index: Pick<KnownKeyIndex, "get"> = BUNDLED_KNOWN_KEYS
): TemplateFile {
  const wanted = new Set(names);
  const kept = (file?.keys ?? []).filter((k) => wanted.has(k.name));
  const have = new Set(kept.map((k) => k.name));
  const added = [...wanted].filter((n) => !have.has(n)).map((n) => withCatalog(n, index));
  return {
    ...file,
    name: file?.name ?? projectName.slice(0, 80),
    keys: [...kept, ...added],
  };
}

/** Public ids are short and random, like a paste link. */
export const templatePublicIdSchema = z.string().regex(/^[A-Za-z0-9]{8,16}$/);

/** The public id from an id or a full template URL. */
export function parseTemplateRef(ref: string): string | null {
  const trimmed = ref.trim();
  const match = /\/t\/([A-Za-z0-9]{8,16})\/?(?:[?#].*)?$/.exec(trimmed);
  const id = match?.[1] ?? trimmed;
  return templatePublicIdSchema.safeParse(id).success ? id : null;
}
