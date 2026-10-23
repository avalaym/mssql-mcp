import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/server";
import sql from "mssql";
import { requirePool } from "../db/connection.js";
import { assertReadOnlyStatement, runReadOnly } from "../policy/read-only.js";
import type { ToolRegistrationOptions } from "../types.js";
import { toActionableError, toolError, toolSuccess, toolSuccessMarkdown } from "../utils/errors.js";
import { formatJson, truncatePayload } from "../utils/format.js";
import { formatMarkdownTable } from "../utils/markdown.js";

type QueryParams = Record<string, string | number | boolean | null>;

async function runSqlQueryCore(
  query: string,
  parameters: QueryParams | undefined,
  response_format: "json" | "markdown",
  logLabel: string,
  readOnly: boolean
) {
  try {
    if (readOnly) assertReadOnlyStatement(query);
    const pool = requirePool();
    const execute = async (request: sql.Request) => {
      if (parameters) {
        for (const [key, value] of Object.entries(parameters)) {
          request.input(key, value);
        }
      }
      return request.query(query);
    };
    const start = Date.now();
    const result = readOnly ? await runReadOnly(pool, execute) : await execute(pool.request());
    const elapsed = Date.now() - start;

    const { data, truncated, truncation_message } = truncatePayload(result.recordset ?? []);
    const structured: Record<string, unknown> = {
      recordset: data,
      rows_affected: result.rowsAffected,
      output: result.output,
      execution_time_ms: elapsed,
      parameters_used: parameters ? Object.keys(parameters).length : 0,
      truncated,
    };
    if (truncation_message) structured.truncation_message = truncation_message;

    if (response_format === "markdown") {
      const rows = data as Record<string, unknown>[];
      let text = formatMarkdownTable(rows);
      if (truncated) text += `\n\n> ⚠️ ${truncation_message}`;
      text += `\n\n*Rows affected: ${(result.rowsAffected ?? []).join(", ")} · ${elapsed}ms*`;
      return toolSuccessMarkdown(text);
    }
    return toolSuccess(formatJson(structured), structured);
  } catch (err) {
    const msg = toActionableError(err);
    console.error(`${logLabel} failed:`, msg);
    return toolError(`Query failed: ${msg}`);
  }
}

export function registerQueryTools(server: McpServer, options: ToolRegistrationOptions): void {
  const { readOnly } = options;
  server.registerTool(
    "mssql_run_sql_query",
    {
      title: readOnly ? "Run SQL Query (read-only)" : "Run SQL Query",
      description: readOnly
        ? "Executes a single SELECT or WITH statement against the connected database inside a transaction that is always rolled back. " +
          "Read-only mode is defense in depth, not a guarantee: the connected principal's permissions decide what can change. " +
          "Comments, additional statements or transaction control, and write/exec keywords are rejected; the server also verifies the transaction boundary after each query. " +
          "Always prefer parameterized inputs via the 'parameters' field. " +
          "Example: query='SELECT * FROM dbo.Users WHERE Id = @id', parameters={id: 42}"
        : "Executes an arbitrary SQL statement against the connected database. " +
          "⚠️ WARNING: This tool can read AND modify data (INSERT, UPDATE, DELETE, DDL). " +
          "Always prefer parameterized inputs via the 'parameters' field — never embed user-supplied values " +
          "directly in the query string. " +
          "Example: query='SELECT * FROM dbo.Users WHERE Id = @id', parameters={id: 42}",
      inputSchema: z.object({
        query: z.string().min(1).describe("SQL statement to execute"),
        parameters: z
          .record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()]))
          .optional()
          .describe("Named parameters referenced in the query via @paramName"),
        response_format: z
          .enum(["json", "markdown"])
          .optional()
          .default("json")
          .describe("Output format: 'json' for structured data, 'markdown' for human-readable table"),
      }),
      annotations: readOnly
        ? { readOnlyHint: true, idempotentHint: true, openWorldHint: false }
        : { readOnlyHint: false, idempotentHint: false, openWorldHint: true },
    },
    ({ query, parameters, response_format }) =>
      runSqlQueryCore(query, parameters, response_format, "mssql_run_sql_query", readOnly)
  );

  if (readOnly) return;

  // Backward-compatible alias
  server.registerTool(
    "mssql_execute_query",
    {
      title: "Execute Query (deprecated — use mssql_run_sql_query)",
      description:
        "Deprecated alias for mssql_run_sql_query. Use mssql_run_sql_query instead. " +
        "⚠️ This tool can read AND modify data.",
      inputSchema: z.object({
        query: z.string().min(1).describe("SQL query to execute"),
        parameters: z
          .record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()]))
          .optional()
          .describe("Query parameters"),
        response_format: z.enum(["json", "markdown"]).optional().default("json"),
      }),
      annotations: { readOnlyHint: false, idempotentHint: false, openWorldHint: true },
    },
    ({ query, parameters, response_format }) =>
      runSqlQueryCore(query, parameters, response_format, "mssql_execute_query", false)
  );
}

