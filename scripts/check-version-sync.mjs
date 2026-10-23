#!/usr/bin/env node
// Guard: releases must bump the version in BOTH package.json and
// src/constants.ts (SERVER_VERSION). Fail CI when they diverge.
//
// Usage: node scripts/check-version-sync.mjs [repo-root]   (default: cwd)
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";

const root = resolve(process.argv[2] ?? process.cwd());
const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
const constants = readFileSync(join(root, "src", "constants.ts"), "utf8");
const match = constants.match(/export const SERVER_VERSION\s*=\s*["']([^"']+)["']/);

if (!match) {
  console.error("Could not find SERVER_VERSION in src/constants.ts");
  process.exit(1);
}

if (match[1] !== pkg.version) {
  console.error(
    `Version mismatch: package.json=${pkg.version} src/constants.ts SERVER_VERSION=${match[1]}`
  );
  process.exit(1);
}

console.log(`OK: version ${pkg.version} is in sync.`);
