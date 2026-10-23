import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import {
  NodeStreamableHTTPServerTransport,
  originValidation,
  hostHeaderValidation,
} from "@modelcontextprotocol/node";
import type { McpServer } from "@modelcontextprotocol/server";
import { closePoolOnShutdown } from "../db/connection.js";
import { formatFatalError } from "../utils/errors.js";
import { SHUTDOWN_TIMEOUT_MS } from "../constants.js";
import type { HttpConfig } from "../config.js";

export async function runHttpTransport(server: McpServer, config: HttpConfig): Promise<void> {
  const transport = new NodeStreamableHTTPServerTransport({
    sessionIdGenerator: () => randomUUID(),
  });

  // Only allow localhost and the configured bind host by default, per the MCP
  // HTTP transport security guidance (Origin + Host header checks guard
  // against DNS rebinding).
  const allowedHostnames = ["localhost", "127.0.0.1", "[::1]", config.host];
  const validateOrigin = originValidation(allowedHostnames);
  const validateHost = hostHeaderValidation(allowedHostnames);

  const httpServer = createServer((req, res) => {
    if (!validateHost(req, res)) return;
    if (!validateOrigin(req, res)) return;
    void transport.handleRequest(req, res);
  });

  let shuttingDown = false;
  // The exit status is the worst one requested so far: a crash that lands
  // while an orderly shutdown is already running must still exit non-zero.
  let exitCode = 0;
  // Exit 0 for an orderly stop (signal), 1 for a crash. A crashed server must
  // not report success to its supervisor, and a hung transport.close() or
  // pool.close() must not keep it alive: the timer forces the exit.
  const shutdown = async (reason: string, requestedExitCode = 0) => {
    if (requestedExitCode > exitCode) {
      exitCode = requestedExitCode;
      process.exitCode = exitCode;
    }
    if (shuttingDown) return;
    shuttingDown = true;
    process.exitCode = exitCode;
    console.error(`\nShutting down HTTP server (${reason})...`);
    const forceExit = setTimeout(() => {
      console.error(`Shutdown timed out after ${SHUTDOWN_TIMEOUT_MS}ms; exiting.`);
      process.exit(exitCode);
    }, SHUTDOWN_TIMEOUT_MS);
    // Deliberately not unref'd: if the hung close operation is the only thing
    // left, the loop must stay alive for this timer to force the exit.
    try {
      httpServer.close();
      await transport.close();
      await closePoolOnShutdown();
      console.error("Server stopped.");
    } catch (err) {
      console.error("Error during shutdown:", formatFatalError(err));
    }
    clearTimeout(forceExit);
    process.exit(exitCode);
  };

  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGUSR2", () => shutdown("SIGUSR2"));
  process.on("uncaughtException", (err) => {
    console.error("Uncaught exception:", formatFatalError(err));
    void shutdown("uncaughtException", 1);
  });
  process.on("unhandledRejection", (reason) => {
    console.error("Unhandled rejection:", formatFatalError(reason));
    void shutdown("unhandledRejection", 1);
  });

  await server.connect(transport);

  await new Promise<void>((resolve, reject) => {
    httpServer.listen(config.port, config.host, () => {
      console.error(`MCP HTTP server listening on http://${config.host}:${config.port}`);
      resolve();
    });
    httpServer.on("error", reject);
  });
}
