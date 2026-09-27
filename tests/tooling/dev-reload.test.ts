// Pure tests for tooling/dev-reload-core.ts — what a rebuild means for the loaded extension.
import assert from "node:assert/strict";
import { test } from "vitest";
import { classifyChange, diffBuilds } from "../../tooling/dev-reload-core.ts";

const PAGES = ["sidepanel", "options"];

test("Tooling - Dev reload - Page-only changes reload pages, anything else reloads the extension", () => {
  assert.equal(classifyChange([], PAGES), "none");
  assert.equal(classifyChange(["sidepanel/index.js", "assets/sidepanel.css"], PAGES), "pages");
  assert.equal(classifyChange(["options/index.html"], PAGES), "pages");
  assert.equal(classifyChange(["background/service-worker.js"], PAGES), "extension");
  assert.equal(classifyChange(["manifest.json"], PAGES), "extension");
  assert.equal(classifyChange(["features.json"], PAGES), "extension", "the worker reads it too");
  assert.equal(
    classifyChange(["sidepanel/index.js", "chunks/env.js"], PAGES),
    "extension",
    "a shared chunk may be loaded by the worker — one non-page file decides",
  );
});

test("Tooling - Dev reload - diffBuilds reports new, changed and removed files", () => {
  const previous = new Map([
    ["a.js", "1"],
    ["b.js", "1"],
    ["gone.js", "1"],
  ]);
  const next = new Map([
    ["a.js", "1"],
    ["b.js", "2"],
    ["new.js", "1"],
  ]);
  assert.deepEqual(diffBuilds(previous, next), ["b.js", "gone.js", "new.js"]);
  assert.deepEqual(diffBuilds(next, next), []);
});
