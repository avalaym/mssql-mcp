import { strict as assert } from "node:assert";
import { afterEach, test } from "node:test";
import type sql from "mssql";
import {
  connectPool, disconnectPool, getConnectionState, toWindowsDriverLoadError, WINDOWS_DRIVER_MISSING_MESSAGE,
  DRIVER_SWITCH_MESSAGE, resetWindowsDriverStateForTests,
} from "../../src/db/connection.js";
import type { DatabaseConfig } from "../../src/types.js";
import { getDateClock } from "../../src/utils/format.js";

const sqlConfig: DatabaseConfig = { server: "localhost", port: 1433, encrypt: true, trustServerCertificate: false,
  connectionTimeout: 30000, requestTimeout: 30000, authType: "sql", user: "analyst", password: "pw-123456" };
const windowsConfig: DatabaseConfig = { ...sqlConfig, authType: "windows", user: undefined, password: undefined,
  odbcDriver: "ODBC Driver 17 for SQL Server" };

function fakePool(): sql.ConnectionPool {
  const p = {
    connected: true, size: 1, available: 1, pending: 0, borrowed: 0,
    on() { return p; },
    async connect() { return p; },
    async close() { p.connected = false; },
  };
  return p as unknown as sql.ConnectionPool;
}

afterEach(async () => { await disconnectPool(); resetWindowsDriverStateForTests(); });

test("connectPool - windows builds the pool from the lazily loaded msnodesqlv8 module", async () => {
  const seen: sql.config[] = [];
  const pool = fakePool();
  class FakeConnectionPool { constructor(c: sql.config) { seen.push(c); return pool; } }
  await connectPool(windowsConfig, {
    createPool: () => { throw new Error("tedious pool must not be used in windows mode"); },
    loadWindowsDriver: async () => ({ ConnectionPool: FakeConnectionPool as unknown as typeof sql.ConnectionPool }),
  });
  assert.equal(getConnectionState().connected, true);
  assert.equal(getConnectionState().config?.auth_type, "windows");
  assert.equal((seen[0] as { driver?: string }).driver, "msnodesqlv8");
});

test("connectPool - windows with the driver missing rejects with the install hint and stays disconnected", async () => {
  await assert.rejects(
    connectPool(windowsConfig, {
      createPool: () => fakePool(),
      loadWindowsDriver: async () => { throw new Error(WINDOWS_DRIVER_MISSING_MESSAGE); },
    }),
    { message: WINDOWS_DRIVER_MISSING_MESSAGE },
  );
  assert.equal(getConnectionState().connected, false);
  assert.equal(getConnectionState().config, null);
});

test("connectPool - sql never loads the windows driver", async () => {
  let loads = 0;
  await connectPool(sqlConfig, {
    createPool: () => fakePool(),
    loadWindowsDriver: async () => { loads++; throw new Error("unexpected"); },
  });
  assert.equal(loads, 0);
  assert.equal(getConnectionState().connected, true);
});

test("toWindowsDriverLoadError - maps a missing msnodesqlv8 (ESM or CJS code) to the install hint", () => {
  for (const code of ["ERR_MODULE_NOT_FOUND", "MODULE_NOT_FOUND"]) {
    const err = Object.assign(new Error("Cannot find module 'msnodesqlv8' imported from C:\\secret\\path\\x.js"), { code });
    const mapped = toWindowsDriverLoadError(err);
    assert.equal(mapped.message, WINDOWS_DRIVER_MISSING_MESSAGE);
    assert.equal(mapped.message.includes("secret"), false);
  }
});

test("toWindowsDriverLoadError - other failures keep their message", () => {
  const err = Object.assign(new Error("The specified module could not be found. sqlserver.node"), { code: "ERR_DLOPEN_FAILED" });
  assert.equal(toWindowsDriverLoadError(err), err);
  const other = Object.assign(new Error("Cannot find module 'something-else'"), { code: "MODULE_NOT_FOUND" });
  assert.equal(toWindowsDriverLoadError(other), other);
});

test("WINDOWS_DRIVER_MISSING_MESSAGE - names the package, the command and the README section", () => {
  assert.match(WINDOWS_DRIVER_MISSING_MESSAGE, /msnodesqlv8 is not installed/);
  assert.match(WINDOWS_DRIVER_MISSING_MESSAGE, /npm install msnodesqlv8/);
  assert.match(WINDOWS_DRIVER_MISSING_MESSAGE, /Windows integrated authentication/);
});

test("connectPool - windows switches the date clock to utc, sql leaves it server-local", async () => {
  class FakeConnectionPool { constructor() { return fakePool(); } }
  await connectPool(windowsConfig, {
    loadWindowsDriver: async () => ({ ConnectionPool: FakeConnectionPool as unknown as typeof sql.ConnectionPool }),
  });
  assert.equal(getDateClock(), "utc");
  resetWindowsDriverStateForTests();
  await connectPool(sqlConfig, { createPool: () => fakePool() });
  assert.equal(getDateClock(), "server-local");
});

test("connectPool - after the windows driver is loaded, sql/ntlm are refused (mssql's global driver cannot be restored)", async () => {
  class FakeConnectionPool { constructor() { return fakePool(); } }
  await connectPool(windowsConfig, {
    loadWindowsDriver: async () => ({ ConnectionPool: FakeConnectionPool as unknown as typeof sql.ConnectionPool }),
  });
  let created = 0;
  for (const cfg of [sqlConfig, { ...sqlConfig, authType: "ntlm" as const, domain: "EXAMPLE" }]) {
    await assert.rejects(connectPool(cfg, { createPool: () => { created++; return fakePool(); } }), { message: DRIVER_SWITCH_MESSAGE });
  }
  assert.equal(created, 0);
  // the refused attempt leaves the existing windows connection untouched
  assert.equal(getConnectionState().connected, true);
  assert.equal(getConnectionState().config?.auth_type, "windows");
  // windows again in the same process still works
  await connectPool(windowsConfig, {
    loadWindowsDriver: async () => ({ ConnectionPool: FakeConnectionPool as unknown as typeof sql.ConnectionPool }),
  });
  assert.equal(getConnectionState().connected, true);
});

test("connectPool - a failed windows driver load does not block sql afterwards", async () => {
  await assert.rejects(connectPool(windowsConfig, {
    loadWindowsDriver: async () => { throw new Error(WINDOWS_DRIVER_MISSING_MESSAGE); },
  }));
  await connectPool(sqlConfig, { createPool: () => fakePool() });
  assert.equal(getConnectionState().connected, true);
});
