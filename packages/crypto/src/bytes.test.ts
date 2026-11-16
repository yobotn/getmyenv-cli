import { describe, expect, it } from "vitest";
import { base64UrlToBytes, bytesToBase64Url } from "./bytes.js";

describe("base64url", () => {
  it("drops padding and round-trips every length", () => {
    for (let len = 0; len < 40; len++) {
      const bytes = Uint8Array.from({ length: len }, (_, i) => (i * 37 + 251) % 256);
      const encoded = bytesToBase64Url(bytes);
      expect(encoded).not.toMatch(/[=+/]/);
      expect(base64UrlToBytes(encoded)).toEqual(bytes);
    }
  });
});
