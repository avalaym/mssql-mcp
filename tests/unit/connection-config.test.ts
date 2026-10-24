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
