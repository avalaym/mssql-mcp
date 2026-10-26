import sql from "mssql";
import type { DatabaseConfig, ConnectionState } from "../types.js";
import { POOL_MAX, POOL_MIN, POOL_IDLE_TIMEOUT_MS } from "../constants.js";
import { DEFAULT_ODBC_DRIVER } from "../config.js";

export const POOL_DISCARDED_MESSAGE =
  "Database connection was discarded after a failed rollback; reconnect with mssql_connect_database";

export const WINDOWS_DRIVER_MISSING_MESSAGE =
  'msnodesqlv8 is not installed. Windows authentication needs it: run "npm install msnodesqlv8" ' +
  'in the server\'s install directory (see README, "Windows integrated authentication").';

export interface WindowsDriver {
  ConnectionPool: typeof sql.ConnectionPool;
}

export interface PoolDeps {
  createPool(config: sql.config): sql.ConnectionPool;
  loadWindowsDriver(): Promise<WindowsDriver>;
}

/** Replaces a missing-msnodesqlv8 error (whose text carries local paths) with the install hint. */
export function toWindowsDriverLoadError(err: unknown): Error {
  const e = err as { code?: unknown; message?: unknown } | null;
  const notFound = e?.code === "ERR_MODULE_NOT_FOUND" || e?.code === "MODULE_NOT_FOUND";
  if (notFound && String(e?.message).includes("'msnodesqlv8'")) {
    return new Error(WINDOWS_DRIVER_MISSING_MESSAGE);
  }
  return err instanceof Error ? err : new Error(String(err));
}

// Imported only in windows mode: msnodesqlv8 is an optional peer dependency, and loading
// mssql/msnodesqlv8 switches mssql's process-wide driver away from tedious.
async function loadWindowsDriver(): Promise<WindowsDriver> {
  try {
    const mod = (await import("mssql/msnodesqlv8.js")) as { default?: WindowsDriver } & Partial<WindowsDriver>;
    return (mod.default ?? mod) as WindowsDriver;
  } catch (err) {
    throw toWindowsDriverLoadError(err);
  }
}

const defaultPoolDeps: PoolDeps = {
  createPool: (c) => new sql.ConnectionPool(c),
  loadWindowsDriver,
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
  deps: Partial<PoolDeps> = {},
): Promise<void> {
  const d: PoolDeps = { ...defaultPoolDeps, ...deps };
  if (pool) {
    console.error("Closing existing connection...");
    await pool.close();
    pool = null;
  }

  console.error(`Connecting to ${config.server}:${config.port}`);

  const poolConfig = buildPoolConfig(config);
  const newPool = config.authType === "windows"
    ? new (await d.loadWindowsDriver()).ConnectionPool(poolConfig)
    : d.createPool(poolConfig);

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
