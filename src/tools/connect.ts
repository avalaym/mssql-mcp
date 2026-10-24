import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/server";
import { loadConfigFromEnv } from "../config.js";
import { connectPool, disconnectPool, getConnectionState, requirePool } from "../db/connection.js";
import { WRITABLE_PRINCIPAL_WARNING, sessionBlock } from "../db/session.js";
import type { ToolRegistrationOptions } from "../types.js";
import { toActionableError, toolError, toolSuccess } from "../utils/errors.js";

export function registerConnectTools(server: McpServer, options: ToolRegistrationOptions): void {
  server.registerTool(
    "mssql_connect_database",
    {
      title: "Connect Database",
      description:
        "Connects to MS SQL Server using environment variables (DB_SERVER, DB_DATABASE, DB_USER, DB_PASSWORD, " +
        "DB_PORT, DB_ENCRYPT, DB_TRUST_SERVER_CERTIFICATE, DB_AUTH_TYPE (sql|ntlm), DB_DOMAIN). No credentials accepted as parameters — all " +
        "connection settings come from the server environment only. The result reports the session identity and the principal's " +
        "privilege hints. Idempotent: calling again reconnects.",
      inputSchema: z.object({}),
      annotations: { readOnlyHint: false, idempotentHint: true, openWorldHint: false },
    },
    async () => {
      try {
        const config = loadConfigFromEnv();
        await connectPool(config);
        const block = await sessionBlock(requirePool());
        const state: Record<string, unknown> = { ...getConnectionState(), read_only: options.readOnly, ...block };
        let text = `✅ Connected to ${config.server}${config.database ? ` (database: ${config.database})` : ""}`;
        if (options.readOnly && "session" in block && block.session.principal.can_write === true) {
          text += "\n" + WRITABLE_PRINCIPAL_WARNING;
        }
        return toolSuccess(text, state);
      } catch (err) {
        const msg = toActionableError(err);
        console.error("mssql_connect_database failed:", msg);
        return toolError(`Connection failed: ${msg}`);
      }
    }
  );

  server.registerTool(
    "mssql_disconnect_database",
    {
      title: "Disconnect Database",
      description:
        "Closes the current database connection and releases the connection pool. " +
        "Safe to call even if not connected. Idempotent.",
      inputSchema: z.object({}),
      annotations: { readOnlyHint: false, idempotentHint: true, openWorldHint: false },
    },
    async () => {
      try {
        await disconnectPool();
        const msg = "✅ Disconnected from database.";
        return toolSuccess(msg, { message: msg });
      } catch (err) {
        return toolError(`Disconnect failed: ${toActionableError(err)}`);
      }
    }
  );
}

