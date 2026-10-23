// Read-only policy: mode detection and text scanners.
// These rules are a text-level guard, not a SQL parser. They reject anything
// that is not a single SELECT/WITH statement and any obvious write, DDL, exec or
// system-procedure keyword. The DB login should still be read-only as well.

export function isReadOnlyMode(env: NodeJS.ProcessEnv = process.env): boolean {
  const value = (env.MSSQL_MCP_READ_ONLY ?? "").trim().toLowerCase();
  return !(value === "false" || value === "0");
}

// Literals and bracketed identifiers are masked before any rule runs, so
// keywords or punctuation inside them cannot trigger or hide a rule.
const STRING_LITERAL = /'(?:[^']|'')*'/g; // -> "''"
const BRACKET_IDENT = /\[[^\]]*\]/g; // -> "[x]"
const COMMENT = /--|\/\*/;
const TRAILING_SEMI = /;\s*$/;
const FIRST_WORD = /^\s*(SELECT|WITH)\b/i;
const NEXT_VALUE_FOR = /\bNEXT\s+VALUE\s+FOR\b/i;
const FORBIDDEN_KEYWORDS =
  /\b(INSERT|UPDATE|DELETE|MERGE|INTO|TRUNCATE|DROP|CREATE|ALTER|EXEC|EXECUTE|GRANT|REVOKE|DENY|BACKUP|RESTORE|DBCC|KILL|SHUTDOWN|RECONFIGURE|WAITFOR|OPENROWSET|OPENQUERY|OPENDATASOURCE|BULK)\b/i;
// Not preceded by "." or a word character, so dbo.Sp_NotAProc_Table passes.
const FORBIDDEN_PROC = /(?<![.\w])((?:xp|sp)_\w*)/i;

function scan(text: string, prefix: string, requireSelect: boolean): void {
  const masked = text.replace(STRING_LITERAL, "''").replace(BRACKET_IDENT, "[x]");

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
