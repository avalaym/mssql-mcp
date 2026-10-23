export const SERVER_NAME = "mssql-mcp-server";
export const SERVER_VERSION = "3.0.0";

export const DEFAULT_PORT = 1433;
export const DEFAULT_ENCRYPT = true;
export const DEFAULT_TRUST_SERVER_CERTIFICATE = false;
export const DEFAULT_CONNECTION_TIMEOUT = 30000;
export const DEFAULT_REQUEST_TIMEOUT = 30000;

export const POOL_MAX = 10;
export const POOL_MIN = 0;
export const POOL_IDLE_TIMEOUT_MS = 30000;

// Lock wait limit applied inside every read-only transaction (SET LOCK_TIMEOUT).
export const READ_ONLY_LOCK_TIMEOUT_MS = 5000;

export const DEFAULT_PAGE_SIZE = 20;
export const MAX_PAGE_SIZE = 200;
export const MAX_TEXT_PAYLOAD_BYTES = 100_000;

// Upper bound on how long a shutdown may wait for the pool to close before
// the process exits anyway (a hung pool.close() must not keep a crashed
// server alive).
export const SHUTDOWN_TIMEOUT_MS = 5000;

export const HTTP_DEFAULT_HOST = "127.0.0.1";
export const HTTP_DEFAULT_PORT = 3001;
