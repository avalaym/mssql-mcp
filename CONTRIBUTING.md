# Contributing

Thank you for your interest in contributing to mssql-mcp!

## Setup

```bash
git clone https://github.com/avalaym/mssql-mcp.git
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
npm run check:release-tag -- vX.Y.Z   # release guard: tag == package.json version
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

## Releasing

Releases are **not** published to npmjs.com. Pushing a `vX.Y.Z` tag runs
`.github/workflows/release.yml`, which publishes the same build to two places:

1. **GitHub Packages** (npm registry): `@avalaym/mssql-mcp@X.Y.Z`, dist-tag
   `latest` (or `next` for prereleases such as `v3.1.0-rc.1`).
2. **GitHub Release** `vX.Y.Z` with the `npm pack` tarball
   (`avalaym-mssql-mcp-X.Y.Z.tgz`) and its `.sha256` attached, using the
   matching `CHANGELOG.md` section as release notes.

Steps:

```bash
# 1. On main, bump the version in BOTH files and move the CHANGELOG entry
#    from "Unreleased" to a dated "## [X.Y.Z] - YYYY-MM-DD" section.
#    (`npm run check` fails if package.json and SERVER_VERSION diverge.)
# 2. Open a PR with the bump, wait for "CI passed", merge it.
# 3. Tag the merge commit and push the tag:
git checkout main && git pull
git tag -a vX.Y.Z -m "Release vX.Y.Z"
git push origin vX.Y.Z
```

The workflow refuses to publish when the tag does not match `package.json`
(`npm run check:release-tag -- vX.Y.Z`), when lint/typecheck/unit tests fail,
or when the packed tarball does not install and start cleanly. Nothing is
published until the `Verify tag & build` job is green, so a failed release
leaves no partial artifacts behind except the tag itself; fix the problem,
delete the tag (`git push origin :refs/tags/vX.Y.Z`) and tag again.
