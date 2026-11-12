/**
 * Logging for a stdio MCP server: stdout carries the JSON-RPC messages, so every log
 * line goes to stderr. One stray console.log would corrupt the protocol stream.
 */
const PREFIX = 'course-standards-mcp';

export function logInfo(message: string): void {
  process.stderr.write(`${PREFIX} info: ${message}\n`);
}

export function logWarn(message: string): void {
  process.stderr.write(`${PREFIX} warn: ${message}\n`);
}

export function logError(message: string, error?: unknown): void {
  const detail = error instanceof Error ? (error.stack ?? error.message) : String(error ?? '');
  process.stderr.write(`${PREFIX} error: ${message}${detail ? `\n${detail}` : ''}\n`);
}
