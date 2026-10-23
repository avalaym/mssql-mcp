import type sql from "mssql";
import { toActionableError } from "../utils/errors.js";

export interface PrincipalInfo {
  is_sysadmin: boolean | null;
  is_db_owner: boolean | null;
  is_db_datawriter: boolean | null;
  has_insert: boolean | null;
  has_update: boolean | null;
  has_delete: boolean | null;
  has_alter: boolean | null;
  can_write: boolean;
}

export interface SessionInfo {
  login_name: string | null;
  auth_scheme: string | null;
  principal: PrincipalInfo;
}

export const SESSION_QUERY = `SELECT SUSER_SNAME() AS login_name,
  c.auth_scheme,
  IS_SRVROLEMEMBER('sysadmin') AS is_sysadmin,
  IS_MEMBER('db_owner') AS is_db_owner,
  IS_MEMBER('db_datawriter') AS is_db_datawriter,
  HAS_PERMS_BY_NAME(DB_NAME(), 'DATABASE', 'INSERT') AS has_insert,
  HAS_PERMS_BY_NAME(DB_NAME(), 'DATABASE', 'UPDATE') AS has_update,
  HAS_PERMS_BY_NAME(DB_NAME(), 'DATABASE', 'DELETE') AS has_delete,
  HAS_PERMS_BY_NAME(DB_NAME(), 'DATABASE', 'ALTER') AS has_alter
FROM sys.dm_exec_connections AS c
WHERE c.session_id = @@SPID`;

export const WRITABLE_PRINCIPAL_WARNING =
  "⚠️ Read-only mode is on, but the connected principal can write (sysadmin/db_owner/...). The mode is defense in depth, not a guarantee; request a read-only account.";

// SQL Server returns flags as int 1/0 (IS_MEMBER, HAS_PERMS_BY_NAME) or bit
// booleans via the driver. Anything else (missing column, SQL NULL) is unknown.
function toBool(v: unknown): boolean | null {
  if (v === 1 || v === true) return true;
  if (v === 0 || v === false) return false;
  return null;
}

function toStringOrNull(v: unknown): string | null {
  return typeof v === "string" ? v : null;
}

export function toSessionInfo(row: Record<string, unknown> | undefined): SessionInfo {
  const principal = {
    is_sysadmin: toBool(row?.is_sysadmin),
    is_db_owner: toBool(row?.is_db_owner),
    is_db_datawriter: toBool(row?.is_db_datawriter),
    has_insert: toBool(row?.has_insert),
    has_update: toBool(row?.has_update),
    has_delete: toBool(row?.has_delete),
    has_alter: toBool(row?.has_alter),
  };
  const can_write = Object.values(principal).some((flag) => flag === true);
  return {
    login_name: toStringOrNull(row?.login_name),
    auth_scheme: toStringOrNull(row?.auth_scheme),
    principal: { ...principal, can_write },
  };
}

export async function describeSession(pool: sql.ConnectionPool): Promise<SessionInfo> {
  const result = await pool.request().query(SESSION_QUERY);
  return toSessionInfo(result.recordset[0] as Record<string, unknown> | undefined);
}

export async function sessionBlock(
  pool: sql.ConnectionPool,
): Promise<{ session: SessionInfo } | { session_error: string }> {
  try {
    return { session: await describeSession(pool) };
  } catch (err) {
    return { session_error: toActionableError(err) };
  }
}
