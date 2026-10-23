import { McpServer } from "@modelcontextprotocol/server";
import { SERVER_NAME, SERVER_VERSION } from "./constants.js";
import { registerConnectTools } from "./tools/connect.js";
import { registerStatusTool } from "./tools/status.js";
import { registerQueryTools } from "./tools/query.js";
import { registerSchemaTools } from "./tools/schema.js";
import { registerTableTools } from "./tools/table.js";
import { registerProcedureTools } from "./tools/procedure.js";
import { registerDatabasesTools } from "./tools/databases.js";
import { registerConnectionResource } from "./resources/connection.js";
import { registerMetadataResources } from "./resources/metadata.js";
import { isReadOnlyMode } from "./policy/read-only.js";
import type { ToolRegistrationOptions } from "./types.js";

export function createServer(options: { readOnly?: boolean } = {}): McpServer {
  const readOnly = options.readOnly ?? isReadOnlyMode();
  const opts: ToolRegistrationOptions = { readOnly };
  const server = new McpServer({
    name: SERVER_NAME,
    version: SERVER_VERSION,
  });

  registerConnectTools(server, opts);
  registerStatusTool(server, opts);
  registerQueryTools(server, opts);
  registerSchemaTools(server, opts);
  registerTableTools(server, opts);
  if (!readOnly) registerProcedureTools(server);
  registerDatabasesTools(server);
  registerConnectionResource(server, opts);
  registerMetadataResources(server);

  return server;
}
