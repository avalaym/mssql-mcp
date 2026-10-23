import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/server";
import { getConnectionState, getPool } from "../db/connection.js";
import { sessionBlock } from "../db/session.js";
import type { ToolRegistrationOptions } from "../types.js";
import { toolSuccess } from "../utils/errors.js";
import { formatJson } from "../utils/format.js";

export function registerStatusTool(server: McpServer, options: ToolRegistrationOptions): void {
  server.registerTool(
    "mssql_connection_status",
    {
      title: "Connection Status",
      description:
        "Returns the current connection status, authentication method, read-only mode, session identity (login name, auth scheme), " +
        "the principal's write-privilege hints, and connection pool metrics. " +
        "Read-only. Safe to call at any time.",
      inputSchema: z.object({}),
      annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
    },
    async () => {
      const state: Record<string, unknown> = { ...getConnectionState(), read_only: options.readOnly };
      const pool = getPool();
      if (pool?.connected && state.connected) Object.assign(state, await sessionBlock(pool));
      return toolSuccess(formatJson(state), state);
    }
  );
}
