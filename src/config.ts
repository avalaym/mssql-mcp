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
  authType: z.enum(["sql", "ntlm"]).default("sql"),
  domain: z.string().optional(),
  port: z.number().int().min(1).max(65535).optional().default(DEFAULT_PORT),
  encrypt: z.boolean().optional().default(DEFAULT_ENCRYPT),
  trustServerCertificate: z.boolean().optional().default(DEFAULT_TRUST_SERVER_CERTIFICATE),
  connectionTimeout: z.number().int().min(1000).max(60000).optional().default(DEFAULT_CONNECTION_TIMEOUT),
  requestTimeout: z.number().int().min(1000).max(300000).optional().default(DEFAULT_REQUEST_TIMEOUT),
});

export function loadConfigFromEnv(env: NodeJS.ProcessEnv = process.env): DatabaseConfig {
  const authType = (env.DB_AUTH_TYPE ?? "").trim().toLowerCase() || "sql";
  if (authType !== "sql" && authType !== "ntlm") {
    throw new Error('DB_AUTH_TYPE must be "sql" or "ntlm"');
  }

  const raw = {
    server: env.DB_SERVER,
    database: env.DB_DATABASE,
    user: env.DB_USER,
    password: env.DB_PASSWORD,
    authType,
    domain: env.DB_DOMAIN,
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
