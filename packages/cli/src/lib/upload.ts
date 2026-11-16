import { encryptSecret, serializePayload } from "@getmyenv/crypto";
import { FACTS } from "@getmyenv/shared";
import { ApiError, type ContextInfo } from "./api.js";
import type { Linked } from "./bootstrap.js";
import { writeKey } from "./vault.js";

/** Fail fast before prompting or encrypting. Mirrors the server's `checkWrite`, which still enforces it. */
export function assertWritable(linked: Linked, ctx: ContextInfo): void {
  if (linked.who.token.kind === "server") {
    throw new Error(`Server tokens cannot change values. ${FACTS.readOnlyWho}`);
  }
  if (ctx.protection === "locked") {
    throw new Error(`${ctx.slug} is Read-only. ${FACTS.readOnlyWho}`);
  }
}

/**
 * Encrypt values locally and upload ciphertext to one open context.
 * Empty values are declared as keys with no value in this context.
 */
export async function uploadValues(input: {
  linked: Linked;
  context: ContextInfo;
  pairs: Record<string, string>;
  prune?: boolean;
  expiresAt?: string | null;
}): Promise<{ set: string[]; pruned: string[]; declared: string[] }> {
  const { linked, context } = input;
  assertWritable(linked, context);

  const filled = Object.entries(input.pairs).filter(([, v]) => v !== "");
  const declare = Object.entries(input.pairs)
    .filter(([, v]) => v === "")
    .map(([k]) => k);

  let values: Array<{ name: string; ciphertext: string; expiresAt?: string | null }> = [];
  let keyVersion: number | undefined;
  if (filled.length > 0) {
    const write = await writeKey(linked, context);
    keyVersion = write.keyVersion;
    values = filled.map(([name, value]) => ({
      name,
      ciphertext: serializePayload(encryptSecret(write.key, name, value)),
      ...(input.expiresAt !== undefined ? { expiresAt: input.expiresAt } : {}),
    }));
  }

  const body = {
    context: context.slug,
    values,
    ...(keyVersion !== undefined ? { keyVersion } : {}),
    ...(input.prune ? { prune: true } : {}),
    ...(declare.length > 0 ? { declare } : {}),
  };
  if (Buffer.byteLength(JSON.stringify(body)) > UPLOAD_MAX_BYTES) {
    throw new Error("Too much to upload at once (max 1 MB encrypted). Split the file and import each part.");
  }
  try {
    return await linked.client.request<{ set: string[]; pruned: string[]; declared: string[] }>(
      "POST",
      "/api/cli/values",
      body
    );
  } catch (err) {
    if (err instanceof ApiError && err.status >= 500) {
      throw new ApiError(
        `${err.message} Some values may already be saved. npx getmyenv ls shows what is set in ${context.slug}.`,
        err.status
      );
    }
    throw err;
  }
}

/** Matches the server limit on `/api/cli/values`. */
const UPLOAD_MAX_BYTES = 1024 * 1024;
