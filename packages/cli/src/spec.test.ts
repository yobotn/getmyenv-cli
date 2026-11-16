import type { Command } from "commander";
import { CLI_API_OPTION, CLI_COMMANDS, CLI_ENV_VARS, CLI_GLOBAL_OPTIONS, cliCommand } from "@getmyenv/shared";
import { describe, expect, it } from "vitest";
import { buildProgram } from "./cli.js";

function walk(cmd: Command, prefix = ""): Array<{ name: string; cmd: Command }> {
  return cmd.commands.flatMap((c) => {
    const name = prefix ? `${prefix} ${c.name()}` : c.name();
    return [{ name, cmd: c }, ...walk(c, name)];
  });
}

const program = buildProgram(["node", "getmyenv"]);
const registered = walk(program);
const argName = (a: { name(): string; required: boolean; variadic: boolean }) => {
  const inner = `${a.name()}${a.variadic ? "..." : ""}`;
  return a.required ? `<${inner}>` : `[${inner}]`;
};

describe("CLI spec parity", () => {
  it("registers exactly the commands in the spec", () => {
    const spec = CLI_COMMANDS.map((c) => c.name).filter((n) => n !== "help");
    expect(registered.map((r) => r.name).sort()).toEqual([...spec].sort());
  });

  it.each(registered)("$name has the spec's arguments and flags", ({ name, cmd }) => {
    const spec = CLI_COMMANDS.find((c) => c.name === name)!;
    expect(cmd.description()).toBe(spec.description);
    expect(cmd.registeredArguments.map(argName)).toEqual(spec.args.map((a) => a.name));
    const flags = cmd.options.map((o) => o.flags).filter((f) => f !== CLI_API_OPTION.flags);
    expect(flags).toEqual(spec.options.map((o) => o.flags));
  });

  it("takes the version, help flag and help command descriptions from the spec", () => {
    let help = "";
    program.configureOutput({ writeOut: (s) => (help += s) });
    program.outputHelp();
    for (const o of CLI_GLOBAL_OPTIONS) expect(help).toContain(o.description);
    expect(help).toContain(cliCommand("help").description);
  });

  it("lists every environment variable in the root help", () => {
    let help = "";
    program.configureOutput({ writeOut: (s) => (help += s) });
    program.outputHelp();
    for (const v of CLI_ENV_VARS) expect(help).toContain(v.name);
  });
});
