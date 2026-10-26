import { strict as assert } from "node:assert";
import { test, mock, beforeEach, afterEach } from "node:test";
import type sql from "mssql";
import { runReadOnly, BOUNDARY_SQL } from "../../src/policy/read-only.js";

type Log = string[];
type Row = { id: string; n: number };
interface Opts {
  rollback?: Error;
  invalidate?: Error;
  beforeRow?: Row;
  afterRow?: Row;
  resetFails?: Error;
  afterQueryFails?: Error;
}
function harness(opts: Opts = {}) {
  const log: Log = [];
  let boundaryCalls = 0;
  const tx = {
    async begin() { log.push("begin"); },
    async rollback() { log.push("rollback"); if (opts.rollback) throw opts.rollback; },
  };
  const request = {
    async batch(s: string) {
      log.push(`batch:${s}`);
      if (s === "SET LOCK_TIMEOUT -1" && opts.resetFails) throw opts.resetFails;
      return {};
    },
    async query(s: string) {
      log.push(`query:${s}`);
      if (s === BOUNDARY_SQL) {
        boundaryCalls++;
        if (boundaryCalls === 2 && opts.afterQueryFails) throw opts.afterQueryFails;
        const row = boundaryCalls === 1 ? (opts.beforeRow ?? { id: "1", n: 1 }) : (opts.afterRow ?? { id: "1", n: 1 });
        return { recordset: [row] };
      }
      return { recordset: [{ v: 1 }] };
    },
  };
  const deps = {
    createTransaction: () => tx,
    createRequest: () => request as unknown as sql.Request,
    invalidatePool: async () => { log.push("invalidate"); if (opts.invalidate) throw opts.invalidate; },
  };
  return { log, deps, pool: {} as sql.ConnectionPool };
}
const abort = Object.assign(new Error("Transaction has been aborted."), { code: "EABORT" });

// runReadOnly logs to stderr on rollback failures; stub it so test output stays clean
// and assert on the logging where it is part of the behaviour under test.
let errorMock: { mock: { calls: { arguments: unknown[] }[] } };
beforeEach(() => {
  errorMock = mock.method(console, "error", () => {});
});
afterEach(() => {
  mock.restoreAll();
});

test("(a) success + rollback ok -> result, no invalidate, LOCK_TIMEOUT before fn", async () => {
  const h = harness();
  const r = await runReadOnly(h.pool, async (req) => (await req.query("SELECT 1")).recordset, h.deps);
  assert.deepEqual(r, [{ v: 1 }]);
  assert.deepEqual(h.log, [
    "begin", "batch:SET LOCK_TIMEOUT 5000", `query:${BOUNDARY_SQL}`, "query:SELECT 1", `query:${BOUNDARY_SQL}`,
    "batch:SET LOCK_TIMEOUT -1", "rollback",
  ]);
});
test("(b) success + rollback fails -> throws rollback error, invalidates", async () => {
  const h = harness({ rollback: new Error("boom") });
  await assert.rejects(runReadOnly(h.pool, async () => 1, h.deps), /Read-only rollback failed \(boom\); connection discarded\. Reconnect with mssql_connect_database\./);
  assert.equal(h.log.filter((l) => l === "invalidate").length, 1);
  assert.equal(errorMock.mock.calls.length, 1);
  assert.match(String(errorMock.mock.calls[0].arguments[0]), /read-only rollback failed/);
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
  assert.equal(errorMock.mock.calls.length, 2);
  assert.match(String(errorMock.mock.calls[0].arguments[0]), /read-only rollback failed/);
  assert.match(String(errorMock.mock.calls[1].arguments[0]), /pool invalidation failed/);
});
test("(g) fn fails + rollback fails + invalidate fails -> fn error wins", async () => {
  const h = harness({ rollback: new Error("boom"), invalidate: new Error("close failed") });
  await assert.rejects(runReadOnly(h.pool, async () => { throw new Error("syntax"); }, h.deps), /^Error: syntax$/);
});
test("(h) fn fails + rollback EABORT -> fn error, invalidates once", async () => {
  const h = harness({ rollback: abort });
  await assert.rejects(runReadOnly(h.pool, async () => { throw new Error("syntax"); }, h.deps), /^Error: syntax$/);
  assert.equal(h.log.filter((l) => l === "invalidate").length, 1);
});
test("(i) success + rollback EABORT -> rejects (fail closed), invalidates once", async () => {
  const h = harness({ rollback: abort });
  await assert.rejects(runReadOnly(h.pool, async () => 7, h.deps), /aborted during the query/);
  assert.equal(h.log.filter((l) => l === "invalidate").length, 1);
});
for (const [name, afterRow] of [
  ["(j) transaction id changed", { id: "2", n: 1 }],
  ["(k) trancount 2", { id: "1", n: 2 }],
  ["(l) trancount 0", { id: "1", n: 0 }],
] as const) {
  test(`${name} -> boundary breached, invalidates, result not returned`, async () => {
    const h = harness({ afterRow });
    await assert.rejects(runReadOnly(h.pool, async () => "secret", h.deps), /boundary breached; connection discarded/);
    assert.equal(h.log.filter((l) => l === "invalidate").length, 1);
  });
}
test("(m) LOCK_TIMEOUT reset fails -> cleanup failed, invalidates", async () => {
  const h = harness({ resetFails: new Error("reset boom") });
  await assert.rejects(runReadOnly(h.pool, async () => 1, h.deps), /cleanup failed \(reset boom\); connection discarded/);
  assert.equal(h.log.filter((l) => l === "invalidate").length, 1);
});
test("(n) fn fails and the post-fn boundary query fails -> fn error, invalidates once", async () => {
  const h = harness({ afterQueryFails: new Error("post boom") });
  await assert.rejects(runReadOnly(h.pool, async () => { throw new Error("syntax"); }, h.deps), /^Error: syntax$/);
  assert.equal(h.log.filter((l) => l === "invalidate").length, 1);
});
test("(p) fn fails + boundary breached + rollback ok -> fn error, invalidates once", async () => {
  const h = harness({ afterRow: { id: "1", n: 2 } });
  await assert.rejects(runReadOnly(h.pool, async () => { throw new Error("syntax"); }, h.deps), /^Error: syntax$/);
  assert.equal(h.log.filter((l) => l === "invalidate").length, 1);
});
test("(q) post boundary query fails -> the LOCK_TIMEOUT reset still runs", async () => {
  const h = harness({ afterQueryFails: new Error("post boom") });
  await assert.rejects(runReadOnly(h.pool, async () => 1, h.deps), /cleanup failed \(post boom\)/);
  assert.ok(h.log.includes("batch:SET LOCK_TIMEOUT -1"));
});

test("default deps create the transaction and request through the pool's active driver", async () => {
  const h = harness();
  const tx = {
    ...(h.deps.createTransaction() as object),
    request: () => { h.log.push("tx.request"); return h.deps.createRequest(); },
  };
  const pool = { transaction: () => { h.log.push("pool.transaction"); return tx; } } as unknown as sql.ConnectionPool;
  const r = await runReadOnly(pool, async (req) => (await req.query("SELECT 1")).recordset, { invalidatePool: h.deps.invalidatePool });
  assert.deepEqual(r, [{ v: 1 }]);
  assert.equal(h.log[0], "pool.transaction");
  assert.ok(h.log.includes("tx.request"));
  assert.ok(h.log.includes("rollback"));
});
