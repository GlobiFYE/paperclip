/**
 * Renders a top-level CLI failure so it is never blank. Node connection
 * failures (for example localhost resolving to both ::1 and 127.0.0.1) throw an
 * AggregateError whose own message is empty; printing only `err.message` made
 * `paperclipai run` exit 1 with no visible reason.
 *
 * Nested errors are expanded only when the outer message is empty. Commands
 * such as test-drive redact credentials from the outer message while keeping
 * the raw error as `cause`, so printing causes alongside a message would
 * re-expose what was redacted.
 */
export function formatCliError(err: unknown, depth = 0): string {
  if (!(err instanceof Error)) {
    if (typeof err === "string") return err;
    try {
      return JSON.stringify(err) ?? String(err);
    } catch {
      return String(err);
    }
  }

  const code = (err as { code?: unknown }).code;
  const message = err.message.trim();
  let line = message.length > 0 ? message : err.name || "Error";
  if (typeof code === "string" && !line.includes(code)) line = `${line} [${code}]`;
  if (message.length > 0 || depth >= 3) return line;

  const indent = "  ".repeat(depth + 1);
  const details: string[] = [];
  if (err instanceof AggregateError) {
    for (const inner of err.errors) details.push(`${indent}- ${formatCliError(inner, depth + 1)}`);
  }
  if (err.cause !== undefined) details.push(`${indent}caused by: ${formatCliError(err.cause, depth + 1)}`);
  return details.length > 0 ? [line, ...details].join("\n") : line;
}
