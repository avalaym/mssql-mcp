// Read-only policy: mode detection and text scanners.
// These rules are a text-level guard, not a SQL parser. They reject anything
// that is not a single SELECT/WITH statement and any obvious write, DDL, exec or
// system-procedure keyword. The DB login should still be read-only as well.

import sql from "mssql";
import { poisonAndClosePool } from "../db/connection.js";
import { READ_ONLY_LOCK_TIMEOUT_MS } from "../constants.js";
import { toActionableError } from "../utils/errors.js";

export function isReadOnlyMode(env: NodeJS.ProcessEnv = process.env): boolean {
  const value = (env.MSSQL_MCP_READ_ONLY ?? "").trim().toLowerCase();
  return !(value === "false" || value === "0");
}

// String literals, bracketed identifiers and double-quoted identifiers are
// masked in ONE pass, so whichever delimiter opens first wins. A quote inside
// [..] or "..." therefore cannot desynchronise the masking.
const QUOTED_TOKEN = /'(?:[^']|'')*'|\[(?:[^\]]|\]\])*\]|"(?:[^"]|"")*"/g;
// Inert placeholders left by the masking. Removing them before the balance
// check means any delimiter still present is a real unmatched one.
const INERT_PLACEHOLDER = /''|\[x\]|"x"/g;
const UNMATCHED_DELIMITER = /['["]/;
const COMMENT = /--|\/\*/;
const TRAILING_SEMI = /;\s*$/;
const FIRST_WORD = /^\s*(SELECT|WITH)\b/i;
const NEXT_VALUE_FOR = /\bNEXT\s+VALUE\s+FOR\b/i;
// T-SQL does not require ';' between statements, so transaction control and
// statement-leading verbs must be rejected as words too (SELECT 1 COMMIT).
const FORBIDDEN_KEYWORDS = new RegExp(
  "\\b(" +
    [
      "INSERT|UPDATE|DELETE|MERGE|INTO|TRUNCATE|DROP|CREATE|ALTER|EXEC|EXECUTE|GRANT|REVOKE|DENY",
      "BACKUP|RESTORE|DBCC|KILL|SHUTDOWN|RECONFIGURE|WAITFOR|OPENROWSET|OPENQUERY|OPENDATASOURCE|BULK",
      "COMMIT|ROLLBACK|SAVE|BEGIN|TRAN|TRANSACTION|SET|USE|DECLARE|WRITETEXT|UPDATETEXT|READTEXT",
      "ENABLE|DISABLE|ADD|SEND|RECEIVE|MOVE|CONVERSATION|DIALOG|SETUSER|REVERT|CHECKPOINT",
      "RAISERROR|THROW|PRINT|GOTO|IF|WHILE|RETURN|OPEN|CLOSE|DEALLOCATE|CURSOR",
    ].join("|") +
    ")\\b",
  "i",
);
// Not preceded by "." or a word character, so dbo.Sp_NotAProc_Table passes.
const FORBIDDEN_PROC = /(?<![.\w])((?:xp|sp)_\w*)/i;

function maskQuotedTokens(text: string): string {
  return text.replace(QUOTED_TOKEN, (token) => {
    if (token.startsWith("'")) return "''";
    if (token.startsWith("[")) return "[x]";
    return '"x"';
  });
}

function scan(text: string, prefix: string, requireSelect: boolean): void {
  const masked = maskQuotedTokens(text);

  if (UNMATCHED_DELIMITER.test(masked.replace(INERT_PLACEHOLDER, ""))) {
    throw new Error(`${prefix}unbalanced quote or bracket`);
  }

  if (COMMENT.test(masked)) {
    throw new Error(`${prefix}comments (-- or /* */) are not allowed`);
  }

  const body = masked.replace(TRAILING_SEMI, "");
  if (body.includes(";")) {
    throw new Error(`${prefix}only a single statement is allowed (';' found)`);
  }

  if (requireSelect && !FIRST_WORD.test(body)) {
    throw new Error(`${prefix}statement must start with SELECT or WITH`);
  }

  if (NEXT_VALUE_FOR.test(body)) {
    throw new Error(`${prefix}forbidden phrase "NEXT VALUE FOR"`);
  }

  const keyword = FORBIDDEN_KEYWORDS.exec(body);
  if (keyword) {
    throw new Error(`${prefix}forbidden keyword "${keyword[0].toUpperCase()}"`);
  }

  const proc = FORBIDDEN_PROC.exec(body);
  if (proc) {
    throw new Error(`${prefix}forbidden procedure "${proc[1]}"`);
  }
}

export function assertReadOnlyStatement(statement: string): void {
  if (statement.trim() === "") {
    throw new Error("Read-only mode: statement is empty");
  }
  scan(statement, "Read-only mode: ", true);
}

export function assertSafeWhereClause(whereClause: string): void {
  scan(whereClause, "Unsafe whereClause: ", false);
}

export interface ReadOnlyTransaction {
  begin(): Promise<unknown>;
  rollback(): Promise<unknown>;
}

export interface RunReadOnlyDeps {
  createTransaction(pool: sql.ConnectionPool): ReadOnlyTransaction;
  createRequest(tx: ReadOnlyTransaction): sql.Request;
  invalidatePool(): Promise<void>;
}

const defaultRunReadOnlyDeps: RunReadOnlyDeps = {
  createTransaction: (p) => new sql.Transaction(p),
  createRequest: (tx) => new sql.Request(tx as sql.Transaction),
  invalidatePool: poisonAndClosePool,
};

/**
 * Runs fn inside a transaction that is always rolled back, so nothing a read-only
 * statement does can persist. If the rollback fails for a reason other than
 * EABORT (the server already rolled back), the pool is discarded because its
 * session state can no longer be trusted.
 */
export async function runReadOnly<T>(
  pool: sql.ConnectionPool,
  fn: (request: sql.Request) => Promise<T>,
  deps: Partial<RunReadOnlyDeps> = {},
): Promise<T> {
  const d: RunReadOnlyDeps = { ...defaultRunReadOnlyDeps, ...deps };
  const tx = d.createTransaction(pool);
  await tx.begin();

  let result!: T;
  let fnFailed = false;
  let fnError: unknown;
  try {
    await d.createRequest(tx).batch(`SET LOCK_TIMEOUT ${READ_ONLY_LOCK_TIMEOUT_MS}`);
    result = await fn(d.createRequest(tx));
  } catch (e) {
    fnFailed = true;
    fnError = e;
  }

  try {
    await tx.rollback();
  } catch (rollbackError) {
    if ((rollbackError as { code?: string } | null)?.code !== "EABORT") {
      console.error("read-only rollback failed:", toActionableError(rollbackError));
      let cleanupNote = "connection discarded";
      try {
        await d.invalidatePool();
      } catch (invalidateError) {
        console.error("pool invalidation failed:", toActionableError(invalidateError));
        cleanupNote = `connection could not be closed (${toActionableError(invalidateError)}) and is marked unusable`;
      }
      if (fnFailed) throw fnError;
      throw new Error(
        `Read-only rollback failed (${toActionableError(rollbackError)}); ${cleanupNote}. Reconnect with mssql_connect_database.`,
        { cause: rollbackError },
      );
    }
  }

  if (fnFailed) throw fnError;
  return result;
}
