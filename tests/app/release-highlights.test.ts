import assert from "node:assert/strict";
import { test } from "vitest";
import {
  EVERYTHING_ELSE,
  featureRelease,
  VISIBLE_HIGHLIGHTS_RELEASES,
  visibleHighlights,
  everythingElse,
  everythingElseText,
  highlightText,
  RELEASE_HIGHLIGHTS,
  releaseHighlights,
} from "../../src/app/release-highlights.ts";

// The tests read the arrays, never a line's wording: lines get reworded, added and dropped at
// every release, and none of that is a failure.
const withLines = Object.keys(RELEASE_HIGHLIGHTS).find((release) => (RELEASE_HIGHLIGHTS[release]?.length ?? 0) > 0);

test("Release highlights - a release's lines come back in their written order", () => {
  assert.ok(withLines !== undefined, "at least one release has lines");
  for (const [version, lines] of Object.entries(RELEASE_HIGHLIGHTS)) {
    assert.deepEqual(
      releaseHighlights(version),
      lines.map((line) => line.text),
    );
  }
});

test("Release highlights - a release with no array has no lines (releases before 1.1.0, a fixes-only one)", () => {
  assert.deepEqual(releaseHighlights("1.0.9"), []);
  assert.deepEqual(releaseHighlights("0.0.0-test"), []);
});

test("Release highlights - a line is named by its key; an unknown key or release is an error, not an empty line", () => {
  const version = withLines ?? "";
  const [line] = RELEASE_HIGHLIGHTS[version] ?? [];
  assert.equal(highlightText(version, line?.key ?? ""), line?.text);
  assert.throws(
    () => highlightText(version, "no-such-line"),
    new RegExp(`${version.replaceAll(".", "\\.")}.*no-such-line`),
  );
  assert.throws(() => highlightText("9.9.9", line?.key ?? ""), /9\.9\.9/);
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

test("Release highlights - everything else: the lines in their written order", () => {
  assert.ok(EVERYTHING_ELSE.length > 0);
  assert.deepEqual(
    everythingElse(),
    EVERYTHING_ELSE.map((line) => line.text),
  );
});

test("Release highlights - everything else: a line is named by its key, an unknown key is an error", () => {
  const [line] = EVERYTHING_ELSE;
  assert.equal(everythingElseText(line?.key ?? ""), line?.text);
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

test("Release highlights - the release the film presents: itself when it has lines, else the newest that has", () => {
  assert.equal(featureRelease(withLines ?? ""), withLines);
  const newest = Object.keys(RELEASE_HIGHLIGHTS).find((release) => (RELEASE_HIGHLIGHTS[release]?.length ?? 0) > 0);
  assert.equal(featureRelease("99.0.0"), newest, "a fixes-only release: the last one with features");
});

test("Release highlights - Settings shows the releases VISIBLE_HIGHLIGHTS_RELEASES names, in its order, with their lines", () => {
  for (const version of VISIBLE_HIGHLIGHTS_RELEASES) {
    assert.ok(version in RELEASE_HIGHLIGHTS, `${version} is not in RELEASE_HIGHLIGHTS`);
  }
  const shown = visibleHighlights();
  assert.deepEqual(
    shown.map((release) => release.version),
    VISIBLE_HIGHLIGHTS_RELEASES.filter((version) => releaseHighlights(version).length > 0),
  );
  for (const release of shown) {
    assert.deepEqual(release.lines, releaseHighlights(release.version));
  }
  assert.deepEqual(
    visibleHighlights(["0.0.1", withLines ?? ""]).map((release) => release.version),
    [withLines],
    "nothing to list: dropped",
  );
});
