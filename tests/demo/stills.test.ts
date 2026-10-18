// The feature stills (demo/README.md "Feature stills"): every scene but the outro takes at
// least one, names are unique lowercase slugs — docs link them by name, so a rename or a
// duplicate breaks a page silently. Static scan of the scene sources; runs once.
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "vitest";
import { SCENES } from "../../demo/scenes/index.ts";

const SCENES_DIR = "demo/scenes";

// still names per scene module: stage.still("<name>") calls, in source order
function stillsBySource(): Map<string, string[]> {
  const found = new Map<string, string[]>();
  for (const file of readdirSync(SCENES_DIR).filter((name) => name.endsWith(".ts") && name !== "index.ts")) {
    const source = readFileSync(join(SCENES_DIR, file), "utf8");
    found.set(
      file,
      [...source.matchAll(/stage\.still\(\s*"([^"]+)"/g)].map((match) => match[1] ?? ""),
    );
  }
  return found;
}

test("Demo - Stills - names are unique lowercase slugs", () => {
  const names = [...stillsBySource().values()].flat();
  assert.ok(names.length > 0, "no stage.still() calls found");
  for (const name of names) {
    assert.match(name, /^[a-z0-9]+(-[a-z0-9]+)*$/, `${name}: a still name is a lowercase slug`);
  }
  const duplicates = names.filter((name, index) => names.indexOf(name) !== index);
  assert.deepEqual(duplicates, [], "two scenes write the same still file");
});

test("Demo - Stills - every scene except the outro takes at least one", () => {
  // scene modules → the scene ids they export: a module with stills covers its scenes
  const modules = stillsBySource();
  const sourceOf = (id: string) =>
    [...modules.keys()].find((file) => readFileSync(join(SCENES_DIR, file), "utf8").includes(`id: "${id}"`));
  const without = SCENES.filter((scene) => scene.id !== "finished")
    .filter((scene) => (modules.get(sourceOf(scene.id) ?? "") ?? []).length === 0)
    .map((scene) => scene.id);
  assert.deepEqual(without, [], "scenes with no feature still");
});

const isReadme = (name: string) => name.startsWith("readme-");

test("Demo - Stills - docs/FEATURES.md shows every feature still and nothing else", () => {
  const names = [...stillsBySource().values()].flat().filter((name) => !isReadme(name));
  const page = readFileSync("docs/FEATURES.md", "utf8");
  const shown = [...page.matchAll(/assets\/features\/([a-z0-9-]+)\.png/g)].map((match) => match[1] ?? "");
  assert.deepEqual(
    names.filter((name) => !shown.includes(name)),
    [],
    "stills no feature section embeds",
  );
  assert.deepEqual(
    shown.filter((name) => !names.includes(name)),
    [],
    "images in FEATURES.md that no scene records",
  );
});

test("Demo - Stills - README shows every readme-* still and nothing else", () => {
  const names = [...stillsBySource().values()].flat().filter(isReadme);
  assert.ok(names.length > 0, "no readme-* stills: the README screenshots come from the readme scene");
  const page = readFileSync("README.md", "utf8");
  const images = [...page.matchAll(/docs\/assets\/([a-z0-9_/-]+)\.png/g)].map((match) => match[1] ?? "");
  assert.deepEqual(
    images.filter((image) => !names.includes(image.replace(/^features\//, ""))),
    [],
    "README screenshots no scene records",
  );
  assert.deepEqual(
    names.filter((name) => !images.includes(`features/${name}`)),
    [],
    "readme-* stills the README does not show",
  );
});
