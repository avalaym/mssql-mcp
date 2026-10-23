# Contributing

Thank you for your interest in contributing to mssql-mcp!

## Setup

```bash
git clone https://github.com/BYMCS/mssql-mcp.git
cd mssql-mcp
npm install
cp .env.example .env  # fill in your test DB credentials
```

## Build & Test

```bash
npm run build       # compile TypeScript
npm run typecheck   # type-check without emitting
npm run lint        # ESLint (typescript-eslint, flat config in eslint.config.js)
npm run check       # repo invariants: every tests/unit/*.test.ts is wired into
                    # `npm test`, and package.json version == SERVER_VERSION
npm test            # run unit tests (requires build first)
npm run ci          # full CI: lint + check + typecheck + build + test
```

Every pull request against `main` runs `.github/workflows/ci.yml`: lint and
repo checks, typecheck/build/unit tests on Node 20/22/24, and the integration
suite against a SQL Server 2022 container. The `CI passed` job is the single
status check to require in branch protection.

## Coding Conventions

- **ESM only** — all imports use `.js` extensions (even for `.ts` source files).
- **Strict TypeScript** — `strict: true` is enforced. No `any` without justification.
- **Zod for validation** — all tool input schemas use Zod.
- **Parameterized queries** — user values are always passed as mssql parameters. Never interpolate user input into SQL strings.
- **Identifier validation** — table/schema/procedure names must pass `isValidIdentifier()` before use.
- **No credentials in parameters** — database credentials come from environment variables only.

## Adding a New Tool

1. Create or update a file in `src/tools/`.
2. Export a `register*Tools(server: McpServer)` function.
3. Register the function in `src/server.ts`.
4. Add unit tests in `tests/unit/`.

## Pull Requests

- Keep PRs focused — one feature or fix per PR.
- Ensure `npm run ci` passes before submitting.
- Update `README.md` if you add or rename tools.
- Bump the version in `package.json` and `src/constants.ts` for releases.
