// The justfile is the project's command surface, and `just` argument passing has a trap:
// `just build minify=true` hands the recipe the LITERAL string "minify=true". The recipe
// once compared against "true" only, so the documented command silently built unminified.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { test } from "vitest";

const ROOT = resolve(import.meta.dirname, "../..");

// what the recipe WOULD run — just prints the expanded command lines on stderr
function dryRun(...args: string[]): string {
  const result = spawnSync("just", ["--dry-run", ...args], { cwd: ROOT, encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  return result.stderr;
}

test("Tooling - Justfile - build minify=true really turns minification on", () => {
  assert.match(dryRun("build", "minify=true"), /MINIFY=1 \.\/scripts\/build\.sh/, "documented form");
  assert.match(dryRun("build", "true"), /MINIFY=1 \.\/scripts\/build\.sh/, "positional form");
  for (const off of [[], ["false"], ["minify=false"], ["yes"]]) {
    assert.match(
      dryRun("build", ...off),
      /MINIFY= \.\/scripts\/build\.sh/,
      `unminified for: ${off.join(" ") || "(no arg)"}`,
    );
  }
});

test("Tooling - Justfile - the performance tier builds first, defaults to 2000 tabs, and the quick form to 500", () => {
  assert.match(dryRun("test-perf"), /vite build[\s\S]*run\.ts --tabs 2000 --repeat 15 --label full/, "defaults");
  assert.match(dryRun("test-perf", "1000", "3"), /--tabs 1000 --repeat 3 --label full/, "positional overrides");
  assert.match(dryRun("perf-quick"), /--tabs 500 --repeat 3 --label quick/);
  assert.match(dryRun("perf-compare"), /node tests\/perf\/compare\.ts\s*$/m, "no args: the two newest runs");
  assert.match(dryRun("perf-at", "release-v1.0.7"), /at-ref\.sh release-v1\.0\.7 2000 15/, "a ref, the defaults");
  assert.match(
    dryRun("perf-refs"),
    /at-ref\.sh \$\(git describe --tags --abbrev=0\) 2000 15\n.*at-ref\.sh HEAD 2000 15\n.*compare\.ts/,
    "base = the last release tag, head = HEAD, then the comparison",
  );
  assert.match(
    dryRun("perf-refs", "abc1234", "def5678", "500", "2"),
    /at-ref\.sh abc1234 500 2\n.*at-ref\.sh def5678 500 2/,
  );
});

test("Tooling - Justfile - demo-stills takes the stills without filming, all by default", () => {
  assert.match(dryRun("demo-stills"), /node demo\/record\.ts --stills all\n.*encode\.sh --stills/, "no arg: all");
  assert.match(dryRun("demo-stills", "readme"), /node demo\/record\.ts --stills readme\n/, "readme only");
  assert.match(dryRun("demo-stills", "features"), /node demo\/record\.ts --stills features\n/, "features only");
});

test("Tooling - Justfile - build packs without the demo, publish records it", () => {
  assert.match(dryRun("build"), /MINIFY= \.\/scripts\/build\.sh/, "build runs the gate");
  assert.doesNotMatch(dryRun("build"), /RECORD_DEMO=1/, "build does not record");
  assert.match(dryRun("publish"), /MINIFY= RECORD_DEMO=1 \.\/scripts\/build\.sh/, "publish records");
  assert.match(dryRun("publish", "minify=true"), /MINIFY=1 RECORD_DEMO=1 \.\/scripts\/build\.sh/, "publish minified");
});
