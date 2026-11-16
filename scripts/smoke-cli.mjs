/**
 * CLI smoke test from the packed tarballs, the way users get it.
 *
 * Packs @getmyenv/shared, @getmyenv/crypto and getmyenv, installs them into an
 * empty temp project with npm, then runs `npx getmyenv` with no TTY, no token
 * and temp config dirs:
 *
 * - --version matches packages/cli/package.json
 * - --help lists every top-level command in CLI_COMMANDS
 * - run, in each flag placement, stops with the "not linked" next steps
 *   (no stack trace, no parse error)
 * - bare `npx getmyenv` prints next steps without prompting, and exits 1
 *
 * No server runs here. scripts/e2e-cli.mjs runs the CLI against a server.
 * Needs the three packages built. Run: pnpm smoke:cli (--keep keeps the temp dir)
 */
import { assertBuilt, checker, cliEnv, cliRunner, cliVersion, loadShared, packAndInstall } from "./lib/pack-cli.mjs";

assertBuilt();
const shared = await loadShared();
const version = cliVersion();

const { tmp, app, home } = packAndInstall("getmyenv-smoke-");
const getmyenv = cliRunner({ cwd: app, env: cliEnv({ tmp, home, apiUrl: "http://localhost:9" }) });
const { check, finish } = checker();

const NOT_LINKED = "This folder is not linked to a getmyenv project.";
const STACK = /\n\s+at\s|error: unknown option|error: too many arguments/;

const v = getmyenv(["--version"]);
check(`--version is ${version}`, v.status === 0 && v.stdout.trim() === version, v);

const help = getmyenv(["--help"]);
const top = shared.CLI_COMMANDS.filter((c) => !c.name.includes(" ")).map((c) => c.name);
const missing = top.filter((name) => !new RegExp(`^\\s+${name}\\b`, "m").test(help.stdout));
check(`--help lists ${top.join(", ")}`, help.status === 0 && missing.length === 0, {
  ...help,
  stderr: `${help.stderr}\nMissing: ${missing.join(", ")}`,
});

for (const args of [
  ["run", "--explain", "staging"],
  ["run", "staging", "--explain", "--", "node", "-v"],
  ["run", "-c", "staging", "--explain", "--", "node", "-v"],
  ["run", "--", "node", "-v"],
]) {
  const r = getmyenv(args);
  check(
    `${args.join(" ")} stops with next steps`,
    r.status !== 0 && r.stderr.includes(NOT_LINKED) && !STACK.test(r.stderr),
    r
  );
}

const bare = getmyenv([]);
check(
  "bare npx getmyenv prints next steps and exits 1",
  bare.status === 1 && bare.stderr.includes(NOT_LINKED) && !STACK.test(bare.stderr),
  bare
);

finish(tmp, `CLI smoke test passed on ${process.platform} (Node ${process.versions.node}).`);
