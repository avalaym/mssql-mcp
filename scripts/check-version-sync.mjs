#!/usr/bin/env node
// Guard: releases must bump the version in BOTH package.json and
// src/constants.ts (SERVER_VERSION). Fail CI when they diverge.
import { readFileSync } from "node:fs";

const pkg = JSON.parse(readFileSync("package.json", "utf8"));
const constants = readFileSync("src/constants.ts", "utf8");
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
