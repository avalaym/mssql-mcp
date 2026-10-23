import { strict as assert } from "node:assert";
import { test } from "node:test";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

// Tests run from dist/tests/unit/, the guard scripts live (uncompiled) at
// <repo>/scripts/. They are the CI gate, so a bug in them would block
// legitimate PRs: exercise both the passing and failing paths on fixtures.
const scriptsDir = fileURLToPath(new URL("../../../scripts/", import.meta.url));
const manifestScript = join(scriptsDir, "check-test-manifest.mjs");
const versionScript = join(scriptsDir, "check-version-sync.mjs");

type Fixture = {
  version?: string;
  serverVersion?: string;
  constantsSource?: string;
  testScript?: string;
  unitFiles?: string[];
};

function makeRepo(opts: Fixture = {}): string {
  const root = mkdtempSync(join(tmpdir(), "repo-guards-"));
  mkdirSync(join(root, "src"));
  mkdirSync(join(root, "tests", "unit"), { recursive: true });
  const unitFiles = opts.unitFiles ?? ["a.test.ts", "b.test.ts"];
  for (const f of unitFiles) {
    writeFileSync(join(root, "tests", "unit", f), "");
  }
  const testScript =
    opts.testScript ??
    `node --test ${unitFiles
      .filter((f) => f.endsWith(".test.ts"))
      .map((f) => `dist/tests/unit/${f.replace(/\.ts$/, ".js")}`)
      .join(" ")}`;
  writeFileSync(
    join(root, "package.json"),
    JSON.stringify({ version: opts.version ?? "1.2.3", scripts: { test: testScript } })
  );
  writeFileSync(
    join(root, "src", "constants.ts"),
    opts.constantsSource ??
      `export const SERVER_VERSION = "${opts.serverVersion ?? opts.version ?? "1.2.3"}";\n`
  );
  return root;
}

function run(script: string, root: string) {
  const res = spawnSync(process.execPath, [script, root], { encoding: "utf8" });
  return { status: res.status, stdout: res.stdout, stderr: res.stderr };
}

function withRepo(opts: Fixture, fn: (root: string) => void) {
  const root = makeRepo(opts);
  try {
    fn(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

test("check-test-manifest: passes when every unit test is listed", () => {
  withRepo({}, (root) => {
    const r = run(manifestScript, root);
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /OK: 2 unit test file\(s\)/);
  });
});

test("check-test-manifest: fails when a unit test is not wired into npm test", () => {
  withRepo(
    { unitFiles: ["a.test.ts", "b.test.ts"], testScript: "node --test dist/tests/unit/a.test.js" },
    (root) => {
      const r = run(manifestScript, root);
      assert.equal(r.status, 1);
      assert.match(r.stderr, /not wired into "npm test": dist\/tests\/unit\/b\.test\.js/);
    }
  );
});

test("check-test-manifest: fails when npm test references a deleted file", () => {
  withRepo(
    {
      unitFiles: ["a.test.ts"],
      testScript: "node --test dist/tests/unit/a.test.js dist/tests/unit/gone.test.js",
    },
    (root) => {
      const r = run(manifestScript, root);
      assert.equal(r.status, 1);
      assert.match(r.stderr, /no longer exists: dist\/tests\/unit\/gone\.test\.js/);
    }
  );
});

test("check-test-manifest: ignores non-test files in tests/unit", () => {
  withRepo(
    {
      unitFiles: ["a.test.ts", "helpers.ts", "README.md"],
      testScript: "node --test dist/tests/unit/a.test.js",
    },
    (root) => {
      const r = run(manifestScript, root);
      assert.equal(r.status, 0, r.stderr);
      assert.match(r.stdout, /OK: 1 unit test file\(s\)/);
    }
  );
});

test("check-test-manifest: fails when the test script is missing", () => {
  withRepo({ unitFiles: ["a.test.ts"], testScript: "" }, (root) => {
    const r = run(manifestScript, root);
    assert.equal(r.status, 1);
    assert.match(r.stderr, /not wired into "npm test"/);
  });
});

test("check-version-sync: passes when versions match", () => {
  withRepo({ version: "3.0.0" }, (root) => {
    const r = run(versionScript, root);
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /OK: version 3\.0\.0 is in sync/);
  });
});

test("check-version-sync: accepts single-quoted SERVER_VERSION", () => {
  withRepo(
    { version: "3.0.0", constantsSource: "export const SERVER_VERSION = '3.0.0';\n" },
    (root) => {
      const r = run(versionScript, root);
      assert.equal(r.status, 0, r.stderr);
    }
  );
});

test("check-version-sync: fails when versions diverge", () => {
  withRepo({ version: "3.0.1", serverVersion: "3.0.0" }, (root) => {
    const r = run(versionScript, root);
    assert.equal(r.status, 1);
    assert.match(r.stderr, /package\.json=3\.0\.1 src\/constants\.ts SERVER_VERSION=3\.0\.0/);
  });
});

test("check-version-sync: fails when SERVER_VERSION is absent", () => {
  withRepo({ constantsSource: "export const OTHER = 1;\n" }, (root) => {
    const r = run(versionScript, root);
    assert.equal(r.status, 1);
    assert.match(r.stderr, /Could not find SERVER_VERSION/);
  });
});

test("check-version-sync: does not match a prerelease prefix loosely", () => {
  withRepo({ version: "3.0.0", serverVersion: "3.0.0-beta.1" }, (root) => {
    const r = run(versionScript, root);
    assert.equal(r.status, 1);
  });
});

const releaseTagScript = join(scriptsDir, "check-release-tag.mjs");

function runTag(tag: string, root: string) {
  const res = spawnSync(process.execPath, [releaseTagScript, tag, root], { encoding: "utf8" });
  return { status: res.status, stdout: res.stdout, stderr: res.stderr };
}

test("check-release-tag: passes when the tag matches package.json", () => {
  withRepo({ version: "3.0.0" }, (root) => {
    const r = runTag("v3.0.0", root);
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /OK: tag v3\.0\.0 matches package\.json version 3\.0\.0/);
  });
});

