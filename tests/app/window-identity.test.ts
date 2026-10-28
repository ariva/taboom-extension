// Pure tests for core/window-identity.js — no DOM, no chrome stub.
import assert from "node:assert/strict";
import { test } from "vitest";
import type { FingerprintTab } from "../../src/app/types.ts";
import {
  assignLogicalIds,
  buildFingerprint,
  hashKey,
  matchProfiles,
  scoreMatch,
  urlKey,
} from "../../src/app/window-identity.ts";

const tab = (url: string, pinned = false): FingerprintTab => ({ url, pinned });

test("Identity - urlKey normalizes to origin+path, dropping query and fragment", () => {
  assert.equal(urlKey("https://Ex.com/A/b?q=1#frag"), "https://ex.com/A/b".toLocaleLowerCase());
  assert.equal(urlKey("https://ex.com/a/b"), urlKey("https://ex.com/a/b?utm=x#y"), "volatile parts ignored");
  assert.notEqual(urlKey("https://ex.com/a"), urlKey("https://ex.com/b"), "paths distinguish");
  assert.equal(urlKey("not a url"), "not a url", "unparsable input passes through");
});

test("Identity - fingerprint is order-insensitive and separates pinned tabs", () => {
  const a = buildFingerprint([tab("https://a.dev/", true), tab("https://b.dev/"), tab("https://c.dev/")], null, 1);
  const b = buildFingerprint([tab("https://c.dev/"), tab("https://b.dev/"), tab("https://a.dev/", true)], null, 1);
  assert.deepEqual(a, b, "rearranged tabs → identical fingerprint");
  assert.deepEqual(a.pinned, [hashKey(urlKey("https://a.dev/"))], "pinned tracked separately");
  assert.equal(a.tabCount, 3);
});

test("Identity - scoreMatch: pinned overlap dominates, empty sets carry no signal", () => {
  const pinnedMatch = scoreMatch(
    buildFingerprint([tab("https://a.dev/", true), tab("https://x.dev/")], null, 1),
    buildFingerprint([tab("https://a.dev/", true), tab("https://y.dev/")], null, 1),
  );
  const urlOnlyMatch = scoreMatch(
    buildFingerprint([tab("https://a.dev/"), tab("https://x.dev/")], null, 1),
    buildFingerprint([tab("https://a.dev/"), tab("https://y.dev/")], null, 1),
  );
  assert.ok(pinnedMatch > urlOnlyMatch, "same pinned tab outweighs same plain tab");
  const bothEmpty = scoreMatch(buildFingerprint([], null, 1), buildFingerprint([], null, 1));
  assert.ok(bothEmpty <= 0.75, "two empty windows are not a confident match");
});

test("Identity - matchProfiles recovers ids after a restart with new chrome ids", () => {
  const work = [tab("https://jira.dev/board", true), tab("https://github.com/pr/1"), tab("https://ci.dev/run")];
  const play = [tab("https://youtube.com/w", true), tab("https://reddit.com/r/x")];
  const profiles = {
    "w-work": { ...buildFingerprint(work, null, 1), chromeWindowId: 101 },
    "w-play": { ...buildFingerprint(play, null, 1), chromeWindowId: 102 },
  };
  // after restart: new chrome ids, one navigation happened in the work window
  const workNow = [work[0]!, work[1]!, tab("https://ci.dev/run2")];
  const assigned = matchProfiles(profiles, [
    [7, buildFingerprint(play, null, 2)],
    [8, buildFingerprint(workNow, null, 2)],
  ]);
  assert.equal(assigned.get(7), "w-play");
  assert.equal(assigned.get(8), "w-work");
});

test("Identity - matchProfiles: unrelated window stays unmatched, one profile assigned once", () => {
  const profiles = { "w-1": buildFingerprint([tab("https://a.dev/", true)], null, 1) };
  const assigned = matchProfiles(profiles, [
    [5, buildFingerprint([tab("https://a.dev/", true)], null, 2)],
    [6, buildFingerprint([tab("https://unrelated.dev/")], null, 2)],
  ]);
  assert.equal(assigned.get(5), "w-1", "best candidate wins the profile");
  assert.equal(assigned.has(6), false, "unrelated window gets no stored id");
});

test("Identity - assignLogicalIds recovers per window: a window arriving late into a half-filled map still finds its profile", () => {
  const work = [tab("https://jira.dev/board", true), tab("https://github.com/pr/1")];
  const play = [tab("https://youtube.com/w", true), tab("https://reddit.com/r/x")];
  const profiles = {
    "w-work": { ...buildFingerprint(work, null, 1), chromeWindowId: 101, name: "Work" },
    "w-play": { ...buildFingerprint(play, null, 1), chromeWindowId: 102, name: "Play" },
  };
  let minted = 0;
  const mint = () => `w-new-${++minted}`;
  // restart: session restore brings the first window alone; the map fills from an empty one
  const first = assignLogicalIds({}, profiles, [[7, buildFingerprint(work, null, 2)]], mint);
  assert.deepEqual(first, { 7: "w-work" });
  // the second window lands later: the map is no longer empty, its profile is still found
  const second = assignLogicalIds(
    first,
    profiles,
    [
      [7, buildFingerprint(work, null, 3)],
      [8, buildFingerprint(play, null, 3)],
    ],
    mint,
  );
  assert.deepEqual(second, { 7: "w-work", 8: "w-play" });
  assert.equal(minted, 0, "nothing minted");
  // a window nothing matches gets a fresh id; a closed window leaves the map; a held profile is not reused
  const third = assignLogicalIds(
    second,
    profiles,
    [
      [8, buildFingerprint(play, null, 4)],
      [9, buildFingerprint([tab("https://unrelated.dev/")], null, 4)],
      [10, buildFingerprint(work, null, 4)],
    ],
    mint,
  );
  assert.deepEqual(third, { 8: "w-play", 9: "w-new-1", 10: "w-work" }, "7 gone, w-work free again for 10");
});

test("Identity - matchProfiles prefers a named profile when two fit a window equally", () => {
  const content = [tab("https://a.dev/", true), tab("https://b.dev/")];
  const profiles = {
    "w-plain": { ...buildFingerprint(content, null, 1) },
    "w-named": { ...buildFingerprint(content, null, 1), name: "Research" },
  };
  const assigned = matchProfiles(profiles, [[5, buildFingerprint(content, null, 2)]]);
  assert.equal(assigned.get(5), "w-named", "a stranded named profile wins the tie over its unnamed twin");
});
