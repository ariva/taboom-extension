// Pure profile decisions used by the service worker (src/app/window-identity.ts).
import assert from "node:assert/strict";
import { test } from "vitest";
import { expireProfiles, windowsToRestore } from "../../src/app/window-identity.ts";

const DAY = 24 * 3_600_000;

test("Core - ExpireProfiles: drops profiles older than the TTL, keeps fresh ones in order", () => {
  const now = 100 * DAY;
  const kept = expireProfiles(
    { old: { updatedAt: now - 15 * DAY }, edge: { updatedAt: now - 14 * DAY }, fresh: { updatedAt: now }, undated: {} },
    now,
    14 * DAY,
  );
  assert.deepEqual(Object.keys(kept), ["edge", "fresh"]);
});

test("Core - ExpireProfiles: named, colored or pinned windows are exempt from the sweep", () => {
  const stale = { updatedAt: 0 };
  const kept = expireProfiles(
    {
      named: { ...stale, name: "Work" },
      colored: { ...stale, color: "#f00" },
      pinned: { ...stale, pinnedWindow: true },
      plain: stale,
    },
    100 * DAY,
    14 * DAY,
  );
  assert.deepEqual(Object.keys(kept), ["named", "colored", "pinned"]);
});

test("Core - WindowsToRestore: panelOpen windows minus the asker and the live ports", () => {
  const sessionMap = { 1: "w-a", 2: "w-b", 3: "w-c", 4: "w-d", 5: "w-gone" };
  const profiles = {
    "w-a": { panelOpen: true },
    "w-b": { panelOpen: true },
    "w-c": { panelOpen: true },
    "w-d": { panelOpen: false },
  };
  assert.deepEqual(windowsToRestore(sessionMap, profiles, 1, new Set([2])), [3]);
  assert.deepEqual(windowsToRestore({}, profiles, 1, new Set()), []);
});
