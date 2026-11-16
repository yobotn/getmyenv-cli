import dotenv from "dotenv";
import { describe, expect, it } from "vitest";
import { formatDotenvValue, parseDotenv } from "@getmyenv/shared";
import { parseEnvText, readEnvText } from "./fs.js";

const PEM = "-----BEGIN KEY-----\nMIIB+abc/def==\n-----END KEY-----";

const CASES: Record<string, string> = {
  plain: "A=1\nB=two",
  bom: "\uFEFFA=1\nB=2",
  crlf: "A=1\r\nB=2\r\n",
  export: "export A=1",
  inlineComment: "A=value # comment\nB='kept # inside'",
  doubleEscapes: 'A="line1\\nline2"\nB="tab\\there"',
  singleNoEscapes: "A='line1\\nline2'",
  multiline: `KEY="${PEM}"\nNEXT=1`,
  backtick: "A=`it's \"quoted\"`",
  empty: "A=\nB=''",
  spaces: "A = spaced  \nB='  padded  '",
  badNames: "1BAD=x\nGOOD=y\nwith-dash=z\ndatabase_url=w",
};

describe("parseDotenv matches dotenv.parse", () => {
  for (const [name, src] of Object.entries(CASES)) {
    it(name, () => {
      expect(parseDotenv(src)).toEqual(dotenv.parse(src));
    });
  }
});

describe("parseEnvText", () => {
  it("keeps multiline PEM values", () => {
    expect(parseEnvText(CASES.multiline!).KEY).toBe(PEM);
  });

  it("strips inline comments and the BOM", () => {
    expect(parseEnvText(CASES.inlineComment!)).toEqual({ A: "value", B: "kept # inside" });
    expect(Object.keys(parseEnvText(CASES.bom!))).toEqual(["A", "B"]);
  });

  it("drops names that are not variables", () => {
    expect(parseEnvText(CASES.badNames!)).toEqual({ GOOD: "y" });
  });

  it("lists the names it skips", () => {
    expect(readEnvText(CASES.badNames!).skipped).toEqual(["1BAD", "with-dash", "database_url"]);
  });
});

describe("formatDotenvValue round-trips through dotenv", () => {
  const values = [
    "plain",
    "",
    "has space",
    "has#hash",
    'double"quote',
    "single'quote",
    "both'\"quotes",
    "all'three\"quote`kinds",
    "all'three\"quote`kinds\nsecond line",
    "C:\\path\\to",
    "literal\\nbackslash-n",
    PEM,
    "  padded  ",
    "a=b",
  ];
  for (const value of values) {
    it(JSON.stringify(value), () => {
      const line = `K=${formatDotenvValue(value)}`;
      expect(dotenv.parse(line).K).toBe(value);
    });
  }
});
