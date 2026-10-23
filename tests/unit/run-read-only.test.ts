import { strict as assert } from "node:assert";
import { test } from "node:test";
import type sql from "mssql";
import { runReadOnly } from "../../src/policy/read-only.js";

type Log = string[];
function harness(opts: { rollback?: Error; invalidate?: Error } = {}) {
  const log: Log = [];
  const tx = {
    async begin() { log.push("begin"); },
    async rollback() { log.push("rollback"); if (opts.rollback) throw opts.rollback; },
  };
  const request = { async batch(s: string) { log.push(`batch:${s}`); return {}; }, async query(s: string) { log.push(`query:${s}`); return { recordset: [{ v: 1 }] }; } };
  const deps = {
    createTransaction: () => tx,
    createRequest: () => request as unknown as sql.Request,
    invalidatePool: async () => { log.push("invalidate"); if (opts.invalidate) throw opts.invalidate; },
  };
  return { log, deps, pool: {} as sql.ConnectionPool };
}
const abort = Object.assign(new Error("Transaction has been aborted."), { code: "EABORT" });

test("(a) success + rollback ok -> result, no invalidate, LOCK_TIMEOUT before fn", async () => {
  const h = harness();
  const r = await runReadOnly(h.pool, async (req) => (await req.query("SELECT 1")).recordset, h.deps);
  assert.deepEqual(r, [{ v: 1 }]);
  assert.deepEqual(h.log, ["begin", "batch:SET LOCK_TIMEOUT 5000", "query:SELECT 1", "rollback"]);
});
test("(b) success + rollback fails -> throws rollback error, invalidates", async () => {
  const h = harness({ rollback: new Error("boom") });
  await assert.rejects(runReadOnly(h.pool, async () => 1, h.deps), /Read-only rollback failed \(boom\); connection discarded\. Reconnect with mssql_connect_database\./);
  assert.equal(h.log.filter((l) => l === "invalidate").length, 1);
});
test("(c) fn fails + rollback fails -> throws fn error, invalidates", async () => {
  const h = harness({ rollback: new Error("boom") });
  await assert.rejects(runReadOnly(h.pool, async () => { throw new Error("syntax"); }, h.deps), /^Error: syntax$/);
  assert.ok(h.log.includes("invalidate"));
});
test("(d) fn fails + rollback ok -> throws fn error, no invalidate", async () => {
  const h = harness();
  await assert.rejects(runReadOnly(h.pool, async () => { throw new Error("syntax"); }, h.deps), /^Error: syntax$/);
  assert.ok(!h.log.includes("invalidate"));
});
test("(f) success + rollback fails + invalidate fails -> rollback error mentions unusable", async () => {
  const h = harness({ rollback: new Error("boom"), invalidate: new Error("close failed") });
  await assert.rejects(runReadOnly(h.pool, async () => 1, h.deps), /connection could not be closed \(close failed\) and is marked unusable/);
});
test("(g) fn fails + rollback fails + invalidate fails -> fn error wins", async () => {
  const h = harness({ rollback: new Error("boom"), invalidate: new Error("close failed") });
  await assert.rejects(runReadOnly(h.pool, async () => { throw new Error("syntax"); }, h.deps), /^Error: syntax$/);
});
test("(h) fn fails + rollback EABORT -> fn error, no invalidate", async () => {
  const h = harness({ rollback: abort });
  await assert.rejects(runReadOnly(h.pool, async () => { throw new Error("syntax"); }, h.deps), /^Error: syntax$/);
  assert.ok(!h.log.includes("invalidate"));
});
test("(i) success + rollback EABORT -> result returned, no invalidate", async () => {
  const h = harness({ rollback: abort });
  assert.equal(await runReadOnly(h.pool, async () => 7, h.deps), 7);
  assert.ok(!h.log.includes("invalidate"));
});
