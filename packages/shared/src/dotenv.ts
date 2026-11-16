/**
 * Port of dotenv 16 `parse` for the browser (dotenv itself imports node:fs).
 * Same rules: multiline quoted values, inline comments, `export`, BOM, and
 * \n / \r escapes inside double quotes. Tested against dotenv in the CLI.
 */
const LINE =
  /(?:^|^)\s*(?:export\s+)?([\w.-]+)(?:\s*=\s*?|:\s+?)(\s*'(?:\\'|[^'])*'|\s*"(?:\\"|[^"])*"|\s*`(?:\\`|[^`])*`|[^#\r\n]+)?\s*(?:#.*)?(?:$|$)/gm;

/** Same line rule with any key, to report names dotenv would skip. */
const ANY_KEY_LINE =
  /(?:^|^)\s*(?:export\s+)?([^\s=:#'"`]+)(?:\s*=\s*?)(\s*'(?:\\'|[^'])*'|\s*"(?:\\"|[^"])*"|\s*`(?:\\`|[^`])*`|[^#\r\n]+)?\s*(?:#.*)?(?:$|$)/gm;

/** Every KEY in KEY=VALUE lines, including names that are not valid variables. */
export function dotenvKeys(src: string): string[] {
  const lines = src.replace(/\r\n?/gm, "\n");
  const keys: string[] = [];
  ANY_KEY_LINE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = ANY_KEY_LINE.exec(lines)) != null) keys.push(match[1]!);
  return keys;
}

/** KEY=VALUE pairs by dotenv rules. Keys dotenv would skip are dropped; a repeated key keeps the last value. */
export function parseDotenv(src: string): Record<string, string> {
  const obj: Record<string, string> = {};
  const lines = src.replace(/\r\n?/gm, "\n");
  LINE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = LINE.exec(lines)) != null) {
    const key = match[1]!;
    let value = (match[2] ?? "").trim();
    const maybeQuote = value[0];
    value = value.replace(/^(['"`])([\s\S]*)\1$/gm, "$2");
    if (maybeQuote === '"') {
      value = value.replace(/\\n/g, "\n").replace(/\\r/g, "\r");
    }
    obj[key] = value;
  }
  return obj;
}

/**
 * Quote a value so parseDotenv / dotenv.parse return it unchanged.
 * A value holding all three quote kinds gets double quotes with line breaks
 * written as \n and \r, which dotenv expands. A `#` or a literal backslash-n
 * in such a value has no exact dotenv form.
 */
export function formatDotenvValue(value: string): string {
  if (value !== "" && !/[\s"'`#=\\]/.test(value)) return value;
  if (!value.includes("'")) return `'${value}'`;
  if (!value.includes("`")) return `\`${value}\``;
  return `"${value.replace(/\r/g, "\\r").replace(/\n/g, "\\n")}"`;
}
