import assert from "node:assert/strict";
import { test } from "vitest";
import type { WindowMaps } from "../../../../src/pages/sidepanel/model/index.ts";
import { orderWindowIds } from "../../../../src/pages/sidepanel/model/window-order.ts";

// windows in strip order #1..#n; names = custom window names
const maps = (ids: number[], names: Record<number, string> = {}): WindowMaps => ({
  indexes: new Map(ids.map((id, at) => [id, at + 1])),
  dotColors: new Map(),
  names: new Map(Object.entries(names).map(([id, name]) => [Number(id), { name }])),
});

test("UI - Sidepanel - Window order - Current window first, wherever it sorts by name", () => {
  assert.deepEqual(orderWindowIds(maps([10, 20, 30], { 30: "Zulu" }), 30, new Set()), [30, 10, 20]);
  assert.deepEqual(orderWindowIds(maps([10, 20, 30]), 20, new Set([30])), [20, 30, 10], "ahead of pinned windows too");
});

test("UI - Sidepanel - Window order - Pinned windows next, the rest ABC by display name", () => {
  const named = maps([10, 20, 30, 40], { 10: "delta", 20: "Bravo", 30: "alpha", 40: "Charlie" });
  assert.deepEqual(orderWindowIds(named, null, new Set()), [30, 20, 40, 10], "case-insensitive");
  assert.deepEqual(orderWindowIds(named, null, new Set([10, 40])), [40, 10, 30, 20], "pinned block is ABC as well");
});

test("UI - Sidepanel - Window order - Default labels compare numerically (#10 after #9)", () => {
  const ids = Array.from({ length: 11 }, (_, at) => 100 - at); // window 100 is #1 … window 90 is #11
  assert.deepEqual(orderWindowIds(maps(ids), null, new Set()), ids);
});

test("UI - Sidepanel - Window order - No current window yet (null) ranks nobody first", () => {
  assert.deepEqual(orderWindowIds(maps([10, 20], { 10: "b", 20: "a" }), null, new Set()), [20, 10]);
});
