/**
 * Tool results. Two kinds, deliberately different (design section 7):
 *
 * - success: the tool did its job. A short text for people, the JSON for clients that
 *   only read text, and structuredContent for programs.
 * - domain error: the tool understood the request but cannot do the job with this
 *   input (unknown course, empty document, path outside the allowed roots). isError:
 *   true with a stable code and a hint, so the model can correct itself and call again.
 *
 * Protocol errors (unknown tool, malformed request) never get here; the SDK answers
 * those with JSON-RPC errors. A domain error carries no structuredContent: some
 * clients validate it against the outputSchema even when isError is true.
 */
import type { CallToolResult } from '@modelcontextprotocol/server';
import { logError } from './logger.ts';

export type DomainErrorCode =
  | 'unknown_course'
  | 'unknown_module'
  | 'invalid_catalog'
  | 'empty_document'
  | 'document_too_large'
  | 'path_not_allowed'
  | 'file_not_found'
  | 'unsupported_combination'
  | 'no_activities_found'
  | 'unknown_objective_ids'
  | 'invalid_document';

/** Thrown inside the server; turned into an isError result at the tool boundary. */
export class DomainError extends Error {
  readonly code: DomainErrorCode;
  readonly hint: string;
  constructor(code: DomainErrorCode, message: string, hint: string) {
    super(message);
    this.name = 'DomainError';
    this.code = code;
    this.hint = hint;
  }
}

export function success(summary: string, data: Record<string, unknown>): CallToolResult {
  return {
    content: [
      { type: 'text', text: summary },
      // The specification recommends the serialized JSON as text for clients that do
      // not read structuredContent.
      { type: 'text', text: JSON.stringify(data) },
    ],
    structuredContent: data,
  };
}

export function domainError(error: DomainError): CallToolResult {
  return {
    isError: true,
    content: [{ type: 'text', text: `${error.code}: ${error.message}\nHint: ${error.hint}` }],
  };
}

/**
 * Runs a tool body. Domain errors become isError results with code and hint. Anything
 * else is a bug: the stack goes to stderr, the client gets no internals. (The SDK would
 * turn an uncaught exception into an isError result with the raw message.)
 */
export async function guarded(
  tool: string,
  body: () => CallToolResult | Promise<CallToolResult>,
): Promise<CallToolResult> {
  try {
    return await body();
  } catch (error) {
    if (error instanceof DomainError) return domainError(error);
    logError(`${tool} failed`, error);
    return {
      isError: true,
      content: [
        { type: 'text', text: `internal_error: ${tool} failed unexpectedly. See the server log.` },
      ],
    };
  }
}
