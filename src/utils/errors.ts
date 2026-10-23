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
// util.inspect caps each string at 10 000 chars by default, so a line cap
// alone does not bound the write; the byte cap does.
const FATAL_MAX_BYTES = 64_000;
// Defence in depth: the drivers in use attach only code/cause/originalError to
// their errors, but an arbitrary application error may carry a config object.
// Masks the value of any key that contains a credential-like word
// (db_password, saPassword, accessToken, ...). util.inspect renders a value
// either inline (quoted string, bare number/boolean, one-line object/array)
// or as a multi-line block whose closing bracket sits at the key's own
// indentation; both shapes are handled, so a nested `bearer: '...'` inside a
// wrapped `authorization: { ... }` block is masked with the block.
// Over-masking a harmless key such as tokenCount is acceptable in a crash log.
const REDACT_KEY = String.raw`[\w$-]*(?:password|pwd|secret|token|authorization)[\w$-]*`;
const REDACT_BLOCK_PATTERN = new RegExp(
  String.raw`^([ \t]*)(${REDACT_KEY}\s*:\s*)[\[{][^\n]*\n(?:(?!\1[\]}]).*\n)*?\1[\]}]`,
  "gim"
);
// An inline object/array value, with brackets balanced up to the inspect
// depth (util.inspect never renders deeper than FATAL_INSPECT_DEPTH levels).
const INLINE_BRACKETED = (() => {
  let level = String.raw`[\[{][^\[\]{}\n]*[\]}]`;
  for (let i = 1; i < FATAL_INSPECT_DEPTH; i++) {
    level = String.raw`[\[{](?:[^\[\]{}\n]|${level})*[\]}]`;
  }
  return level;
})();
const REDACT_INLINE_PATTERN = new RegExp(
  String.raw`((?:^|[\s{,\[])${REDACT_KEY}\s*:\s*)(?:(['"\x60])(?:(?!\2).)*\2|${INLINE_BRACKETED}|[^,\n}\]]+)`,
  "gi"
);

// Connection-string form inside a message or stack: `Password=...;`,
// `pwd=...`, `token=...` (terminated by `;`, whitespace, a quote or end).
const REDACT_ASSIGNMENT_PATTERN = new RegExp(String.raw`\b(${REDACT_KEY}\s*=\s*)[^;\s'"\x60]+`, "gi");

function redactCredentials(text: string): string {
  return text
    .replace(REDACT_BLOCK_PATTERN, "$1$2[redacted]")
    .replace(REDACT_INLINE_PATTERN, "$1[redacted]")
    .replace(REDACT_ASSIGNMENT_PATTERN, "$1[redacted]");
}

export function formatFatalError(error: unknown): string {
  let inspected: string;
  try {
    // customInspect: false so a throwing [util.inspect.custom] hook on the
    // value cannot make the crash handler itself throw.
    inspected = inspect(error, { depth: FATAL_INSPECT_DEPTH, breakLength: 120, customInspect: false });
  } catch (inspectError) {
    inspected = `[unprintable ${typeof error}: ${toActionableError(inspectError)}]`;
  }
  const redacted = redactCredentials(inspected);
  const lines = redacted.split("\n");
  let kept = lines.length <= FATAL_MAX_LINES ? lines : lines.slice(0, FATAL_MAX_LINES - 1);
  let text = kept.join("\n");
  if (Buffer.byteLength(text, "utf8") > FATAL_MAX_BYTES) {
    text = Buffer.from(text, "utf8").subarray(0, FATAL_MAX_BYTES).toString("utf8");
    kept = text.split("\n");
  }
  if (kept.length === lines.length && text.length === redacted.length) return text;
  return `${text}\n... (output truncated: ${lines.length - kept.length} more lines)`;
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
