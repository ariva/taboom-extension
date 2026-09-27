// Structure guard: no import cycles under src/ and tooling/. A cycle means two modules
// cannot be understood, tested or moved apart — the opposite of "small reusable units".
// Type-only imports are ignored: they vanish at build time and cannot cause evaluation cycles.
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { test } from "vitest";

const ROOT = resolve(import.meta.dirname, "../..");

function* sourceFiles(dir: string): Generator<string> {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) {
      yield* sourceFiles(path);
    } else if (path.endsWith(".ts") && !path.endsWith(".d.ts")) {
      yield path;
    }
  }
}

// runtime edges only: `import type …` / `export type …` are skipped. `;` cannot appear
// inside one import statement, so the lazy part never runs on into the next statement
function runtimeImports(source: string): string[] {
  const specifiers: string[] = [];
  const pattern = /^\s*(?:import|export)\s+(?!type\b)(?:[^"';]*?from\s+)?["'](\.[^"']+)["']/gm;
  for (const match of source.matchAll(pattern)) {
    specifiers.push(match[1] as string); // group 1 always participates in a match
  }
  return specifiers;
}

function findCycle(graph: ReadonlyMap<string, readonly string[]>): string[] | null {
  const done = new Set<string>();
  const stack: string[] = [];
  const visit = (node: string): string[] | null => {
    const at = stack.indexOf(node);
    if (at !== -1) {
      return [...stack.slice(at), node];
    }
    if (done.has(node)) {
      return null;
    }
    stack.push(node);
    for (const next of graph.get(node) ?? []) {
      const cycle = visit(next);
      if (cycle) {
        return cycle;
      }
    }
    stack.pop();
    done.add(node);
    return null;
  };
  for (const node of graph.keys()) {
    const cycle = visit(node);
    if (cycle) {
      return cycle;
    }
  }
  return null;
}

test("Structure - findCycle reports a cycle and accepts a DAG", () => {
  assert.equal(
    findCycle(
      new Map([
        ["a", ["b"]],
        ["b", ["c"]],
        ["c", []],
      ]),
    ),
    null,
  );
  assert.deepEqual(
    findCycle(
      new Map([
        ["a", ["b"]],
        ["b", ["c"]],
        ["c", ["a"]],
      ]),
    ),
    ["a", "b", "c", "a"],
  );
  assert.deepEqual(
    runtimeImports('import type { A } from "./a.ts";\nimport { b } from "./b.ts";\nexport * from "./c.ts";'),
    ["./b.ts", "./c.ts"],
  );
});

test("Structure - No runtime import cycles under src/ and tooling/", () => {
  const graph = new Map<string, string[]>();
  for (const dir of ["src", "tooling"]) {
    for (const file of sourceFiles(join(ROOT, dir))) {
      const imports = runtimeImports(readFileSync(file, "utf8")).map((specifier) =>
        relative(ROOT, resolve(dirname(file), specifier)),
      );
      graph.set(relative(ROOT, file), imports);
    }
  }
  assert.ok(graph.size > 10, "walked the source tree");
  const cycle = findCycle(graph);
  assert.equal(cycle, null, `import cycle: ${cycle?.join(" → ")}`);
});
