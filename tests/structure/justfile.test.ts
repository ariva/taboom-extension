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
