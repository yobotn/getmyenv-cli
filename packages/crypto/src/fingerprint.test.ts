import { describe, expect, it } from "vitest";
import { pushFingerprint } from "./fingerprint.js";
import { generateContextKey } from "./kdf.js";

describe("pushFingerprint", () => {
  const key = generateContextKey();

  it("is stable whatever the order of names", () => {
    expect(pushFingerprint(key, { A: "1", B: "2" })).toBe(pushFingerprint(key, { B: "2", A: "1" }));
  });

  it("changes when a value, a name or the key changes", () => {
    const base = pushFingerprint(key, { PORT: "3000" });
    expect(pushFingerprint(key, { PORT: "3001" })).not.toBe(base);
    expect(pushFingerprint(key, { PORT2: "3000" })).not.toBe(base);
    expect(pushFingerprint(generateContextKey(), { PORT: "3000" })).not.toBe(base);
  });

  it("does not let a name and value boundary move", () => {
    expect(pushFingerprint(key, { AB: "C" })).not.toBe(pushFingerprint(key, { A: "BC" }));
  });
});
