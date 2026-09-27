// Mechanical guard for the starter extraction: src/lib and tooling are GENERIC
// and may not reach into Taboom's own layers.
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "vitest";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const GENERIC = ["src/lib", "tooling"];
const FORBIDDEN = ["src/app", "src/pages", "src/background"];

// static + dynamic imports and re-exports: from "x" / import "x" / import("x")
const SPECIFIER = /(?:\bfrom\s*|\bimport\s*\(?\s*)["']([^"']+)["']/g;

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      return sourceFiles(path);
    }
    return /\.[cm]?[jt]s$/.test(entry.name) ? [path] : [];
  });
}

// relative specifier → repo-relative path; bare package names pass through
function target(file: string, specifier: string): string {
  return specifier.startsWith(".") ? relative(ROOT, resolve(dirname(file), specifier)) : specifier;
}

function violations(file: string, source: string): string[] {
  return [...source.matchAll(SPECIFIER)]
    .map((match) => target(file, match[1] ?? ""))
    .filter((path) => FORBIDDEN.some((layer) => path === layer || path.startsWith(`${layer}/`)))
    .map((path) => `${relative(ROOT, file)} imports ${path}`);
}

test("Lib - Boundary - src/lib and tooling import nothing from app, pages or background", () => {
  const files = GENERIC.flatMap((dir) => sourceFiles(join(ROOT, dir)));
  assert.ok(files.length > 0, "guard walks real files");
  assert.deepEqual(
    files.flatMap((file) => violations(file, readFileSync(file, "utf8"))),
    [],
  );
});

test("Lib - Boundary - The guard catches static, type-only, side-effect and dynamic imports", () => {
  const file = join(ROOT, "src/lib/platform/x.ts");
  const source = [
    'import { a } from "../../app/core.ts";',
    'import type { B } from "../../pages/sidepanel/model/index.ts";',
    'import "../../background/service-worker.ts";',
    'const c = await import("../../app/env.ts");',
    'export { d } from "../dom.ts";',
    'import { e } from "vite";',
  ].join("\n");
  assert.deepEqual(violations(file, source), [
    "src/lib/platform/x.ts imports src/app/core.ts",
    "src/lib/platform/x.ts imports src/pages/sidepanel/model/index.ts",
    "src/lib/platform/x.ts imports src/background/service-worker.ts",
    "src/lib/platform/x.ts imports src/app/env.ts",
  ]);
});
