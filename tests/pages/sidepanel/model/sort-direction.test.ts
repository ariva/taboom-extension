import assert from "node:assert/strict";
import { test } from "vitest";
import { canonicalDir, DIR_TITLES, SORT_DIRECTIONS } from "../../../../src/pages/sidepanel/model/sort-direction.ts";

test("Sidepanel - Sort direction - canonicalDir is the first state of a sort", () => {
  assert.equal(canonicalDir("recent"), "desc");
  assert.equal(canonicalDir("oldest"), "asc");
  assert.equal(canonicalDir("title"), "asc");
  assert.equal(canonicalDir("window"), "none", "window grouping starts in its natural order");
  assert.equal(canonicalDir("group-domain"), "desc", "biggest groups first");
});

test("Sidepanel - Sort direction - An unknown sort falls back to ascending", () => {
  assert.equal(canonicalDir("group-tabgroup"), "asc");
  assert.equal(canonicalDir("no-such-sort"), "asc");
});

test("Sidepanel - Sort direction - Paired sorts point at each other and have a single state", () => {
  for (const [sort, meta] of Object.entries(SORT_DIRECTIONS)) {
    if (!meta.inverse) {
      continue;
    }
    assert.equal(meta.states.length, 1, `${sort} swaps the sort instead of cycling`);
    assert.equal(SORT_DIRECTIONS[meta.inverse]?.inverse, sort);
  }
});

test("Sidepanel - Sort direction - Every state has a button title and no sort repeats one", () => {
  for (const [sort, meta] of Object.entries(SORT_DIRECTIONS)) {
    assert.equal(new Set(meta.states).size, meta.states.length, sort);
    for (const dir of meta.states) {
      assert.ok(DIR_TITLES[dir], `${sort}: ${dir}`);
    }
  }
});
