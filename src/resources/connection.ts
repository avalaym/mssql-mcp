import type { McpServer } from "@modelcontextprotocol/server";
import { getConnectionState, getPool } from "../db/connection.js";
import { sessionBlock } from "../db/session.js";
import type { ToolRegistrationOptions } from "../types.js";

export function registerConnectionResource(server: McpServer, options: ToolRegistrationOptions): void {
  server.registerResource(
    "connection-info",
    "mssql://connection/info",
    {
      title: "Connection Info",
      description: "Current MSSQL connection status and configuration (no credentials exposed).",
      mimeType: "application/json",
    },
    async () => {
      const state: Record<string, unknown> = { ...getConnectionState(), read_only: options.readOnly };
      const pool = getPool();
      if (pool?.connected && state.connected) Object.assign(state, await sessionBlock(pool));
      return {
        contents: [
          {
            uri: "mssql://connection/info",
            text: JSON.stringify(state, null, 2),
            mimeType: "application/json",
          },
        ],
      };
    }
  );
}
