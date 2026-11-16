import { pcErr as pc } from "./colors.js";
import { publicSecretWarning } from "@getmyenv/shared";
import { knownKeys } from "./known-keys-cache.js";

/** "Did you mean OPENAI_API_KEY?" for names close to a known one. Nothing is renamed. */
export function didYouMean(name: string): string | null {
  const near = knownKeys().nearMiss(name);
  if (!near) return null;
  const why = near.source === "sdk" ? `${near.provider} SDKs read that name.` : "That is the common name.";
  return `Did you mean ${near.name}? ${why}`;
}

export function printDidYouMean(names: string[], indent = ""): void {
  for (const name of names) {
    const hint = didYouMean(name);
    if (hint) console.error(pc.yellow(`${indent}${name}: ${hint}`));
  }
}

/** A public prefix (NEXT_PUBLIC_, VITE_, ...) on a value that looks secret. Nothing is blocked. */
export function printPublicSecretWarnings(pairs: Record<string, string>, indent = ""): void {
  for (const [name, value] of Object.entries(pairs)) {
    const warn = publicSecretWarning(name, value);
    if (warn) console.error(pc.yellow(`${indent}${warn}`));
  }
}