test("check-release-tag: accepts a prerelease tag that matches exactly", () => {
  withRepo({ version: "3.1.0-rc.1" }, (root) => {
    const r = runTag("v3.1.0-rc.1", root);
    assert.equal(r.status, 0, r.stderr);
  });
});

test("check-release-tag: fails when the tag and package.json diverge", () => {
  withRepo({ version: "3.0.1" }, (root) => {
    const r = runTag("v3.0.0", root);
    assert.equal(r.status, 1);
    assert.match(r.stderr, /tag v3\.0\.0 .* package\.json version 3\.0\.1/);
  });
});

test("check-release-tag: fails when the tag lacks the v prefix", () => {
  withRepo({ version: "3.0.0" }, (root) => {
    const r = runTag("3.0.0", root);
    assert.equal(r.status, 1);
    assert.match(r.stderr, /must look like v<major>\.<minor>\.<patch>/);
  });
});

test("check-release-tag: fails when no tag is given", () => {
  withRepo({ version: "3.0.0" }, (root) => {
    const res = spawnSync(process.execPath, [releaseTagScript], { encoding: "utf8", cwd: root });
    assert.equal(res.status, 1);
    assert.match(res.stderr, /Usage: /);
  });
});

const changelogScript = join(scriptsDir, "changelog-section.mjs");

const SAMPLE_CHANGELOG = `# Changelog

Intro text.

## [3.1.0] - 2026-11-01

### Added

- Thing one.

## [3.0.0] - Unreleased

### Changed

- Thing two.
- Thing three.

## [2.9.0] - 2026-01-01

- Old.
`;

function runChangelog(version: string, changelog: string | null) {
  const root = mkdtempSync(join(tmpdir(), "changelog-"));
  try {
    if (changelog !== null) writeFileSync(join(root, "CHANGELOG.md"), changelog);
    const res = spawnSync(process.execPath, [changelogScript, version, root], { encoding: "utf8" });
    return { status: res.status, stdout: res.stdout, stderr: res.stderr };
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

test("changelog-section: prints exactly the requested version's section", () => {
  const r = runChangelog("3.0.0", SAMPLE_CHANGELOG);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.stdout, "### Changed\n\n- Thing two.\n- Thing three.\n");
});

test("changelog-section: works for the first and last sections", () => {
  const first = runChangelog("3.1.0", SAMPLE_CHANGELOG);
  assert.equal(first.status, 0, first.stderr);
  assert.equal(first.stdout, "### Added\n\n- Thing one.\n");
  const last = runChangelog("2.9.0", SAMPLE_CHANGELOG);
  assert.equal(last.status, 0, last.stderr);
  assert.equal(last.stdout, "- Old.\n");
});

test("changelog-section: fails when the version has no section", () => {
  const r = runChangelog("9.9.9", SAMPLE_CHANGELOG);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /No section for version 9\.9\.9/);
});

test("changelog-section: does not match a version prefix loosely", () => {
  const r = runChangelog("3.0", SAMPLE_CHANGELOG);
  assert.equal(r.status, 1);
});

test("changelog-section: fails when CHANGELOG.md is missing", () => {
  const r = runChangelog("3.0.0", null);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /CHANGELOG\.md/);
});

test("changelog-section: fails when no version is given", () => {
  const res = spawnSync(process.execPath, [changelogScript], { encoding: "utf8" });
  assert.equal(res.status, 1);
  assert.match(res.stderr, /Usage: /);
});
