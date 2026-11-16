import { afterEach, describe, expect, it, vi } from "vitest";
import { formatRecoveryCode, generateRecoveryCode } from "@getmyenv/crypto";
import { confirmRecoveryCode, createAccountKeys, NO_TTY_FOR_VAULT } from "./recovery-code.js";

const stdinTTY = Object.getOwnPropertyDescriptor(process.stdin, "isTTY");

afterEach(() => {
  if (stdinTTY) Object.defineProperty(process.stdin, "isTTY", stdinTTY);
  else delete (process.stdin as { isTTY?: boolean }).isTTY;
  vi.restoreAllMocks();
});

describe("confirmRecoveryCode", () => {
  it("accepts the code typed back in any case, with or without dashes", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const code = generateRecoveryCode();
    const ask = vi.fn(async () => formatRecoveryCode(code).toLowerCase().replaceAll("-", " "));
    await expect(confirmRecoveryCode(code, ask)).resolves.toBeUndefined();
    expect(ask).toHaveBeenCalledTimes(1);
  });

  it("asks again after a wrong code, then accepts the right one", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const code = generateRecoveryCode();
    const ask = vi.fn().mockResolvedValueOnce("nope").mockResolvedValueOnce(code);
    await expect(confirmRecoveryCode(code, ask)).resolves.toBeUndefined();
    expect(ask).toHaveBeenCalledTimes(2);
  });

  it("refuses after three wrong codes, so nothing is saved", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const code = generateRecoveryCode();
    const ask = vi.fn(async () => generateRecoveryCode());
    await expect(confirmRecoveryCode(code, ask)).rejects.toThrow(
      "The recovery code did not match. Nothing was saved. Run the command again."
    );
    expect(ask).toHaveBeenCalledTimes(3);
  });
});

describe("createAccountKeys", () => {
  it("stops before any prompt without a terminal", async () => {
    Object.defineProperty(process.stdin, "isTTY", { value: false, configurable: true });
    const err = vi.spyOn(console, "error").mockImplementation(() => undefined);
    await expect(createAccountKeys()).rejects.toThrow(NO_TTY_FOR_VAULT);
    expect(err).not.toHaveBeenCalled();
  });
});
