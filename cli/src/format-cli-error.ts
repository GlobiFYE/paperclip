/**
 * Renders a top-level CLI failure so it is never blank. Node connection
 * failures (for example localhost resolving to both ::1 and 127.0.0.1) throw an
 * AggregateError whose own message is empty; printing only `err.message` made
 * `paperclipai run` exit 1 with no visible reason.
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
  if (message.length > 0 && err.name && err.name !== "Error") line = `${err.name}: ${line}`;
  if (typeof code === "string" && !line.includes(code)) line = `${line} [${code}]`;

  if (depth >= 3) return line;
  const indent = "  ".repeat(depth + 1);
  const details: string[] = [];
  if (err instanceof AggregateError) {
    for (const inner of err.errors) details.push(`${indent}- ${formatCliError(inner, depth + 1)}`);
  }
  if (err.cause !== undefined) details.push(`${indent}caused by: ${formatCliError(err.cause, depth + 1)}`);
  return details.length > 0 ? [line, ...details].join("\n") : line;
}
