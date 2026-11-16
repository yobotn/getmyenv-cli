import { describe, expect, it } from "vitest";
import { grantRefusedMessage } from "./resolve.js";

describe("grantRefusedMessage", () => {
  it("adds one period between the reason and the retry step", () => {
    expect(grantRefusedMessage("This approval expired.")).toBe("This approval expired. Run the command again.");
    expect(grantRefusedMessage("Unauthorized")).toBe("Unauthorized. Run the command again.");
    expect(grantRefusedMessage("Grant used!  ")).toBe("Grant used. Run the command again.");
    expect(grantRefusedMessage("")).toBe("Run the command again.");
  });
});
