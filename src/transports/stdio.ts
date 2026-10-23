import { StdioServerTransport } from "@modelcontextprotocol/server/stdio";
import type { McpServer } from "@modelcontextprotocol/server";
import { closePoolOnShutdown } from "../db/connection.js";
import { formatFatalError } from "../utils/errors.js";
import { SHUTDOWN_TIMEOUT_MS } from "../constants.js";

export async function runStdioTransport(server: McpServer): Promise<void> {
  const transport = new StdioServerTransport();

  let shuttingDown = false;
  // The exit status is the worst one requested so far: a crash that lands
  // while an orderly shutdown is already running must still exit non-zero.
  let exitCode = 0;
  // Exit 0 for an orderly stop (signal, stdin EOF), 1 for a crash. A crashed
  // server must not report success to its supervisor, and a hung pool.close()
  // must not keep it alive: the timer forces the exit.
  const shutdown = async (reason: string, requestedExitCode = 0) => {
    if (requestedExitCode > exitCode) {
      exitCode = requestedExitCode;
      process.exitCode = exitCode;
    }
    if (shuttingDown) return;
    shuttingDown = true;
    process.exitCode = exitCode;
    console.error(`\nShutting down (${reason})...`);
    const forceExit = setTimeout(() => {
      console.error(`Shutdown timed out after ${SHUTDOWN_TIMEOUT_MS}ms; exiting.`);
      process.exit(exitCode);
    }, SHUTDOWN_TIMEOUT_MS);
    // Deliberately not unref'd: if the hung close operation is the only thing
    // left, the loop must stay alive for this timer to force the exit.
    try {
      await closePoolOnShutdown();
      console.error("Server stopped.");
    } catch (err) {
      console.error("Error during shutdown:", formatFatalError(err));
    }
    clearTimeout(forceExit);
    process.exit(exitCode);
  };

  // Per the MCP stdio spec, the client signals shutdown by closing the child's
  // stdin; the server is expected to exit when stdin reaches EOF. Windows does
  // not reliably deliver OS signals to child processes when the parent exits,
  // so we must also react to stdin EOF and transport close, otherwise orphaned
  // node processes accumulate. See https://github.com/BYMCS/mssql-mcp/issues/2
  transport.onclose = () => shutdown("stdio-close");
  process.stdin.on("end", () => shutdown("stdin-end"));
  process.stdin.on("close", () => shutdown("stdin-close"));

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
}
