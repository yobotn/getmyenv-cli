import { describe, expect, it } from "vitest";
import { buildProgram, splitRunArgs, unknownRunOption } from "./cli.js";

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

describe("unknownRunOption", () => {
  const argv = (line: string) => ["node", "getmyenv", ...line.split(" ").filter(Boolean)];

  it("catches a typo before --", () => {
    expect(unknownRunOption(argv("run --explian -- echo hi"))).toBe("--explian");
    expect(unknownRunOption(argv("run staging --explian -- echo hi"))).toBe("--explian");
    expect(unknownRunOption(argv("run --explian=yes -- echo hi"))).toBe("--explian");
  });

  it("catches a typo before the command word when there is no --", () => {
    expect(unknownRunOption(argv("run --allow-mising npm start"))).toBe("--allow-mising");
  });

  it("accepts known run flags, values and global flags", () => {
    expect(unknownRunOption(argv("run -c staging --explain -- npm start"))).toBeNull();
    expect(unknownRunOption(argv("run --context=staging --allow-missing --keep-existing -- npm start"))).toBeNull();
    expect(unknownRunOption(argv("run -cstaging --allow-unsafe-env -- npm start"))).toBeNull();
    expect(unknownRunOption(argv("run --api-url http://localhost:3000 -- npm start"))).toBeNull();
    expect(unknownRunOption(argv("--api-url http://localhost:3000 run -- npm start"))).toBeNull();
    expect(unknownRunOption(argv("run --help"))).toBeNull();
  });

  it("leaves the child's own flags alone", () => {
    expect(unknownRunOption(argv("run -- node --watch app.mjs"))).toBeNull();
    expect(unknownRunOption(argv("run node --watch app.mjs"))).toBeNull();
    expect(unknownRunOption(argv("run --explain node --inspect app.mjs"))).toBeNull();
  });
});

describe("run with an unknown option", () => {
  it("stops before anything runs, with the help pointer", async () => {
    for (const line of [["--explian", "--", "echo", "hi"], ["--allow-mising", "npm", "start"]]) {
      const argv = ["node", "getmyenv", "run", ...line];
      await expect(buildProgram(argv).parseAsync(argv)).rejects.toThrow(
        `Unknown option ${line[0]}. See: npx getmyenv run --help`
      );
    }
  });
});
