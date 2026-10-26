import { z } from "zod";
import type { DatabaseConfig } from "./types.js";
import {
  DEFAULT_PORT,
  DEFAULT_ENCRYPT,
  DEFAULT_TRUST_SERVER_CERTIFICATE,
  DEFAULT_CONNECTION_TIMEOUT,
  DEFAULT_REQUEST_TIMEOUT,
} from "./constants.js";

export const ConfigSchema = z.object({
  server: z.string().min(1, "Server address is required"),
  database: z.string().optional(),
  user: z.string().optional(),
  password: z.string().optional(),
  authType: z.enum(["sql", "ntlm", "windows"]).default("sql"),
  domain: z.string().optional(),
  odbcDriver: z.string().optional(),
  port: z.number().int().min(1).max(65535).optional().default(DEFAULT_PORT),
  encrypt: z.boolean().optional().default(DEFAULT_ENCRYPT),
  trustServerCertificate: z.boolean().optional().default(DEFAULT_TRUST_SERVER_CERTIFICATE),
  connectionTimeout: z.number().int().min(1000).max(60000).optional().default(DEFAULT_CONNECTION_TIMEOUT),
  requestTimeout: z.number().int().min(1000).max(300000).optional().default(DEFAULT_REQUEST_TIMEOUT),
});

export const DEFAULT_ODBC_DRIVER = "ODBC Driver 17 for SQL Server";

// Restricts the driver name so it cannot close the {...} quoting in the ODBC connection string.
const ODBC_DRIVER_PATTERN = /^[A-Za-z0-9 ._-]+$/;

const IGNORED_WINDOWS_CREDENTIALS = ["DB_USER", "DB_PASSWORD", "DB_DOMAIN"] as const;

let windowsCredentialNoticeShown = false;

export function resetWindowsCredentialNoticeForTests(): void {
  windowsCredentialNoticeShown = false;
}

export interface LoadConfigOptions {
  platform?: NodeJS.Platform;
  warn?: (message: string) => void;
}

function loadWindowsSettings(env: NodeJS.ProcessEnv, platform: NodeJS.Platform, warn: (message: string) => void): string {
  if (platform !== "win32") {
    throw new Error(`DB_AUTH_TYPE=windows requires running the server on Windows (current platform: ${platform})`);
  }
  const odbcDriver = env.DB_ODBC_DRIVER?.trim() || DEFAULT_ODBC_DRIVER;
  if (!ODBC_DRIVER_PATTERN.test(odbcDriver)) {
    throw new Error("DB_ODBC_DRIVER may contain only letters, digits, spaces, '.', '_' and '-'");
  }
  // Names only, never values; once per process because every connect reloads the config.
  const ignored = IGNORED_WINDOWS_CREDENTIALS.filter((name) => env[name]);
  if (ignored.length > 0 && !windowsCredentialNoticeShown) {
    windowsCredentialNoticeShown = true;
    warn(`DB_AUTH_TYPE=windows: ignoring ${ignored.join(", ")} (Windows authentication uses the process logon session)`);
  }
  return odbcDriver;
}

export function loadConfigFromEnv(
  env: NodeJS.ProcessEnv = process.env,
  { platform = process.platform, warn = console.error }: LoadConfigOptions = {},
): DatabaseConfig {
  const authType = (env.DB_AUTH_TYPE ?? "").trim().toLowerCase() || "sql";
  if (authType !== "sql" && authType !== "ntlm" && authType !== "windows") {
    throw new Error('DB_AUTH_TYPE must be "sql", "ntlm" or "windows"');
  }

  const windows = authType === "windows";
  const odbcDriver = windows ? loadWindowsSettings(env, platform, warn) : undefined;

  const raw = {
    server: env.DB_SERVER,
    database: env.DB_DATABASE,
    user: windows ? undefined : env.DB_USER,
    password: windows ? undefined : env.DB_PASSWORD,
    authType,
    domain: authType === "ntlm" ? env.DB_DOMAIN : undefined,
    odbcDriver,
    port: env.DB_PORT ? parseInt(env.DB_PORT, 10) : DEFAULT_PORT,
    encrypt: env.DB_ENCRYPT !== "false",
    trustServerCertificate: env.DB_TRUST_SERVER_CERTIFICATE === "true",
    connectionTimeout: env.DB_CONNECTION_TIMEOUT
      ? parseInt(env.DB_CONNECTION_TIMEOUT, 10)
      : DEFAULT_CONNECTION_TIMEOUT,
    requestTimeout: env.DB_REQUEST_TIMEOUT
      ? parseInt(env.DB_REQUEST_TIMEOUT, 10)
      : DEFAULT_REQUEST_TIMEOUT,
  };

  const config = ConfigSchema.parse(raw) as DatabaseConfig;

  if (config.authType === "ntlm") {
    if (!config.domain) {
      throw new Error("DB_AUTH_TYPE=ntlm requires DB_DOMAIN");
    }
    if (!config.user || !config.password) {
      throw new Error("DB_AUTH_TYPE=ntlm requires DB_USER and DB_PASSWORD");
    }
    if (config.user.includes("\\") || config.user.includes("@")) {
      throw new Error("DB_USER must be the bare account name; put the domain in DB_DOMAIN");
    }
  }

  return config;
}

export interface HttpConfig {
  host: string;
  port: number;
}

export function loadHttpConfig(): HttpConfig {
  return {
    host: process.env.MCP_HOST ?? "127.0.0.1",
    port: process.env.MCP_PORT ? parseInt(process.env.MCP_PORT, 10) : 3001,
  };
}
