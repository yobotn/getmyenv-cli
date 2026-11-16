import { hkdf } from "@noble/hashes/hkdf.js";
import { hmac } from "@noble/hashes/hmac.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToBase64Url, utf8Encode } from "./bytes.js";
import { wipe } from "./wrap.js";

const HKDF_INFO_PUSH = "getmyenv push fingerprint";

/**
 * Change detection for a push: HMAC-SHA256 over the sorted name/value pairs,
 * keyed from the context key. Not a protection for the values. The key only
 * stops the server, which stores the result, from guessing short values.
 */
export function pushFingerprint(contextKey: Uint8Array, values: Record<string, string>): string {
  const key = hkdf(sha256, contextKey, new Uint8Array(0), utf8Encode(HKDF_INFO_PUSH), 32);
  const lines = Object.keys(values)
    .sort()
    .map((name) => `${name}\0${values[name]}`)
    .join("\n");
  const mac = hmac(sha256, key, utf8Encode(lines));
  wipe(key);
  return bytesToBase64Url(mac);
}
