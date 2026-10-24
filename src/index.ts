#!/usr/bin/env node

import dotenv from "dotenv";
import { createServer } from "./server.js";
import { runStdioTransport } from "./transports/stdio.js";
import { runHttpTransport } from "./transports/http.js";
import { loadHttpConfig } from "./config.js";
import { SERVER_VERSION } from "./constants.js";
import { isReadOnlyMode } from "./policy/read-only.js";

if (process.env.MSSQL_MCP_DOTENV === "1") dotenv.config();

async function main() {
  const transport = process.env.MCP_TRANSPORT ?? "stdio";
  const readOnly = isReadOnlyMode();
  const modeLabel = readOnly ? "read-only" : "read-write";
  const server = createServer({ readOnly });

  if (transport === "http") {
    const httpConfig = loadHttpConfig();
    console.error(`MSSQL MCP Server v${SERVER_VERSION} starting (HTTP mode, ${modeLabel})...`);
    await runHttpTransport(server, httpConfig);
  } else {
    console.error(`MSSQL MCP Server v${SERVER_VERSION} starting (stdio mode, ${modeLabel})...`);
    await runStdioTransport(server);
    console.error("Server ready.");
  }
}

main().catch((err) => {
  console.error("Fatal startup error:", err);
  process.exit(1);
});
