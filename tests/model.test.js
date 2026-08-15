// Pure tests for sidepanel/model.js — no DOM, no chrome stub, bare node.
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  badges,
  bulkSummary,
  countsByFilter,
  emptyMessage,
  groupHeader,
  rowViewModel,
  selectVisible,
  windowColor,
  windowMaps,
} from "../sidepanel/model.js";

const NOW = 1_700_000_000_000;
const HOUR = 3_600_000;
const tab = (overrides = {}) => ({
  id: 1, windowId: 1, active: false, discarded: false, pinned: false, audible: false,
  url: "https://example.com/x", title: "Example", lastAccessed: NOW - 2 * HOUR,
  ...overrides,
});
const view = (overrides = {}) => ({
  query: "", scope: "all-windows", filter: "all", sort: "recent",
  currentWindowId: 1, rules: [], now: NOW,
  ...overrides,
});

test("Model - SelectVisible combines search, scope, filter, and sort", () => {
  const tabs = [
    tab({ id: 1, title: "Alpha", lastAccessed: NOW - 1 * HOUR }),
    tab({ id: 2, title: "Beta", discarded: true, lastAccessed: NOW - 2 * HOUR }),
    tab({ id: 3, title: "Gamma", windowId: 2, lastAccessed: NOW - 3 * HOUR }),
  ];
  assert.deepEqual(selectVisible(tabs, view()).map((t) => t.id), [1, 2, 3], "recent");
  assert.deepEqual(selectVisible(tabs, view({ sort: "oldest" })).map((t) => t.id), [3, 2, 1]);
  assert.deepEqual(selectVisible(tabs, view({ filter: "snoozed" })).map((t) => t.id), [2]);
  assert.deepEqual(selectVisible(tabs, view({ scope: "current-window" })).map((t) => t.id), [1, 2]);
  assert.deepEqual(selectVisible(tabs, view({ query: "gam" })).map((t) => t.id), [3]);
  // window sort: current window (1) first, recent-first within
  assert.deepEqual(selectVisible(tabs, view({ sort: "window" })).map((t) => t.id), [1, 2, 3]);
  assert.deepEqual(
    selectVisible(tabs, view({ sort: "window", currentWindowId: 2 })).map((t) => t.id),
    [3, 1, 2],
    "window 2 current → its tabs first",
  );
});

test("Model - WindowMaps indexes current window as #1 and colors only when multi-window", () => {
  const single = windowMaps([tab()], 1);
  assert.equal(single.indexes.get(1), 1);
  assert.equal(single.dotColors.size, 0, "no dots for single window");

  const multi = windowMaps([tab({ windowId: 5 }), tab({ windowId: 2 }), tab({ windowId: 9 })], 5);
  assert.equal(multi.indexes.get(5), 1, "current = #1");
  assert.equal(multi.indexes.get(2), 2);
  assert.equal(multi.indexes.get(9), 3);
  assert.equal(multi.dotColors.get(5), "", "current marked with empty color (accent via CSS)");
  assert.ok(multi.dotColors.get(2).startsWith("#"));
});

test("Model - WindowColor: palette first, unique golden-angle hues beyond", () => {
  assert.ok(windowColor(0).startsWith("#"));
  assert.ok(windowColor(8).startsWith("hsl("), "9th color is procedural");
  const fifty = new Set(Array.from({ length: 50 }, (_, i) => windowColor(i)));
  assert.equal(fifty.size, 50, "no repeats");
});

test("Model - GroupHeader formats current and other windows", () => {
  const tabs = [tab({ id: 1 }), tab({ id: 2 }), tab({ id: 3, windowId: 2 })];
  const { indexes } = windowMaps(tabs, 1);
  const ctx = { visible: tabs.slice(0, 1), tabs, currentWindowId: 1, indexes };
  assert.equal(groupHeader(1, ctx), "Window Current #1 - 1/2");
  assert.equal(groupHeader(2, { ...ctx, visible: tabs }), "Window #2 - 1/1");
});

test("Model - EmptyMessage picks the right hint", () => {
  assert.match(emptyMessage("xyz", "all"), /No tabs match/);
  assert.match(emptyMessage("", "snoozed"), /Nothing snoozed/);
  assert.match(emptyMessage("", "protected"), /No protected tabs/);
  assert.equal(emptyMessage("", "all"), "No open tabs.");
});

test("Model - RowViewModel maps tab state to plain data", () => {
  const rules = [{ id: "r", type: "host", pattern: "example.com" }];
  const ctx = {
    index: 0, cursor: 0, now: NOW, currentWindowId: 1, rules,
    selected: new Set([1]), ...windowMaps([tab(), tab({ id: 2, windowId: 2 })], 1),
    dotColors: windowMaps([tab(), tab({ id: 2, windowId: 2 })], 1).dotColors,
    indexes: windowMaps([tab(), tab({ id: 2, windowId: 2 })], 1).indexes,
  };
  const vm = rowViewModel(tab({ active: true }), ctx);
  assert.deepEqual(vm.classes, ["row", "cursor", "active-tab", "current"]);
  assert.equal(vm.checked, true);
  assert.equal(vm.viewTransitionName, "tab-1");
  assert.equal(vm.protectLabel, "Unprotect site");
  assert.equal(vm.age, null, "active tab shows no age");
  assert.equal(vm.dot.title, "Current window");

  const snoozed = rowViewModel(tab({ id: 3, discarded: true, title: "Zzz" }), { ...ctx, cursor: -1, selected: new Set() });
  assert.ok(snoozed.title.startsWith("⏸ "));
  assert.equal(snoozed.canSnooze, false);
  assert.deepEqual(snoozed.badges[0], ["snoozed", "warn"]);

  const internal = rowViewModel(tab({ id: 4, url: "chrome://settings" }), { ...ctx, cursor: -1 });
  assert.equal(internal.favicon.letter, "S", "first letter of chrome page hostname");
  assert.equal(internal.canSnooze, false);
  const hostless = rowViewModel(tab({ id: 5, url: "about:blank" }), { ...ctx, cursor: -1 });
  assert.equal(hostless.favicon.letter, "•", "no hostname → bullet fallback");
});

test("Model - Badges order and kinds", () => {
  const rules = [{ id: "r", type: "host", pattern: "example.com" }];
  const full = badges(tab({ discarded: true, pinned: true, audible: true }), rules);
  assert.deepEqual(full, [["snoozed", "warn"], ["protected", "ok"], ["pinned", ""], ["🔊", ""]]);
  assert.deepEqual(badges(tab(), []), []);
});

test("Model - CountsByFilter", () => {
  const rules = [{ id: "r", type: "host", pattern: "example.com" }];
  const tabs = [tab(), tab({ id: 2, discarded: true }), tab({ id: 3, url: "https://other.io/" })];
  assert.deepEqual(countsByFilter(tabs, rules), { all: 3, awake: 2, snoozed: 1, protected: 2 });
});

test("Model - BulkSummary states: none, partial, all selected", () => {
  const tabs = [tab(), tab({ id: 2 })];
  assert.deepEqual(bulkSummary(tabs, new Set()), {
    hidden: true, text: "0 selected", allChecked: false, indeterminate: false,
    selectAllTitle: "Select all 2 shown",
  });
  const partial = bulkSummary(tabs, new Set([1]));
  assert.equal(partial.indeterminate, true);
  assert.equal(partial.allChecked, false);
  const all = bulkSummary(tabs, new Set([1, 2]));
  assert.equal(all.allChecked, true);
  assert.equal(all.selectAllTitle, "Unselect all");
});
