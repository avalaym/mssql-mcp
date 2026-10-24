# MS SQL Server MCP Server v3.0.1

🚀 **Model Context Protocol (MCP) server** for Microsoft SQL Server - compatible with Claude Desktop, Cursor, Windsurf and VS Code.

[![CI](https://github.com/avalaym/mssql-mcp/actions/workflows/ci.yml/badge.svg)](https://github.com/avalaym/mssql-mcp/actions/workflows/ci.yml)
[![Release](https://img.shields.io/github/v/release/avalaym/mssql-mcp?sort=semver)](https://github.com/avalaym/mssql-mcp/releases)
[![GitHub Packages](https://img.shields.io/badge/GitHub%20Packages-%40avalaym%2Fmssql--mcp-blue)](https://github.com/avalaym/mssql-mcp/pkgs/npm/mssql-mcp)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

## Standards Alignment

- Protocol target: [MCP draft/latest spec](https://modelcontextprotocol.io/specification/draft/server/tools)
- Transport spec: [Transports](https://modelcontextprotocol.io/specification/draft/basic/transports)
- Security: [Security best practices](https://modelcontextprotocol.io/docs/tutorials/security/security_best_practices)
- SDK: `@modelcontextprotocol/server` / `@modelcontextprotocol/client` / `@modelcontextprotocol/node` v2 (`2.0.0`), targeting the 2026-07-28 MCP spec
- Requires Node.js >= 20

## 🚀 Quick Start

### 1. Install

> This fork is **not published to npmjs.com**. Every tagged release is
> published to [GitHub Packages](https://github.com/avalaym/mssql-mcp/pkgs/npm/mssql-mcp)
> and attached as a tarball to the matching
> [GitHub Release](https://github.com/avalaym/mssql-mcp/releases). Pick one
> of the two channels below; both install the `mssql-mcp-server` command.

**Option A — tarball from a GitHub Release (no authentication):**

```bash
# Replace X.Y.Z with the version from https://github.com/avalaym/mssql-mcp/releases
npm install -g https://github.com/avalaym/mssql-mcp/releases/download/vX.Y.Z/avalaym-mssql-mcp-X.Y.Z.tgz
```

Each release also ships a `.sha256` file next to the tarball; verify with
`sha256sum -c avalaym-mssql-mcp-X.Y.Z.tgz.sha256` after downloading both.

**Option B — npm package from GitHub Packages (needs a GitHub token):**

GitHub Packages requires authentication to *install* npm packages, even from
public repositories. Create a
[personal access token](https://github.com/settings/tokens) with the
`read:packages` scope, then point the `@avalaym` scope at the GitHub registry:

```bash
# ~/.npmrc
@avalaym:registry=https://npm.pkg.github.com
//npm.pkg.github.com/:_authToken=YOUR_GITHUB_TOKEN
```

```bash
npm install -g @avalaym/mssql-mcp          # latest stable
npm install -g @avalaym/mssql-mcp@3.0.1    # pin a version
```

Either way, check the install with:

```bash
npm ls -g @avalaym/mssql-mcp   # shows the installed version
which mssql-mcp-server          # the command your IDE will run
```

To upgrade, install the new release the same way; to remove,
`npm uninstall -g @avalaym/mssql-mcp`.

### 2. Configure IDE

**Claude Desktop** (`claude_desktop_config.json`):
```json
{
  "mcpServers": {
    "mssql": {
      "command": "mssql-mcp-server",
      "env": {
        "DB_SERVER": "your-server.com",
        "DB_DATABASE": "your-database",
        "DB_USER": "your-username",
        "DB_PASSWORD": "your-password",
        "DB_ENCRYPT": "true",
        "DB_TRUST_SERVER_CERTIFICATE": "true"
      }
    }
  }
}
```

**Cursor/Windsurf/VS Code** (`.vscode/mcp.json`):
```json
{
  "servers": {
    "mssql": {
      "command": "mssql-mcp-server",
      "env": {
        "DB_SERVER": "your-server.com",
        "DB_DATABASE": "your-database",
        "DB_USER": "your-username",
        "DB_PASSWORD": "your-password",
        "DB_ENCRYPT": "true",
        "DB_TRUST_SERVER_CERTIFICATE": "true"
      }
    }
  }
}
```

**HTTP transport** (remote/hosted scenarios):
```json
{
  "servers": {
    "mssql": {
      "type": "http",
      "url": "http://127.0.0.1:3001",
      "env": {}
    }
  }
}
```

> Replace with your actual database credentials. Credentials are read from the **server environment only** — never passed as tool parameters.
>
> `mssql-mcp-server` is the executable installed in step 1. If your IDE cannot find it on `PATH`, use the absolute path printed by `npm root -g` (e.g. `/usr/local/lib/node_modules/@avalaym/mssql-mcp/dist/src/index.js`) with `"command": "node"`.
>
> **New in 3.0.1:** the server starts in **read-only mode** by default (`MSSQL_MCP_READ_ONLY`, see the "Read-only mode" section below); add `"MSSQL_MCP_READ_ONLY": "false"` to the `env` block only when you need writes. To connect with a domain account add `"DB_AUTH_TYPE": "ntlm"` and `"DB_DOMAIN": "EXAMPLE"` and use the bare account name in `DB_USER` (see the "NTLM authentication" section below). `.env` files are loaded only when `"MSSQL_MCP_DOTENV": "1"` is set.

## 🧰 Tool Catalog

### Primary tools (use these)

| Tool | Read-only | Description |
|------|-----------|-------------|
| `mssql_connect_database` | No | Connect using env variables. Idempotent. |
| `mssql_disconnect_database` | No | Close connection. Idempotent. |
| `mssql_connection_status` | ✅ | Connection state and pool metrics |
| `mssql_run_sql_query` | ⚠️ No | Execute SQL. In read-only mode (default) only a single `SELECT`/`WITH`; with the mode off, arbitrary SQL that **may mutate data**. |
| `mssql_list_schema_objects` | ✅ | List tables/views/procedures/functions with pagination |
| `mssql_describe_table_columns` | ✅ | Column definitions for a table |
| `mssql_read_table_rows` | ✅ | Paginated rows with projection and safe WHERE |
| `mssql_execute_stored_procedure` | ⚠️ No | Execute a stored procedure (not registered in read-only mode) |
| `mssql_list_databases` | ✅ | List all databases on the instance |

All data tools accept a `response_format` parameter (`"json"` | `"markdown"`, default `"json"`). Use `"markdown"` to get human-readable table output.

### Deprecated aliases (registered for backward compatibility only when read-only mode is off)

These are the only alias tool names the server actually registers (in `src/tools/*.ts`).
They behave the same as their replacement but are not documented in new integrations —
use the primary tool names above instead.

| Old name | Use instead |
|----------|-------------|
| `mssql_execute_query` | `mssql_run_sql_query` |
| `mssql_get_schema` | `mssql_list_schema_objects` |
| `mssql_describe_table` | `mssql_describe_table_columns` |
| `mssql_get_table_data` | `mssql_read_table_rows` |
| `mssql_execute_procedure` | `mssql_execute_stored_procedure` |

## 🚌 Transport Modes

| Mode | Use when |
|------|----------|
| `stdio` (default) | Local IDE integration (Claude Desktop, Cursor, VS Code) |
| `http` | Remote/hosted deployment, testing with MCP Inspector |

```bash
# stdio (default)
node dist/src/index.js

# HTTP on 127.0.0.1:3001
MCP_TRANSPORT=http node dist/src/index.js

# Custom HTTP host/port
MCP_TRANSPORT=http MCP_HOST=0.0.0.0 MCP_PORT=8080 node dist/src/index.js
```

## 🔧 Environment Variables

### Database connection

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `DB_SERVER` | ✅ | — | SQL Server hostname or IP |
| `DB_DATABASE` | ❌ | — | Database name |
| `DB_USER` | ❌ | — | Login username |
| `DB_PASSWORD` | ❌ | — | Login password |
| `DB_AUTH_TYPE` | ❌ | `sql` | `sql` or `ntlm` (see NTLM authentication below) |
| `DB_DOMAIN` | With `ntlm` | — | Windows/AD domain; required when `DB_AUTH_TYPE=ntlm` |
| `DB_PORT` | ❌ | 1433 | TCP port |
| `DB_ENCRYPT` | ❌ | true | Enable TLS (required for Azure SQL) |
| `DB_TRUST_SERVER_CERTIFICATE` | ❌ | false | Trust self-signed certs |
| `DB_CONNECTION_TIMEOUT` | ❌ | 30000 | Connection timeout ms |
| `DB_REQUEST_TIMEOUT` | ❌ | 30000 | Query timeout ms |

### Server behaviour

| Variable | Default | Description |
|----------|---------|-------------|
| `MSSQL_MCP_READ_ONLY` | `true` | Read-only mode (see Read-only mode below). Only `false` or `0` turn it off |
| `MSSQL_MCP_DOTENV` | unset | Set to `1` in the process environment to load a `.env` file |

> **Behaviour change:** the server no longer loads `.env` automatically. The file is loaded only when `MSSQL_MCP_DOTENV=1` is set in the process environment (not inside the `.env` itself). Without it, only the environment your IDE or shell passes is used.

### Transport

| Variable | Default | Description |
|----------|---------|-------------|
| `MCP_TRANSPORT` | `stdio` | `stdio` or `http` |
| `MCP_HOST` | `127.0.0.1` | HTTP bind address |
| `MCP_PORT` | `3001` | HTTP port |

## 🔒 Security Model

- **No credential parameters**: All connection settings come from environment variables only. Tool inputs cannot override connection config.
- **Identifier validation**: Schema, table, and procedure names are validated against a safe identifier pattern before interpolation into SQL.
- **Parameterized queries**: All user-supplied values (WHERE clause values, column values) must be passed as named parameters via `@paramName` — never embedded in query strings.
- **Origin and Host validation**: HTTP transport validates both the `Origin` and `Host` headers against an allowlist (localhost, `[::1]`, and the configured bind host by default), guarding against DNS rebinding.
- **SQL risk labeling**: `run_sql_query` and `execute_stored_procedure` are explicitly labeled as non-read-only and open-world.
- **Read-only mode on by default**: see the next section. It reduces risk but is not a substitute for a read-only account.

### ⚠️ SQL Risk Notes

With read-only mode off, `run_sql_query` accepts arbitrary SQL including DDL and DML. To minimize risk:
- Use a least-privilege SQL login (SELECT-only where possible)
- Never run the server with a `sysadmin` or `sa` account
- Consider network firewall rules to limit what the server can reach

## 🛡️ Read-only mode

Read-only mode is **on by default**. It is defense in depth, not a guarantee: it is a text-level filter plus a transaction that is always rolled back, and it is not a SQL parser. **The permissions of the account the server connects with are the real boundary.**

**What it does**

- `mssql_run_sql_query` accepts a single `SELECT` or `WITH` statement only. Comments (`--`, `/* */`) and `;` (other than a trailing one) are rejected.
- T-SQL does not require `;` between statements (`SELECT 1 COMMIT` is two statements), so the scanner also rejects transaction-control and statement-leading verbs as whole words (a digit directly before a keyword counts as a boundary, because T-SQL does not require whitespace after a numeric literal, as in `SELECT 1COMMIT`): `COMMIT`, `ROLLBACK`, `SAVE`, `BEGIN`, `TRAN`, `TRANSACTION`, `SET`, `USE`, `DECLARE`, `WRITETEXT`, `UPDATETEXT`, `READTEXT`, `ENABLE`, `DISABLE`, `ADD`, `SEND`, `RECEIVE`, `MOVE`, `CONVERSATION`, `DIALOG`, `SETUSER`, `REVERT`, `CHECKPOINT`, `RAISERROR`, `THROW`, `PRINT`, `GOTO`, `IF`, `WHILE`, `RETURN`, `OPEN`, `CLOSE`, `DEALLOCATE` and `CURSOR`. This also rejects harmless uses such as `OPTION (USE HINT ...)`.
- Statements containing write, DDL, execution or administration keywords are rejected: `INSERT`, `UPDATE`, `DELETE`, `MERGE`, `INTO`, `TRUNCATE`, `DROP`, `CREATE`, `ALTER`, `EXEC`, `EXECUTE`, `GRANT`, `REVOKE`, `DENY`, `BACKUP`, `RESTORE`, `DBCC`, `KILL`, `SHUTDOWN`, `RECONFIGURE`, `WAITFOR`, `OPENROWSET`, `OPENQUERY`, `OPENDATASOURCE`, `BULK`, `xp_`/`sp_` procedure names that are not schema-qualified (`EXEC` itself is also rejected), and the phrase `NEXT VALUE FOR`.
- Unbalanced quotes or brackets are rejected (the filter fails closed when it cannot tell what is a literal).
- Every `mssql_run_sql_query` (read-only mode) and `mssql_read_table_rows` query runs inside a transaction that is always rolled back, with a lock timeout. The catalog, column, database and session queries do not.
- A boundary tripwire compares `CURRENT_TRANSACTION_ID()` and `@@TRANCOUNT` before and after each query; if the transaction changed, the result is discarded and the connection is closed. This requires SQL Server 2016 or later. `SET LOCK_TIMEOUT` is reset to its default before the rollback, because it persists on pooled connections; if the reset fails the connection is discarded.
- `whereClause` in `mssql_read_table_rows` goes through the same text checks in every mode, including when read-only mode is off, except the `SELECT`/`WITH` requirement.
- The stored-procedure tool and the five deprecated aliases are not registered.

**What it cannot undo**

- Side effects that are not rolled back with a transaction. Sequence consumption is one example: `NEXT VALUE FOR` is blocked by phrase, but the family of such effects cannot be enumerated.
- User-defined functions with side effects invoked from a `SELECT`.
- Anything reachable from a read that acts outside the database: `xp_cmdshell`, Database Mail and linked servers, if the account is allowed to use them.

**Check the principal.** `mssql_connect_database` and `mssql_connection_status` report `read_only`, `session.login_name`, `session.auth_scheme` and `session.principal` (`is_sysadmin`, `is_db_owner`, `is_db_datawriter`, `has_insert`, `has_update`, `has_delete`, `has_alter`, `can_write`). When read-only mode is on and the principal can write, `mssql_connect_database` adds a warning to its text; the status tool and the resource expose `session.principal.can_write` without the warning text. `auth_scheme` is `NTLM`, `KERBEROS` or `SQL` when the principal has `VIEW SERVER STATE`; otherwise it falls back to `WINDOWS` or `SQL` derived from `sys.login_token`, and `session.auth_scheme_source` (`dm_exec_connections` or `login_token`) says which was used. `WINDOWS` does not distinguish NTLM from Kerberos. If both lookups fail, `auth_scheme` and `auth_scheme_source` are `null` and `auth_scheme_error` explains why; the rest of the session block is still returned. `can_write` is a hint, not an audit: it uses database-level checks only. Per-table grants and custom roles are not detected, so `false` means "no write permission found in the places checked", not "cannot write".

**The real control is a read-only account.** Connect with a login that has only `SELECT` (for example membership in `db_datareader` and nothing else) and no access to `xp_cmdshell`, Database Mail or linked servers.

**Turning it off.** Set `MSSQL_MCP_READ_ONLY=false` (or `0`); any other value, or leaving it unset, keeps the mode on. Turning it off registers the stored-procedure tool and the deprecated aliases again, and `mssql_run_sql_query` accepts arbitrary SQL.

## 🔑 NTLM authentication

Set `DB_AUTH_TYPE=ntlm` to log in with a Windows/Active Directory account:

```bash
DB_AUTH_TYPE=ntlm
DB_DOMAIN=EXAMPLE
DB_USER=analyst
DB_PASSWORD=...
DB_SERVER=localhost
```

- `DB_USER` must be the bare account name (`analyst`, not `EXAMPLE\analyst` or `analyst@example`); the domain goes in `DB_DOMAIN`.
- NTLM is implemented by the `tedious` driver in pure JavaScript. It does not use a Windows session, SSPI or Kerberos, so it works from Linux and WSL.
- CI does not exercise NTLM against a server. To verify it locally against your own server:

```bash
DB_AUTH_TYPE=ntlm DB_DOMAIN=... DB_USER=... DB_PASSWORD=... DB_SERVER=... npm run test:integration
```

## 📄 Pagination

All list tools return a `pagination` object:

```json
{
  "count": 20,
  "limit": 20,
  "offset": 0,
  "has_more": true,
  "next_offset": 20,
  "total_count": 150
}
```

Default page size: **20 rows**. Maximum: **200 rows**.

Results are also truncated if the serialized payload exceeds 100KB, with a `truncation_message` explaining how many rows were dropped.

## 🏗️ Architecture

```
src/
  index.ts          ← bootstrap (env, transport selection)
  server.ts         ← createServer() factory
  constants.ts      ← limits, defaults, protocol strings
  config.ts         ← env parsing
  types.ts          ← shared TypeScript interfaces
  policy/
    read-only.ts    ← read-only mode filter and always-rolled-back transactions
  db/
    connection.ts   ← connection pool singleton
    session.ts      ← session identity and principal write-privilege hints
    validators.ts   ← SQL identifier validation
    query-builders.ts ← safe parameterized query construction
  tools/            ← one file per tool group
  resources/        ← MCP resource handlers
  transports/       ← stdio and HTTP transports
  utils/
    errors.ts       ← error normalization helpers
    format.ts       ← JSON formatting, payload truncation
    markdown.ts     ← markdown table/list rendering helpers
    pagination.ts   ← pagination metadata helpers
```

## 🧪 Inspector Smoke Test

```bash
npx @modelcontextprotocol/inspector
```

Expected:
- stdio server connects
- Tool list renders with all tools
- `mssql_connection_status` returns JSON without a connection
- `mssql_connect_database` works when env variables are set

## 🔨 Development

```bash
npm install
cp .env.example .env  # fill in your test DB credentials; loaded only with MSSQL_MCP_DOTENV=1
npm run typecheck     # type check only
npm run build         # compile TypeScript
npm test              # run unit tests
npm run ci            # typecheck + build + test
```

## License

[MIT](LICENSE) © BYMCS — fork maintained at [avalaym/mssql-mcp](https://github.com/avalaym/mssql-mcp)
