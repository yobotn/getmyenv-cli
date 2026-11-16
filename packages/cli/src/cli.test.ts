import { describe, expect, it } from "vitest";
import { splitRunArgs } from "./cli.js";

/** Commander passes the operands (without `--`) and we read the raw argv. */
function split(line: string, explain = false) {
  const argv = ["node", "getmyenv", "run", ...line.split(" ").filter(Boolean)];
  const operands = argv.slice(3).filter((a) => a !== "--" && !a.startsWith("--explain"));
  return splitRunArgs(operands, argv, explain);
}

describe("splitRunArgs", () => {
  it("run -- cmd uses the default context", () => {
    expect(split("-- npm start")).toEqual({ context: undefined, command: ["npm", "start"] });
  });

  it("run <context> -- cmd picks the context", () => {
    expect(split("staging -- npm run dev")).toEqual({
      context: "staging",
      command: ["npm", "run", "dev"],
    });
  });

  it("run cmd without -- treats everything as the command", () => {
    expect(split("node app.mjs")).toEqual({ command: ["node", "app.mjs"] });
  });

  it("keeps flags after -- for the child", () => {
    expect(split("staging -- node --watch app.mjs").command).toEqual([
      "node",
      "--watch",
      "app.mjs",
    ]);
  });

  it("run --explain <context> with no command", () => {
    expect(split("--explain staging", true)).toEqual({ context: "staging", command: [] });
  });

  it("run <context> --explain -- cmd", () => {
    expect(split("staging --explain -- npm start", true)).toEqual({
      context: "staging",
      command: ["npm", "start"],
    });
  });

  it("run -c <context> --explain -- cmd leaves the context to -c", () => {
    const argv = ["node", "getmyenv", "run", "-c", "staging", "--explain", "--", "npm", "start"];
    expect(splitRunArgs(["npm", "start"], argv, true)).toEqual({ context: undefined, command: ["npm", "start"] });
  });
});
