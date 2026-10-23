#!/usr/bin/env node
// Guard: `npm test` lists unit test files explicitly, so a new
// tests/unit/*.test.ts file is silently ignored until it is added to the
// "test" script in package.json. Fail CI when that happens.
//
// Usage: node scripts/check-test-manifest.mjs [repo-root]   (default: cwd)
import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";

const root = resolve(process.argv[2] ?? process.cwd());
const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
const testScript = pkg.scripts?.test ?? "";

const expected = readdirSync(join(root, "tests", "unit"))
  .filter((f) => f.endsWith(".test.ts"))
  .map((f) => `dist/tests/unit/${f.replace(/\.ts$/, ".js")}`)
  .sort();

const listed = new Set(testScript.split(/\s+/).filter((t) => t.startsWith("dist/")));
const missing = expected.filter((p) => !listed.has(p));
const stale = [...listed].filter((p) => !expected.includes(p));

if (missing.length > 0 || stale.length > 0) {
  for (const p of missing) {
    console.error(`Unit test not wired into "npm test": ${p}`);
  }
  for (const p of stale) {
    console.error(`"npm test" references a test file that no longer exists: ${p}`);
  }
  console.error('\nUpdate the "test" script in package.json.');
  process.exit(1);
}

console.log(`OK: ${expected.length} unit test file(s) wired into "npm test".`);
