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

export type AuthSchemeSource = "dm_exec_connections" | "login_token" | null;

export interface SessionInfo {
  login_name: string | null;
  auth_scheme: string | null;
  auth_scheme_source: AuthSchemeSource;
  auth_scheme_error?: string;
  principal: PrincipalInfo;
}

export interface AuthSchemeResult {
  auth_scheme: string | null;
  source: AuthSchemeSource;
  error?: string;
}

// No FROM clause: needs no privilege beyond connecting.
export const PRINCIPAL_QUERY = `SELECT SUSER_SNAME() AS login_name,
  IS_SRVROLEMEMBER('sysadmin') AS is_sysadmin,
  IS_MEMBER('db_owner') AS is_db_owner,
  IS_MEMBER('db_datawriter') AS is_db_datawriter,
  HAS_PERMS_BY_NAME(DB_NAME(), 'DATABASE', 'INSERT') AS has_insert,
  HAS_PERMS_BY_NAME(DB_NAME(), 'DATABASE', 'UPDATE') AS has_update,
  HAS_PERMS_BY_NAME(DB_NAME(), 'DATABASE', 'DELETE') AS has_delete,
  HAS_PERMS_BY_NAME(DB_NAME(), 'DATABASE', 'ALTER') AS has_alter`;

// Needs VIEW SERVER STATE; exact scheme (NTLM/KERBEROS/SQL).
export const AUTH_SCHEME_QUERY = `SELECT c.auth_scheme FROM sys.dm_exec_connections AS c WHERE c.session_id = @@SPID`;

// sys.login_token is visible to every session; cannot tell NTLM from Kerberos.
export const AUTH_SCHEME_FALLBACK_QUERY = `SELECT CASE WHEN EXISTS (SELECT 1 FROM sys.login_token WHERE type IN ('WINDOWS LOGIN', 'WINDOWS GROUP')) THEN 'WINDOWS' ELSE 'SQL' END AS auth_scheme`;

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

export function toSessionInfo(row: Record<string, unknown> | undefined, scheme: AuthSchemeResult): SessionInfo {
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
  const info: SessionInfo = {
    login_name: toStringOrNull(row?.login_name),
    auth_scheme: scheme.auth_scheme,
    auth_scheme_source: scheme.source,
    principal: { ...principal, can_write },
  };
  if (scheme.error !== undefined) info.auth_scheme_error = scheme.error;
  return info;
}

async function resolveAuthScheme(pool: sql.ConnectionPool): Promise<AuthSchemeResult> {
  let firstError: unknown;
  try {
    const r = await pool.request().query(AUTH_SCHEME_QUERY);
    const scheme = toStringOrNull((r.recordset[0] as Record<string, unknown> | undefined)?.auth_scheme);
    if (scheme !== null) return { auth_scheme: scheme, source: "dm_exec_connections" };
    firstError = new Error("sys.dm_exec_connections returned no auth_scheme for this session");
  } catch (err) {
    firstError = err;
  }
  try {
    const r = await pool.request().query(AUTH_SCHEME_FALLBACK_QUERY);
    const scheme = toStringOrNull((r.recordset[0] as Record<string, unknown> | undefined)?.auth_scheme);
    if (scheme !== null) return { auth_scheme: scheme, source: "login_token" };
  } catch {
    // fall through to the first error
  }
  return { auth_scheme: null, source: null, error: toActionableError(firstError) };
}

export async function describeSession(pool: sql.ConnectionPool): Promise<SessionInfo> {
  const result = await pool.request().query(PRINCIPAL_QUERY);
  const scheme = await resolveAuthScheme(pool);
  return toSessionInfo(result.recordset[0] as Record<string, unknown> | undefined, scheme);
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
