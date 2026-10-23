#!/usr/bin/env node
// Guard: a release tag must match the version in package.json exactly, so
// the published package, the GitHub Release and the tarball all carry the
// same version. Run from the release workflow before publishing anything.
//
// Usage: node scripts/check-release-tag.mjs <tag> [repo-root]   (default: cwd)
//   <tag> looks like v<major>.<minor>.<patch>[-prerelease][+build]
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";

const tag = process.argv[2];
if (!tag) {
  console.error("Usage: node scripts/check-release-tag.mjs <tag> [repo-root]");
  process.exit(1);
}

// SemVer 2.0.0 shape, with a mandatory leading "v".
const SEMVER_TAG =
  /^v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;

if (!SEMVER_TAG.test(tag)) {
  console.error(
    `Release tag "${tag}" must look like v<major>.<minor>.<patch> (optionally -prerelease).`
  );
  process.exit(1);
}

const root = resolve(process.argv[3] ?? process.cwd());
const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
const tagVersion = tag.slice(1);

if (tagVersion !== pkg.version) {
  console.error(
    `Version mismatch: tag ${tag} (${tagVersion}) does not match package.json version ${pkg.version}`
  );
  process.exit(1);
}

console.log(`OK: tag ${tag} matches package.json version ${pkg.version}.`);
