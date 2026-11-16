import { describe, expect, it } from "vitest";
import { didYouMean } from "./known-keys.js";

describe("didYouMean", () => {
  it("suggests the name an SDK reads", () => {
    expect(didYouMean("OPEN_AI_KEY")).toBe("Did you mean OPENAI_API_KEY? OpenAI SDKs read that name.");
  });

  it("stays quiet for known and unrelated names", () => {
    expect(didYouMean("OPENAI_API_KEY")).toBeNull();
    expect(didYouMean("MY_FEATURE_FLAG")).toBeNull();
  });
});
