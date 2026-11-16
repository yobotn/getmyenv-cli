import { describe, expect, it } from "vitest";
import { windowsArgument } from "./run-env.js";

/** The regex version this replaced, kept to prove the output did not change. */
function previous(arg: string, batch = false): string {
  if (arg !== "" && /^[\w\-.:/\\+@]+$/.test(arg)) return arg;
  const meta = /([()\][%!^"`<>&|;, *?])/g;
  let quoted = arg.replace(/(\\*)"/g, '$1$1\\"').replace(/(\\*)$/, "$1$1");
  quoted = `"${quoted}"`.replace(meta, "^$1");
  return batch ? quoted.replace(meta, "^$1") : quoted;
}

describe("windowsArgument", () => {
  const cases = [
    "",
    "plain",
    "two words",
    'say "hi"',
    "ends with \\",
    "ends with \\\\",
    'slash before quote \\"',
    'many \\\\\\" mixed \\ "end\\',
    "C:\\Program Files\\node.exe",
    "%PATH% & echo ^ | more",
    "tab\there",
    "üñíçødé \\ \"",
  ];

  it("matches the previous regex quoting", () => {
    for (const arg of cases) {
      expect(windowsArgument(arg)).toBe(previous(arg));
      expect(windowsArgument(arg, true)).toBe(previous(arg, true));
    }
  });

  it("matches the previous quoting on random input", () => {
    const alphabet = ['\\', '"', " ", "a", "%", "^", "&", "é"];
    let seed = 7;
    const rand = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
    for (let i = 0; i < 500; i++) {
      const len = Math.floor(rand() * 12);
      let arg = "";
      for (let j = 0; j < len; j++) arg += alphabet[Math.floor(rand() * alphabet.length)];
      expect(windowsArgument(arg)).toBe(previous(arg));
    }
  });

  it("stays fast on a long run of backslashes", () => {
    const arg = " " + "\\".repeat(100_000) + "x";
    const start = performance.now();
    windowsArgument(arg);
    expect(performance.now() - start).toBeLessThan(500);
  });
});
