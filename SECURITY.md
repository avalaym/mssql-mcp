# Security Policy

## Supported Versions

| Version | Supported |
| ------- | --------- |
| 3.x     | ✅ Yes    |
| < 3.0   | ❌ No     |

## Reporting a Vulnerability

Please **do not** disclose security vulnerabilities publicly (public issues are disabled on this repository).

Report them privately through [GitHub's private vulnerability reporting](https://github.com/avalaym/mssql-mcp/security/advisories/new) for this fork, or contact the maintainer directly via [github.com/avalaym](https://github.com/avalaym). You will receive a response within 7 business days.

This fork is maintained independently of the original project; vulnerabilities in this fork's releases (GitHub Packages / GitHub Releases) are handled here, not upstream.

## Safe Deployment Recommendations

- **Run on localhost only** — bind the MCP HTTP transport to `127.0.0.1` (default). Never expose it to the public internet.
- **Use firewall rules** — restrict access to the MCP port to trusted clients only.
- **Least-privilege database user** — create a dedicated SQL Server login with only the permissions the MCP server needs (e.g., `SELECT` only for read-only workloads). Do not use `sa` or an admin account.
- **Encrypt connections** — keep `DB_ENCRYPT=true` (the default). Only disable if your network is fully trusted and you understand the risks.

## Credential Policy

All database credentials are loaded **exclusively from environment variables**:
- `DB_SERVER`, `DB_DATABASE`, `DB_USER`, `DB_PASSWORD`, `DB_PORT`
- `DB_ENCRYPT`, `DB_TRUST_SERVER_CERTIFICATE`

**Credentials are never accepted as tool parameters.** This prevents credentials from being logged in MCP session transcripts or exposed to LLM context windows.

## SQL Injection Protections

- All user-supplied **values** must be passed via the `parameters` field (mssql named parameters). They are never interpolated into query strings.
- All **identifier names** (table, schema, procedure) are validated against a strict allowlist regex (`/^[a-zA-Z_][a-zA-Z0-9_$#@]{0,127}$/`) before being bracket-quoted.
- ORDER BY clauses are validated against a strict allowlist regex that permits only column names and ASC/DESC keywords.
