import { strict as assert } from "node:assert";
import { test } from "node:test";
import type sql from "mssql";
import { toSessionInfo, sessionBlock, PRINCIPAL_QUERY, AUTH_SCHEME_QUERY, AUTH_SCHEME_FALLBACK_QUERY } from "../../src/db/session.js";

test("toSessionInfo - maps 1/0/null and derives can_write", () => {
  const s = toSessionInfo({ login_name: "EXAMPLE\\analyst", is_sysadmin: 0, is_db_owner: null, is_db_datawriter: 0, has_insert: 1, has_update: 0, has_delete: 0, has_alter: null }, { auth_scheme: "NTLM", source: "dm_exec_connections" });
  assert.equal(s.login_name, "EXAMPLE\\analyst");
  assert.equal(s.auth_scheme, "NTLM");
  assert.equal(s.principal.is_sysadmin, false);
  assert.equal(s.principal.is_db_owner, null);
  assert.equal(s.principal.has_insert, true);
  assert.equal(s.principal.can_write, true);
});
test("toSessionInfo - all false/null -> can_write false", () => {
  const s = toSessionInfo({ login_name: "x", is_sysadmin: false, is_db_owner: 0, is_db_datawriter: null, has_insert: 0, has_update: 0, has_delete: 0, has_alter: 0 }, { auth_scheme: "SQL", source: "dm_exec_connections" });
  assert.equal(s.principal.can_write, false);
});
test("toSessionInfo - undefined row -> nulls, can_write false", () => {
  const s = toSessionInfo(undefined, { auth_scheme: null, source: null });
  assert.equal(s.login_name, null);
  assert.equal(s.principal.can_write, false);
});
test("PRINCIPAL_QUERY - asks for the documented columns and needs no FROM", () => {
  for (const col of ["SUSER_SNAME()", "IS_SRVROLEMEMBER('sysadmin')", "IS_MEMBER('db_owner')", "IS_MEMBER('db_datawriter')", "HAS_PERMS_BY_NAME(DB_NAME(), 'DATABASE', 'INSERT')", "HAS_PERMS_BY_NAME(DB_NAME(), 'DATABASE', 'ALTER')"]) {
    assert.ok(PRINCIPAL_QUERY.includes(col), col);
  }
  assert.ok(!/\bFROM\b/i.test(PRINCIPAL_QUERY));
});
test("AUTH_SCHEME_QUERY - reads dm_exec_connections for the current session", () => {
  for (const col of ["auth_scheme", "sys.dm_exec_connections", "@@SPID"]) assert.ok(AUTH_SCHEME_QUERY.includes(col), col);
});
test("AUTH_SCHEME_FALLBACK_QUERY - derives the scheme from sys.login_token", () => {
  for (const col of ["sys.login_token", "WINDOWS LOGIN", "WINDOWS GROUP", "auth_scheme"]) assert.ok(AUTH_SCHEME_FALLBACK_QUERY.includes(col), col);
});

function fakePool(handlers: { principal?: () => unknown; dmv?: () => unknown; fallback?: () => unknown }, seen: string[] = []): sql.ConnectionPool {
  return {
    request: () => ({
      query: async (text: string) => {
        if (text === PRINCIPAL_QUERY) { seen.push("principal"); return handlers.principal!(); }
        if (text === AUTH_SCHEME_QUERY) { seen.push("dmv"); return handlers.dmv!(); }
        if (text === AUTH_SCHEME_FALLBACK_QUERY) { seen.push("fallback"); return handlers.fallback!(); }
        throw new Error("unexpected query");
      },
    }),
  } as unknown as sql.ConnectionPool;
}
const principalRow = () => ({ recordset: [{ login_name: "EXAMPLE\\analyst", is_sysadmin: 0, has_insert: 0 }] });

test("sessionBlock - DMV scheme used, fallback never queried", async () => {
  const seen: string[] = [];
  const block = await sessionBlock(fakePool({ principal: principalRow, dmv: () => ({ recordset: [{ auth_scheme: "NTLM" }] }) }, seen));
  assert.ok("session" in block);
  assert.equal(block.session.auth_scheme, "NTLM");
  assert.equal(block.session.auth_scheme_source, "dm_exec_connections");
  assert.equal(block.session.auth_scheme_error, undefined);
  assert.ok(!seen.includes("fallback"));
});
test("sessionBlock - DMV denied falls back to login_token", async () => {
  const block = await sessionBlock(fakePool({
    principal: principalRow,
    dmv: () => { throw new Error("The user does not have permission to perform this action."); },
    fallback: () => ({ recordset: [{ auth_scheme: "WINDOWS" }] }),
  }));
  assert.ok("session" in block);
  assert.equal(block.session.auth_scheme, "WINDOWS");
  assert.equal(block.session.auth_scheme_source, "login_token");
  assert.equal(block.session.auth_scheme_error, undefined);
});
test("sessionBlock - both scheme queries fail keeps the principal and reports the first error", async () => {
  const block = await sessionBlock(fakePool({
    principal: principalRow,
    dmv: () => { throw new Error("first: permission denied"); },
    fallback: () => { throw new Error("second: boom"); },
  }));
  assert.ok("session" in block);
  assert.equal(block.session.auth_scheme, null);
  assert.equal(block.session.auth_scheme_source, null);
  assert.match(block.session.auth_scheme_error ?? "", /first: permission denied/);
  assert.equal(block.session.login_name, "EXAMPLE\\analyst");
});
test("sessionBlock - principal failure returns session_error and skips scheme queries", async () => {
  const seen: string[] = [];
  const block = await sessionBlock(fakePool({ principal: () => { throw new Error("principal exploded"); } }, seen));
  assert.ok("session_error" in block && /principal exploded/.test(block.session_error));
  assert.deepEqual(seen, ["principal"]);
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
