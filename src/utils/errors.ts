import { inspect } from "node:util";
import { normalizeOutput } from "./format.js";

export class McpToolError extends Error {
  constructor(message: string, public readonly cause?: unknown) {
    super(message);
    this.name = "McpToolError";
  }
}

export function toActionableError(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

// Logging a process-fatal error (uncaughtException/unhandledRejection) must
// (a) never throw itself, or the shutdown path is skipped and the pool is
// left open, (b) keep the fields that identify the failure: `cause`, Node's
// `code`/`errno`/`syscall`, mssql/tedious `number`/`lineNumber`/`originalError`,
// and `AggregateError.errors`, and (c) be bounded, so a pathological object
// graph cannot turn the crash log into a multi-megabyte stderr write.
// util.inspect gives (a) and (b) for any value, including null-prototype
// objects, objects with a throwing toString, and circular graphs.
// See https://github.com/BYMCS/mssql-mcp/issues/5.
const FATAL_INSPECT_DEPTH = 4;
const FATAL_MAX_LINES = 200;
// Defence in depth: the drivers in use attach only code/cause/originalError to
// their errors, but an arbitrary application error may carry a config object.
const REDACT_KEY_PATTERN = /((?:^|[\s{,])(?:password|pwd|secret|token|authorization)\s*:\s*)(['"`])(?:(?!\2).)*\2/gi;

export function formatFatalError(error: unknown): string {
  const inspected = inspect(error, { depth: FATAL_INSPECT_DEPTH, breakLength: 120 });
  const redacted = inspected.replace(REDACT_KEY_PATTERN, "$1'[redacted]'");
  const lines = redacted.split("\n");
  if (lines.length <= FATAL_MAX_LINES) return redacted;
  const kept = lines.slice(0, FATAL_MAX_LINES - 1);
  return `${kept.join("\n")}\n... (${lines.length - kept.length} more lines truncated)`;
}

export function toolError(message: string) {
  return {
    content: [{ type: "text" as const, text: `❌ ${message}` }],
    isError: true as const,
  };
}

export function toolSuccessMarkdown(text: string) {
  return {
    content: [{ type: "text" as const, text }],
  };
}

export function toolSuccess(text: string, structuredContent?: Record<string, unknown>) {
  const result: {
    content: Array<{ type: "text"; text: string }>;
    structuredContent?: Record<string, unknown>;
  } = {
    content: [{ type: "text" as const, text }],
  };
  if (structuredContent !== undefined) {
    result.structuredContent = normalizeOutput(structuredContent) as Record<string, unknown>;
  }
  return result;
}
