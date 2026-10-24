import { strict as assert } from "node:assert";
import { test } from "node:test";
import type sql from "mssql";
import { connectPool, poisonAndClosePool, requirePool, disconnectPool, getConnectionState, POOL_DISCARDED_MESSAGE } from "../../src/db/connection.js";
import type { DatabaseConfig } from "../../src/types.js";

const config: DatabaseConfig = { server: "localhost", port: 1433, encrypt: true, trustServerCertificate: false,
  connectionTimeout: 30000, requestTimeout: 30000, authType: "sql", user: "analyst", password: "pw-123456" };

function fakePool(closeBehaviour: "ok" | "reject"): sql.ConnectionPool {
  const p = {
    connected: true, size: 1, available: 1, pending: 0, borrowed: 0,
    on() { return p; },
    async connect() { return p; },
    async close() { if (closeBehaviour === "reject") throw new Error("socket already gone"); p.connected = false; },
  };
  return p as unknown as sql.ConnectionPool;
}

test("poisonAndClosePool - requirePool throws the discarded message even when close() rejects", async () => {
  const bad = fakePool("reject");
  await connectPool(config, { createPool: () => bad });
  assert.equal(requirePool(), bad);
  await assert.rejects(poisonAndClosePool(), /socket already gone/);
  assert.throws(() => requirePool(), { message: POOL_DISCARDED_MESSAGE });
  assert.equal(getConnectionState().connected, false);
});

test("connectPool - clears the poisoned flag", async () => {
  const good = fakePool("ok");
  await connectPool(config, { createPool: () => good });
  assert.equal(requirePool(), good);
  assert.equal(getConnectionState().config?.auth_type, "sql");
  await disconnectPool();
});

test("disconnectPool - also clears the poisoned flag", async () => {
  await connectPool(config, { createPool: () => fakePool("ok") });
  await poisonAndClosePool();
  await disconnectPool();
  assert.throws(() => requirePool(), /No active database connection/);
});
