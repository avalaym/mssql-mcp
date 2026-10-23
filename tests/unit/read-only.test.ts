import { strict as assert } from "node:assert";
import { test } from "node:test";
import { isReadOnlyMode, assertReadOnlyStatement, assertSafeWhereClause } from "../../src/policy/read-only.js";

test("isReadOnlyMode - on unless exactly false/0", () => {
  for (const v of [undefined, "", "true", "1", "yes", "off", "False!"]) assert.equal(isReadOnlyMode({ MSSQL_MCP_READ_ONLY: v }), true, String(v));
  for (const v of ["false", "0", " False ", "FALSE"]) assert.equal(isReadOnlyMode({ MSSQL_MCP_READ_ONLY: v }), false, v);
});

const accepted = [
  "SELECT 1", "select top 10 * from dbo.T where note = 'to delete'", "WITH x AS (SELECT 1 AS a) SELECT * FROM x",
  "SELECT [Update], [Delete] FROM dbo.T", "SELECT 1;", "  \n SELECT 1",
  "SELECT * FROM T ORDER BY id OFFSET 0 ROWS FETCH NEXT 10 ROWS ONLY",
  "SELECT 1 WHERE a = 'x; y /* z */ -- w'", "SELECT 1 WHERE a = 'it''s; fine'", "SELECT * FROM dbo.Sp_NotAProc_Table",
];
const rejected: Array<[string, RegExp]> = [
  ["", /statement is empty/], ["   ", /statement is empty/],
  ["DELETE FROM T", /must start with SELECT or WITH/],
  ["SELECT 1; DROP TABLE T", /single statement/],
  ["SELECT * INTO T2 FROM T", /forbidden keyword "INTO"/],
  ["SELECT 1 -- x", /comments/], ["SELECT 1 /* x */", /comments/], ["/* hint */ SELECT 1", /comments/],
  ["EXEC sp_executesql N'SELECT 1'", /must start with SELECT or WITH/],
  ["SELECT 1 FROM (SELECT 1 a) q WHERE EXISTS (SELECT 1 WHERE 1 = (EXEC('x')))", /forbidden keyword "EXEC"/],
  ["SELECT * FROM OPENROWSET('x','y','z')", /forbidden keyword "OPENROWSET"/],
  ["UPDATE T SET a = 1", /must start with SELECT or WITH/],
  ["WAITFOR DELAY '00:00:05'", /must start with SELECT or WITH/],
  ["'; DROP TABLE T; --", /comments|single statement|must start/],
  ["SELECT NEXT VALUE FOR dbo.Seq", /forbidden phrase "NEXT VALUE FOR"/],
  ["SELECT nExT   vAlUe\n FoR dbo.Seq", /forbidden phrase "NEXT VALUE FOR"/],
  ["SELECT 1 WHERE 1 = (SELECT COUNT(*) FROM T) UNION SELECT xp_cmdshell('dir')", /forbidden procedure "xp_cmdshell"/],
  ["SELECT 1; SELECT 2", /single statement/],
];
for (const s of accepted) test(`assertReadOnlyStatement accepts ${JSON.stringify(s)}`, () => assertReadOnlyStatement(s));
for (const [s, re] of rejected) test(`assertReadOnlyStatement rejects ${JSON.stringify(s)}`, () => assert.throws(() => assertReadOnlyStatement(s), re));
test("assertReadOnlyStatement - message prefix", () => assert.throws(() => assertReadOnlyStatement("DELETE FROM T"), { message: /^Read-only mode: / }));

const whereAccepted = ["Status = @s AND EXISTS (SELECT 1 FROM dbo.U WHERE U.id = T.id)", "note = 'to delete'", "[Update] = 1", "id IN (1,2,3)"];
const whereRejected: Array<[string, RegExp]> = [
  ["1=1; DELETE FROM T", /single statement/], ["1=1 -- ", /comments/],
  ["id IN (SELECT id FROM T) OR 1=(SELECT COUNT(*) FROM T WHERE x = 'a'); EXEC xp_cmdshell 'dir'", /single statement/],
  ["id = NEXT VALUE FOR dbo.Seq", /forbidden phrase/], ["a = 1 OR UPDATE", /forbidden keyword "UPDATE"/],
];
for (const s of whereAccepted) test(`assertSafeWhereClause accepts ${JSON.stringify(s)}`, () => assertSafeWhereClause(s));
for (const [s, re] of whereRejected) test(`assertSafeWhereClause rejects ${JSON.stringify(s)}`, () => assert.throws(() => assertSafeWhereClause(s), re));
test("assertSafeWhereClause - message prefix", () => assert.throws(() => assertSafeWhereClause("1=1; DELETE FROM T"), { message: /^Unsafe whereClause: / }));
