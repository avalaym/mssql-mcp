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
  "SELECT [a]]b], \"Weird Name\" FROM T WHERE x = 'it''s'",
  "SELECT IIF(1=1,'a','b')", "SELECT * FROM OPENJSON('[]')", "SELECT DATEADD(day,1,GETDATE())", "SELECT CASE WHEN 1=1 THEN 1 ELSE 0 END",
  "SELECT x1 FROM dbo.T", "SELECT [1COMMIT] FROM dbo.T", "SELECT 1 AS commit1", "SELECT 1 AS tran1",
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
  ["'; DROP TABLE T; --", /unbalanced|comments|single statement|must start/],
  ["SELECT NEXT VALUE FOR dbo.Seq", /forbidden phrase "NEXT VALUE FOR"/],
  ["SELECT nExT   vAlUe\n FoR dbo.Seq", /forbidden phrase "NEXT VALUE FOR"/],
  ["SELECT 1 WHERE 1 = (SELECT COUNT(*) FROM T) UNION SELECT xp_cmdshell('dir')", /forbidden procedure "xp_cmdshell"/],
  ["SELECT 1; SELECT 2", /single statement/],
  ["SELECT 1 [ ' ] ; DROP TABLE T; -- '", /single statement|unbalanced/],
  ["SELECT 1 [a'b]; DROP TABLE T; SELECT 'x'", /single statement/],
  ['SELECT 1 "a\'b"; DROP TABLE T; SELECT \'x\'', /single statement/],
  ["SELECT [a]]b] FROM T; DROP TABLE T", /single statement/],
  ["SELECT 1 FROM [T", /unbalanced/],
  ["SELECT 1 COMMIT", /forbidden keyword "COMMIT"/],
  ["SELECT 1 ROLLBACK", /forbidden keyword "ROLLBACK"/],
  ["SELECT 1 DISABLE TRIGGER ALL ON DATABASE COMMIT BEGIN TRAN", /forbidden keyword "DISABLE"/],
  ["SELECT 1 DECLARE @p varbinary(16) SELECT @p=TEXTPTR(c) FROM dbo.T WRITETEXT dbo.T.c @p 'x' COMMIT", /forbidden keyword "DECLARE"/],
  ["RECEIVE TOP(1) * FROM dbo.Q COMMIT", /must start with|forbidden keyword/],
  ["USE master", /must start with|forbidden keyword/],
  ["SETUSER 'dbo'", /must start with|forbidden keyword/],
  ["SET ROWCOUNT 1", /must start with|forbidden keyword/],
  ["SET LOCK_TIMEOUT -1", /must start with|forbidden keyword/],
  ["RAISERROR('x',16,1) WITH LOG", /must start with|forbidden keyword/],
  ["CHECKPOINT", /must start with|forbidden keyword/],
  ["SAVE TRAN x", /must start with|forbidden keyword/],
  ["IF 1=1 SELECT 1", /must start with|forbidden keyword/],
  ["SELECT 1 SET ROWCOUNT 1", /forbidden keyword "SET"/],
  ["SELECT 1COMMIT", /forbidden keyword "COMMIT"/],
  ["SELECT 1ROLLBACK", /forbidden keyword "ROLLBACK"/],
  ["SELECT 1DELETE dbo.T SELECT 1COMMIT", /forbidden keyword "DELETE"/],
  ["SELECT 1INSERT dbo.T VALUES(1) SELECT 1COMMIT", /forbidden keyword "INSERT"/],
  ["SELECT 1DROP TABLE dbo.T", /forbidden keyword "DROP"/],
  ["SELECT 1TRUNCATE TABLE dbo.T", /forbidden keyword "TRUNCATE"/],
  ["SELECT 1EXEC('DELETE dbo.T COMMIT')", /forbidden keyword "EXEC"/],
  ["SELECT 1 WHERE 1=1DISABLE TRIGGER ALL ON DATABASE SELECT 1COMMIT", /forbidden keyword "DISABLE"/],
  ["SELECT 1SET IMPLICIT_TRANSACTIONS ON", /forbidden keyword "SET"/],
  ["SELECT 1.0COMMIT", /forbidden keyword "COMMIT"/],
  ["SELECT 1e1COMMIT", /forbidden keyword "COMMIT"/],
];
for (const s of accepted) test(`assertReadOnlyStatement accepts ${JSON.stringify(s)}`, () => assertReadOnlyStatement(s));
for (const [s, re] of rejected) test(`assertReadOnlyStatement rejects ${JSON.stringify(s)}`, () => assert.throws(() => assertReadOnlyStatement(s), re));
test("assertReadOnlyStatement - message prefix", () => assert.throws(() => assertReadOnlyStatement("DELETE FROM T"), { message: /^Read-only mode: / }));

const whereAccepted = ["Status = @s AND EXISTS (SELECT 1 FROM dbo.U WHERE U.id = T.id)", "note = 'to delete'", "[Update] = 1", "id IN (1,2,3)"];
const whereRejected: Array<[string, RegExp]> = [
  ["1=1; DELETE FROM T", /single statement/], ["1=1 -- ", /comments/],
  ["id IN (SELECT id FROM T) OR 1=(SELECT COUNT(*) FROM T WHERE x = 'a'); EXEC xp_cmdshell 'dir'", /single statement/],
  ["id = NEXT VALUE FOR dbo.Seq", /forbidden phrase/], ["a = 1 OR UPDATE", /forbidden keyword "UPDATE"/],
  ["1=1 [ ' ] ; DROP TABLE T; -- '", /single statement|unbalanced/],
  ["1=1 DISABLE TRIGGER ALL ON dbo.T COMMIT SELECT 1 FROM dbo.T WHERE 1=1", /forbidden keyword "DISABLE"/],
  ["1=1COMMIT", /forbidden keyword "COMMIT"/],
  ["1=1DELETE dbo.T SELECT 1COMMIT SELECT 1 FROM dbo.T WHERE 1=1", /forbidden keyword "DELETE"/],
  ["1=1EXEC('DELETE dbo.T COMMIT') SELECT 1 FROM dbo.T WHERE 1=1", /forbidden keyword "EXEC"/],
];
for (const s of whereAccepted) test(`assertSafeWhereClause accepts ${JSON.stringify(s)}`, () => assertSafeWhereClause(s));
for (const [s, re] of whereRejected) test(`assertSafeWhereClause rejects ${JSON.stringify(s)}`, () => assert.throws(() => assertSafeWhereClause(s), re));
test("assertSafeWhereClause - message prefix", () => assert.throws(() => assertSafeWhereClause("1=1; DELETE FROM T"), { message: /^Unsafe whereClause: / }));
