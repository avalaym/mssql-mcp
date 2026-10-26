import sql from "mssql";
import type { DatabaseConfig, ConnectionState } from "../types.js";
import { POOL_MAX, POOL_MIN, POOL_IDLE_TIMEOUT_MS } from "../constants.js";
import { DEFAULT_ODBC_DRIVER } from "../config.js";

export const POOL_DISCARDED_MESSAGE =
  "Database connection was discarded after a failed rollback; reconnect with mssql_connect_database";

export interface PoolDeps {
  createPool(config: sql.config): sql.ConnectionPool;
}

const defaultPoolDeps: PoolDeps = {
  createPool: (c) => new sql.ConnectionPool(c),
};

let pool: sql.ConnectionPool | null = null;
let currentConfig: DatabaseConfig | null = null;
let poisoned = false;

// ODBC values in braces with "}" doubled cannot end the value early, so a server or
// database name cannot inject extra connection-string keywords.
function odbcQuote(value: string): string {
  return `{${value.replaceAll("}", "}}")}}`;
}

function buildOdbcConnectionString(config: DatabaseConfig): string {
  const parts = [
    `Driver=${odbcQuote(config.odbcDriver ?? DEFAULT_ODBC_DRIVER)}`,
    `Server=${odbcQuote(`${config.server},${config.port}`)}`,
  ];
  if (config.database) parts.push(`Database=${odbcQuote(config.database)}`);
  parts.push(
    "Trusted_Connection=yes",
    `Encrypt=${config.encrypt ? "yes" : "no"}`,
    `TrustServerCertificate=${config.trustServerCertificate ? "yes" : "no"}`,
  );
  return `${parts.join(";")};`;
}

export function buildPoolConfig(config: DatabaseConfig): sql.config {
  const common: sql.config = {
    server: config.server,
    database: config.database,
    port: config.port,
    options: {
      encrypt: config.encrypt,
      trustServerCertificate: config.trustServerCertificate,
      enableArithAbort: true,
      // Read date/time columns using the server's local clock rather than UTC, so
      // values round-trip as the server intends them (SQL Server datetime/datetime2
      // has no timezone). `datetimeoffset` values are still normalized to UTC
      // explicitly in utils/format.ts, since that type is timezone-aware.
      useUTC: false,
    },
    connectionTimeout: config.connectionTimeout,
    requestTimeout: config.requestTimeout,
    pool: { max: POOL_MAX, min: POOL_MIN, idleTimeoutMillis: POOL_IDLE_TIMEOUT_MS },
  };

  if (config.authType === "windows") {
    // mssql's own msnodesqlv8 builder drops TrustServerCertificate and defaults to the
    // retired "SQL Server Native Client 11.0" driver on Windows, so the string is explicit.
    // At runtime mssql reads it from the top level, though @types/mssql puts it in options.
    const windowsConfig: sql.config & { connectionString: string } = {
      ...common,
      driver: "msnodesqlv8",
      connectionString: buildOdbcConnectionString(config),
      options: { ...common.options, trustedConnection: true },
    };
    return windowsConfig;
  }

  if (config.authType === "ntlm") {
    return {
      ...common,
      authentication: {
        type: "ntlm",
        options: {
          domain: config.domain ?? "",
          userName: config.user ?? "",
          password: config.password ?? "",
        },
      },
    };
  }

  return { ...common, user: config.user, password: config.password };
}

export async function connectPool(
  config: DatabaseConfig,
  deps: PoolDeps = defaultPoolDeps,
): Promise<void> {
  if (pool) {
    console.error("Closing existing connection...");
    await pool.close();
    pool = null;
  }

  console.error(`Connecting to ${config.server}:${config.port}`);

  const newPool = deps.createPool(buildPoolConfig(config));

  newPool.on("error", (err: Error) => {
    console.error("Pool error:", err);
  });

  try {
    await newPool.connect();
    pool = newPool;
    currentConfig = config;
    poisoned = false;
    console.error(`Connected to ${config.server}${config.database ? `/${config.database}` : ""}`);
  } catch (err) {
    try { await newPool.close(); } catch { /* ignore */ }
    throw err;
  }
}

export async function disconnectPool(): Promise<void> {
  poisoned = false;
  if (pool) {
    await pool.close();
    pool = null;
    currentConfig = null;
  }
}

/**
 * Discards the pool after a failed transaction rollback, when the session state
 * can no longer be trusted. The pool is marked poisoned before closing so that
 * requirePool() refuses use even if close() itself fails; the close error propagates.
 */
export async function poisonAndClosePool(): Promise<void> {
  poisoned = true;
  if (!pool) return;
  try {
    await pool.close();
  } finally {
    pool = null;
    currentConfig = null;
  }
}

export function getPool(): sql.ConnectionPool | null {
  return pool;
}

export function requirePool(): sql.ConnectionPool {
  if (poisoned) {
    throw new Error(POOL_DISCARDED_MESSAGE);
  }
  if (!pool?.connected) {
    throw new Error("No active database connection. Use connect_database first.");
  }
  return pool;
}

export function getConnectionState(): ConnectionState {
  return {
    connected: !poisoned && (pool?.connected ?? false),
    config: currentConfig
      ? {
          server: currentConfig.server,
          database: currentConfig.database,
          port: currentConfig.port,
          auth_type: currentConfig.authType,
          domain: currentConfig.domain,
        }
      : null,
    pool_info: pool
      ? { size: pool.size, available: pool.available, pending: pool.pending, borrowed: pool.borrowed }
      : null,
  };
}

export async function closePoolOnShutdown(): Promise<void> {
  poisoned = false;
  if (pool) {
    try { await pool.close(); } catch { /* ignore */ }
    pool = null;
    currentConfig = null;
  }
}
