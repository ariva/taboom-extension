import assert from "node:assert/strict";
import { test } from "vitest";
import { dropSpecFor, reorderedGroupTitles } from "../../../../src/pages/sidepanel/dnd/dnd-model.ts";
import type { DropFlags, DropTab, DropTargetInfo } from "../../../../src/pages/sidepanel/dnd/dnd-model.ts";

const tab = (id: number, windowId: number, index: number, groupId = -1): DropTab => ({ id, windowId, index, groupId });
const over = (info: Partial<DropTargetInfo>): DropTargetInfo => ({
  targetTab: null,
  tabGroupHeaderId: null,
  headerWindowId: null,
  ...info,
});
const flags = (on: Partial<DropFlags> = {}): DropFlags => ({
  tabGroups: false,
  reorder: false,
  tabGroupSort: false,
  ...on,
});

test("UI - Sidepanel - Drop spec - No dragged tab, or nothing droppable under the pointer, is no drop", () => {
  assert.equal(dropSpecFor(undefined, over({ targetTab: tab(2, 20, 0) }), flags()), null);
  assert.equal(dropSpecFor(tab(1, 10, 0), over({}), flags({ tabGroups: true, reorder: true })), null);
});

test("UI - Sidepanel - Drop spec - Another window's row takes the drop at that row's strip position", () => {
  assert.deepEqual(dropSpecFor(tab(1, 10, 0), over({ targetTab: tab(2, 20, 7) }), flags()), { windowId: 20, index: 7 });
});

test("UI - Sidepanel - Drop spec - Another window's header appends at the end", () => {
  assert.deepEqual(dropSpecFor(tab(1, 10, 0), over({ headerWindowId: 20 }), flags()), { windowId: 20, index: -1 });
});

test("UI - Sidepanel - Drop spec - Same window needs the reorder gesture and another row", () => {
  const source = tab(1, 10, 0);
  assert.equal(dropSpecFor(source, over({ targetTab: tab(2, 10, 3) }), flags()), null, "reorder off");
  assert.equal(dropSpecFor(source, over({ headerWindowId: 10 }), flags({ reorder: true })), null, "own header");
  assert.equal(dropSpecFor(source, over({ targetTab: source }), flags({ reorder: true })), null, "onto itself");
  assert.deepEqual(dropSpecFor(source, over({ targetTab: tab(2, 10, 3) }), flags({ reorder: true })), {
    windowId: 10,
    index: 3,
    regroupId: null,
  });
});

test("UI - Sidepanel - Drop spec - Tab-group headers and foreign group rows are ignored while tab groups are off", () => {
  const spec = dropSpecFor(tab(1, 10, 0), over({ targetTab: tab(2, 20, 4, 5), tabGroupHeaderId: 5 }), flags());
  assert.deepEqual(spec, { windowId: 20, index: 4 });
});

test("UI - Sidepanel - Drop spec - A tab-group header joins that group, the No group header (-1) leaves it", () => {
  const on = flags({ tabGroups: true });
  assert.deepEqual(dropSpecFor(tab(1, 10, 0), over({ tabGroupHeaderId: 5 }), on), { tabGroupId: 5 });
  assert.deepEqual(dropSpecFor(tab(1, 10, 0, 5), over({ tabGroupHeaderId: -1 }), on), { tabGroupId: -1 });
  // the header wins over the row it may sit in
  assert.deepEqual(dropSpecFor(tab(1, 10, 0), over({ targetTab: tab(2, 20, 4), tabGroupHeaderId: 5 }), on), {
    tabGroupId: 5,
  });
});

test("UI - Sidepanel - Drop spec - A row of a group the dragged tab is not in joins that group", () => {
  const on = flags({ tabGroups: true });
  assert.deepEqual(dropSpecFor(tab(1, 10, 0), over({ targetTab: tab(2, 20, 4, 5) }), on), { tabGroupId: 5 });
  assert.deepEqual(dropSpecFor(tab(1, 10, 0, 6), over({ targetTab: tab(2, 10, 4, 5) }), on), { tabGroupId: 5 });
  // an ungrouped target row is a plain window move
  assert.deepEqual(dropSpecFor(tab(1, 10, 0, 6), over({ targetTab: tab(2, 20, 4) }), on), { windowId: 20, index: 4 });
});

test("UI - Sidepanel - Drop spec - Reorder inside a group keeps the membership (regroupId)", () => {
  const source = tab(1, 10, 0, 5);
  const target = over({ targetTab: tab(2, 10, 3, 5) });
  const moved = { windowId: 10, index: 3, regroupId: 5 };
  assert.deepEqual(dropSpecFor(source, target, flags({ tabGroups: true, reorder: true })), moved);
  assert.deepEqual(
    dropSpecFor(source, target, flags({ tabGroups: true, tabGroupSort: true })),
    moved,
    "Tab groups sort",
  );
  assert.equal(dropSpecFor(source, target, flags({ tabGroups: true })), null, "neither strip-ordered view");
  assert.equal(dropSpecFor(source, over({ targetTab: source }), flags({ tabGroups: true, tabGroupSort: true })), null);
  // tab groups off, reorder on: the same-window branch still restores the group
  assert.deepEqual(dropSpecFor(source, target, flags({ reorder: true })), moved);
});

test("UI - Sidepanel - Drop spec - A missing strip index falls back to -1 (append)", () => {
  const target: DropTab = { id: 2, windowId: 20 };
  assert.deepEqual(dropSpecFor(tab(1, 10, 0), over({ targetTab: target }), flags()), { windowId: 20, index: -1 });
});

const groups = new Map([
  [1, { title: "Work" }],
  [2, { title: "Mail" }],
  [3, { title: "Docs" }],
]);

test("UI - Sidepanel - Group reorder - Dragged down lands after the target, dragged up before it", () => {
  assert.deepEqual(reorderedGroupTitles([1, 2, 3], 1, 3, groups, []), ["Mail", "Docs", "Work"]);
  assert.deepEqual(reorderedGroupTitles([1, 2, 3], 1, 2, groups, []), ["Mail", "Work", "Docs"]);
  assert.deepEqual(reorderedGroupTitles([1, 2, 3], 3, 1, groups, []), ["Docs", "Work", "Mail"]);
  assert.deepEqual(reorderedGroupTitles([1, 2, 3], 3, 2, groups, []), ["Work", "Docs", "Mail"]);
});

test("UI - Sidepanel - Group reorder - The input list is not mutated", () => {
  const ids = [1, 2, 3];
  reorderedGroupTitles(ids, 1, 3, groups, []);
  assert.deepEqual(ids, [1, 2, 3]);
});

test("UI - Sidepanel - Group reorder - Saved titles of groups not open keep a slot at the end", () => {
  assert.deepEqual(reorderedGroupTitles([1, 2], 2, 1, groups, ["Closed A", "Work", "Closed B", "Mail"]), [
    "Mail",
    "Work",
    "Closed A",
    "Closed B",
  ]);
});

test("UI - Sidepanel - Group reorder - Same-titled and unknown groups collapse to one slot each", () => {
  const twins = new Map([
    [1, { title: "Work" }],
    [2, { title: "Work" }],
    [3, {}],
  ]);
  // 9 is not an open group: it reads as the unnamed title, like 3
  assert.deepEqual(reorderedGroupTitles([1, 2, 3, 9], 3, 1, twins, [""]), ["", "Work"]);
});
