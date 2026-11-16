import picocolors from "picocolors";

type Stream = { isTTY?: boolean };

/**
 * Color only for a terminal. picocolors alone turns color on for every Windows
 * process, so piped or redirected output would hold escape codes.
 * NO_COLOR turns it off, FORCE_COLOR turns it on.
 */
export function colorEnabled(stream: Stream, env: Record<string, string | undefined> = process.env): boolean {
  if (env.NO_COLOR) return false;
  if (env.FORCE_COLOR && env.FORCE_COLOR !== "0") return true;
  return Boolean(stream.isTTY) && env.TERM !== "dumb";
}

/** Colors for text written to stdout. */
export const pc = picocolors.createColors(colorEnabled(process.stdout));

/** Colors for text written to stderr: prompts, status lines and warnings. */
export const pcErr = picocolors.createColors(colorEnabled(process.stderr));
