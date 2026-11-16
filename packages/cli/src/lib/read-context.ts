import { decryptSecret, parsePayload, type SealedKey } from "@getmyenv/crypto";
import type { ContextInfo } from "./api.js";
import type { Linked } from "./bootstrap.js";
import { resolveValues, type ResolveOk, type ResolvePurpose } from "./resolve.js";
import { assertVariableNames, type MissingKey } from "./run-env.js";
import { contextKey } from "./vault.js";

export type ContextData = {
  sealedKey: SealedKey | null;
  values: Array<{ name: string; ciphertext: string }>;
  missing: MissingKey[];
};

export type DecryptedContext = {
  values: Record<string, string>;
  missing: MissingKey[];
  /** Null when the context has no values yet. */
  key: Uint8Array | null;
};

/** Check names, open the context key and decrypt every value. Runs on this machine only. */
export async function decryptContext(linked: Linked, ctx: ContextInfo, data: ContextData): Promise<DecryptedContext> {
  assertVariableNames([...data.values.map((v) => v.name), ...data.missing.map((m) => m.name)]);
  const values: Record<string, string> = {};
  if (data.values.length === 0) return { values, missing: data.missing, key: null };
  const key = await contextKey(linked, { ...ctx, sealedKey: data.sealedKey });
  for (const v of data.values) {
    values[v.name] = decryptSecret(key, v.name, parsePayload(v.ciphertext));
  }
  return { values, missing: data.missing, key };
}

/** Resolve one context (approval for Read-only ones, as `run` does) and decrypt it. */
export async function readContextValues(
  linked: Linked,
  slug: string,
  purpose: ResolvePurpose
): Promise<DecryptedContext & { context: ResolveOk["context"]; via: ResolveOk["via"] }> {
  const res = await resolveValues(linked.client, linked.who.project.id, slug, purpose);
  const decrypted = await decryptContext(linked, res.context, res);
  return { ...decrypted, context: res.context, via: res.via };
}
