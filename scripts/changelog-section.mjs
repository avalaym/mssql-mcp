#!/usr/bin/env node
// Prints the CHANGELOG.md body for one version (the text between its
// "## [X.Y.Z]" heading and the next "## " heading), trimmed, so the release
// workflow can use it as the GitHub Release notes. Exits 1 when the version
// has no section, which the workflow treats as "fall back to a generic note".
//
// Usage: node scripts/changelog-section.mjs <version> [repo-root]   (default: cwd)
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";

const version = process.argv[2];
if (!version) {
  console.error("Usage: node scripts/changelog-section.mjs <version> [repo-root]");
  process.exit(1);
}

const root = resolve(process.argv[3] ?? process.cwd());
const file = join(root, "CHANGELOG.md");
if (!existsSync(file)) {
  console.error(`CHANGELOG.md not found at ${file}`);
  process.exit(1);
}

const lines = readFileSync(file, "utf8").split(/\r?\n/);
const escaped = version.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const heading = new RegExp(`^## \\[${escaped}\\](\\s|$)`);

const start = lines.findIndex((l) => heading.test(l));
if (start === -1) {
  console.error(`No section for version ${version} in CHANGELOG.md`);
  process.exit(1);
}

let end = lines.length;
for (let i = start + 1; i < lines.length; i++) {
  if (/^## /.test(lines[i])) {
    end = i;
    break;
  }
}

const body = lines.slice(start + 1, end).join("\n").trim();
process.stdout.write(body + "\n");
