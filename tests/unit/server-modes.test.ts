import { strict as assert } from "node:assert";
import { mock, test } from "node:test";
import { Client } from "@modelcontextprotocol/client";
import { InMemoryTransport } from "@modelcontextprotocol/server";
import { createServer } from "../../src/server.js";

type ToolCallResult = { content: Array<{ type: string; text: string }>; isError?: boolean; structuredContent?: Record<string, unknown> };
async function open(readOnly: boolean) {
  const server = createServer({ readOnly });
  const [st, ct] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "server-modes-test", version: "1.0.0" });
  await Promise.all([server.connect(st), client.connect(ct)]);
  const close = async () => { await client.close(); await server.close(); };
  const call = async (name: string, args: Record<string, unknown> = {}) => (await client.callTool({ name, arguments: args })) as ToolCallResult;
  const names = async () => new Set((await client.listTools()).tools.map((t) => t.name));
  const tool = async (name: string) => (await client.listTools()).tools.find((t) => t.name === name);
  return { call, names, tool, close };
}
mock.method(console, "error", () => {});
const HIDDEN = ["mssql_execute_stored_procedure", "mssql_execute_procedure", "mssql_execute_query", "mssql_get_schema", "mssql_describe_table", "mssql_get_table_data"];

test("read-only: hides procedures and deprecated aliases, keeps primaries", async () => {
  const s = await open(true);
  try {
    const n = await s.names();
    for (const h of HIDDEN) assert.equal(n.has(h), false, h);
    for (const k of ["mssql_connect_database", "mssql_disconnect_database", "mssql_connection_status", "mssql_run_sql_query", "mssql_list_schema_objects", "mssql_describe_table_columns", "mssql_read_table_rows", "mssql_list_databases"]) assert.ok(n.has(k), k);
    const q = await s.tool("mssql_run_sql_query");
    assert.equal(q?.annotations?.readOnlyHint, true);
    assert.equal(q?.title, "Run SQL Query (read-only)");
  } finally { await s.close(); }
});
test("read-write: everything registered, run_sql_query not read-only", async () => {
  const s = await open(false);
  try {
    const n = await s.names();
    for (const h of HIDDEN) assert.ok(n.has(h), h);
    assert.equal((await s.tool("mssql_run_sql_query"))?.annotations?.readOnlyHint, false);
  } finally { await s.close(); }
});
test("read-only: run_sql_query rejects a write before touching the pool", async () => {
  const s = await open(true);
  try {
    const r = await s.call("mssql_run_sql_query", { query: "DELETE FROM dbo.T" });
    assert.equal(r.isError, true);
    assert.match(r.content[0].text, /Read-only mode: statement must start with SELECT or WITH/);
    assert.doesNotMatch(r.content[0].text, /No active database connection/);
  } finally { await s.close(); }
});
test("read-write: run_sql_query does not filter (fails only for lack of connection)", async () => {
  const s = await open(false);
  try {
    const r = await s.call("mssql_run_sql_query", { query: "DELETE FROM dbo.T" });
    assert.equal(r.isError, true);
    assert.match(r.content[0].text, /No active database connection/);
  } finally { await s.close(); }
});
test("any mode: read_table_rows rejects an unsafe whereClause before touching the pool", async () => {
  for (const mode of [true, false]) {
    const s = await open(mode);
    try {
      const r = await s.call("mssql_read_table_rows", { tableName: "T", whereClause: "1=1; DELETE FROM dbo.T" });
      assert.equal(r.isError, true);
      assert.match(r.content[0].text, /Unsafe whereClause: .*single statement/);
    } finally { await s.close(); }
  }
});
test("status reports read_only without a connection", async () => {
  const s = await open(true);
  try {
    const r = await s.call("mssql_connection_status");
    assert.equal(r.structuredContent?.read_only, true);
    assert.equal(r.structuredContent?.connected, false);
    assert.equal("session" in (r.structuredContent ?? {}), false);
  } finally { await s.close(); }
});
