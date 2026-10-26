import { strict as assert } from "node:assert";
import { test } from "node:test";
import { buildPoolConfig } from "../../src/db/connection.js";
import type { DatabaseConfig } from "../../src/types.js";

const common: DatabaseConfig = {
  server: "localhost", database: "db", port: 1433, encrypt: true, trustServerCertificate: false,
  connectionTimeout: 30000, requestTimeout: 30000, authType: "sql", user: "analyst", password: "pw-123456",
};

test("buildPoolConfig - sql uses user/password and no authentication block", () => {
  const c = buildPoolConfig(common);
  assert.equal(c.user, "analyst");
  assert.equal(c.password, "pw-123456");
  assert.equal("authentication" in c, false);
});

test("buildPoolConfig - ntlm uses explicit authentication block and no user/password", () => {
  const c = buildPoolConfig({ ...common, authType: "ntlm", domain: "EXAMPLE" });
  assert.deepEqual(c.authentication, { type: "ntlm", options: { domain: "EXAMPLE", userName: "analyst", password: "pw-123456" } });
  assert.equal("user" in c, false);
  assert.equal("password" in c, false);
});

test("buildPoolConfig - common options identical in both modes", () => {
  const a = buildPoolConfig(common);
  const b = buildPoolConfig({ ...common, authType: "ntlm", domain: "EXAMPLE" });
  for (const k of ["server", "database", "port", "options", "connectionTimeout", "requestTimeout", "pool"] as const) {
    assert.deepEqual(a[k], b[k], k);
  }
  assert.equal(a.options?.useUTC, false);
  assert.equal(a.options?.enableArithAbort, true);
});

// --- windows (msnodesqlv8 / ODBC) ---

const windows: DatabaseConfig = {
  ...common, authType: "windows", user: undefined, password: undefined, odbcDriver: "ODBC Driver 17 for SQL Server",
};

test("buildPoolConfig - windows uses msnodesqlv8 with a trusted connection and no credentials", () => {
  const c = buildPoolConfig(windows) as unknown as Record<string, unknown> & { options?: Record<string, unknown> };
  assert.equal(c.driver, "msnodesqlv8");
  assert.equal(
    c.connectionString,
    "Driver={ODBC Driver 17 for SQL Server};Server={localhost,1433};Database={db};Trusted_Connection=yes;Encrypt=yes;TrustServerCertificate=no;",
  );
  assert.equal(c.server, "localhost");
  assert.equal(c.database, "db");
  assert.equal(c.port, 1433);
  assert.deepEqual(c.options, {
    trustedConnection: true, encrypt: true, trustServerCertificate: false, enableArithAbort: true, useUTC: false,
  });
  assert.equal(c.connectionTimeout, 30000);
  assert.equal(c.requestTimeout, 30000);
  assert.ok(c.pool);
  for (const k of ["user", "password", "authentication"]) assert.equal(k in c, false, k);
});

test("buildPoolConfig - windows connection string follows encrypt/trust flags and omits an unset database", () => {
  const cs = (cfg: DatabaseConfig) => (buildPoolConfig(cfg) as { connectionString?: string }).connectionString;
  assert.equal(
    cs({ ...windows, encrypt: false, trustServerCertificate: true, database: undefined, port: 1500, odbcDriver: "ODBC Driver 18 for SQL Server" }),
    "Driver={ODBC Driver 18 for SQL Server};Server={localhost,1500};Trusted_Connection=yes;Encrypt=no;TrustServerCertificate=yes;",
  );
});

test("buildPoolConfig - windows brace-quotes values so they cannot add keywords", () => {
  const cs = (buildPoolConfig({ ...windows, server: "srv;Uid=x", database: "a}b" }) as { connectionString?: string }).connectionString;
  assert.equal(
    cs,
    "Driver={ODBC Driver 17 for SQL Server};Server={srv;Uid=x,1433};Database={a}}b};Trusted_Connection=yes;Encrypt=yes;TrustServerCertificate=no;",
  );
});

test("buildPoolConfig - windows never carries a password even if the config has one", () => {
  const c = buildPoolConfig({ ...windows, user: "analyst", password: "pw-123456" });
  const text = JSON.stringify(c);
  assert.equal(text.includes("pw-123456"), false);
  assert.equal(text.includes("analyst"), false);
  assert.equal(/Uid=|Pwd=/i.test(String((c as { connectionString?: string }).connectionString)), false);
});
