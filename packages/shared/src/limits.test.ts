import { describe, expect, it } from "vitest";
import { FACTS, MAX_CIPHERTEXT_CHARS, MAX_VALUES_PER_REQUEST } from "./facts.js";
import { encryptedValueSchema, setValuesSchema } from "./schemas.js";

const value = (i: number, ciphertext = "c") => ({ name: `KEY_${i}`, ciphertext });

describe("value limits (FACTS.valueLimits)", () => {
  it(`accepts ${MAX_VALUES_PER_REQUEST} values per request and refuses one more`, () => {
    const max = Array.from({ length: MAX_VALUES_PER_REQUEST }, (_, i) => value(i));
    expect(setValuesSchema.safeParse({ values: max, keyVersion: 0 }).success).toBe(true);
    expect(
      setValuesSchema.safeParse({ values: [...max, value(MAX_VALUES_PER_REQUEST)], keyVersion: 0 }).success
    ).toBe(false);
  });

  it(`accepts ${MAX_CIPHERTEXT_CHARS} ciphertext characters and refuses one more`, () => {
    expect(encryptedValueSchema.safeParse(value(0, "c".repeat(MAX_CIPHERTEXT_CHARS))).success).toBe(true);
    expect(encryptedValueSchema.safeParse(value(0, "c".repeat(MAX_CIPHERTEXT_CHARS + 1))).success).toBe(false);
  });

  it("the sentence states the enforced numbers", () => {
    expect(FACTS.valueLimits).toContain(`${MAX_VALUES_PER_REQUEST} values per request`);
    expect(FACTS.valueLimits).toContain(MAX_CIPHERTEXT_CHARS.toLocaleString("en-US"));
  });
});
