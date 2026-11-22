import assert from "node:assert/strict";
import { test } from "vitest";
import {
  EVERYTHING_ELSE,
  everythingElse,
  everythingElseText,
  highlightText,
  RELEASE_HIGHLIGHTS,
  releaseHighlights,
} from "../../src/app/release-highlights.ts";

// also the guard for "earlier entries stay": a later release must not drop or reword this one
test("Release highlights - a release's lines come back in their written order", () => {
  assert.deepEqual(releaseHighlights("1.1.0"), [
    "Name a tab yourself",
    "Temporary protection or keep-alive",
    "Keep alive by domain",
    "Reorder lists in Settings",
    "Tagged pages keep their #fragment",
    "Row menus from the keyboard",
    "Settings in tabs",
  ]);
});

test("Release highlights - a release with no array has no lines (releases before 1.1.0, a fixes-only one)", () => {
  assert.deepEqual(releaseHighlights("1.0.9"), []);
  assert.deepEqual(releaseHighlights("0.0.0-test"), []);
});

test("Release highlights - a line is named by its key; an unknown key or release is an error, not an empty line", () => {
  assert.equal(highlightText("1.1.0", "keyboard-menu"), "Row menus from the keyboard");
  assert.throws(() => highlightText("1.1.0", "no-such-line"), /1\.1\.0.*no-such-line/);
  assert.throws(() => highlightText("9.9.9", "keyboard-menu"), /9\.9\.9/);
});

test("Release highlights - keys are unique slugs per release and every line is short enough for a list", () => {
  for (const [version, lines] of Object.entries(RELEASE_HIGHLIGHTS)) {
    assert.match(version, /^\d+\.\d+\.\d+$/);
    const keys = lines.map((line) => line.key);
    assert.equal(new Set(keys).size, keys.length, `${version}: duplicate key`);
    for (const line of lines) {
      assert.match(line.key, /^[a-z0-9]+(-[a-z0-9]+)*$/, `${version}: ${line.key}`);
      assert.ok(line.text.length > 0 && line.text.length <= 36, `${version}: "${line.text}"`);
    }
  }
});

test("Release highlights - everything else: the features from before the newest release, in their written order", () => {
  assert.deepEqual(everythingElse(), [
    "Open panels share one view",
    "Snooze inactive tabs now",
    "Custom tags",
    "Park a window, restore it later",
    "Every window, every tab, one panel",
    "Search and filters",
    "Windows: names, colors, pins",
    "Sort, group, move tabs",
    "Snooze, protect, bulk actions",
    "Duplicates",
    "Settings",
  ]);
});

test("Release highlights - everything else: a line is named by its key, an unknown key is an error", () => {
  assert.equal(everythingElseText("search-filters"), "Search and filters");
  assert.throws(() => everythingElseText("no-such-line"), /no-such-line/);
});

test("Release highlights - everything else: unique slug keys, lines short enough for a list", () => {
  const keys = EVERYTHING_ELSE.map((line) => line.key);
  assert.equal(new Set(keys).size, keys.length, "duplicate key");
  for (const line of EVERYTHING_ELSE) {
    assert.match(line.key, /^[a-z0-9]+(-[a-z0-9]+)*$/, line.key);
    assert.ok(line.text.length > 0 && line.text.length <= 36, `"${line.text}"`);
  }
});
