import { strict as assert } from "node:assert";
import { test } from "node:test";
import type sql from "mssql";
import { toSessionInfo, sessionBlock, SESSION_QUERY } from "../../src/db/session.js";

test("toSessionInfo - maps 1/0/null and derives can_write", () => {
  const s = toSessionInfo({ login_name: "EXAMPLE\\analyst", auth_scheme: "NTLM", is_sysadmin: 0, is_db_owner: null, is_db_datawriter: 0, has_insert: 1, has_update: 0, has_delete: 0, has_alter: null });
  assert.equal(s.login_name, "EXAMPLE\\analyst");
  assert.equal(s.auth_scheme, "NTLM");
  assert.equal(s.principal.is_sysadmin, false);
  assert.equal(s.principal.is_db_owner, null);
  assert.equal(s.principal.has_insert, true);
  assert.equal(s.principal.can_write, true);
});
test("toSessionInfo - all false/null -> can_write false", () => {
  const s = toSessionInfo({ login_name: "x", auth_scheme: "SQL", is_sysadmin: false, is_db_owner: 0, is_db_datawriter: null, has_insert: 0, has_update: 0, has_delete: 0, has_alter: 0 });
  assert.equal(s.principal.can_write, false);
});
test("toSessionInfo - undefined row -> nulls, can_write false", () => {
  const s = toSessionInfo(undefined);
  assert.equal(s.login_name, null);
  assert.equal(s.principal.can_write, false);
});
test("SESSION_QUERY - asks for the documented columns", () => {
  for (const col of ["SUSER_SNAME()", "auth_scheme", "IS_SRVROLEMEMBER('sysadmin')", "IS_MEMBER('db_owner')", "IS_MEMBER('db_datawriter')", "HAS_PERMS_BY_NAME(DB_NAME(), 'DATABASE', 'INSERT')", "HAS_PERMS_BY_NAME(DB_NAME(), 'DATABASE', 'ALTER')", "sys.dm_exec_connections", "@@SPID"]) {
    assert.ok(SESSION_QUERY.includes(col), col);
  }
});
test("sessionBlock - returns session_error instead of throwing", async () => {
  const pool = { request: () => ({ query: async () => { throw new Error("VIEW SERVER STATE permission was denied"); } }) } as unknown as sql.ConnectionPool;
  const block = await sessionBlock(pool);
  assert.ok("session_error" in block && /denied/.test(block.session_error));
});
test("sessionBlock - returns session on success", async () => {
  const pool = { request: () => ({ query: async () => ({ recordset: [{ login_name: "sa", auth_scheme: "SQL", is_sysadmin: 1 }] }) }) } as unknown as sql.ConnectionPool;
  const block = await sessionBlock(pool);
  assert.ok("session" in block && block.session.principal.can_write === true);
});
