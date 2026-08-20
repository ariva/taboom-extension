// Pure tests for sidepanel/model.js — no DOM, no chrome stub, bare node.
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  badges,
  bulkSummary,
  countsByFilter,
  deriveTabs,
  emptyMessage,
  groupByWindow,
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
// derived defaults to no protection rules; pass rules when a test needs them
const view = (tabs, overrides = {}, rules = []) => ({
  query: "", scope: "all-windows", filter: "all", sort: "recent",
  currentWindowId: 1, derived: deriveTabs(tabs, rules), now: NOW,
  ...overrides,
});

test("Model - SelectVisible combines search, scope, filter, and sort", () => {
  const tabs = [
    tab({ id: 1, title: "Alpha", lastAccessed: NOW - 1 * HOUR }),
    tab({ id: 2, title: "Beta", discarded: true, lastAccessed: NOW - 2 * HOUR }),
    tab({ id: 3, title: "Gamma", windowId: 2, lastAccessed: NOW - 3 * HOUR }),
  ];
  assert.deepEqual(selectVisible(tabs, view(tabs)).map((t) => t.id), [1, 2, 3], "recent");
  assert.deepEqual(selectVisible(tabs, view(tabs, { sort: "oldest" })).map((t) => t.id), [3, 2, 1]);
  assert.deepEqual(selectVisible(tabs, view(tabs, { filter: "snoozed" })).map((t) => t.id), [2]);
  assert.deepEqual(selectVisible(tabs, view(tabs, { scope: "current-window" })).map((t) => t.id), [1, 2]);
  assert.deepEqual(selectVisible(tabs, view(tabs, { query: "gam" })).map((t) => t.id), [3]);
  // window sort: current window (1) first, recent-first within
  assert.deepEqual(selectVisible(tabs, view(tabs, { sort: "window" })).map((t) => t.id), [1, 2, 3]);
  assert.deepEqual(
    selectVisible(tabs, view(tabs, { sort: "window", currentWindowId: 2 })).map((t) => t.id),
    [3, 1, 2],
    "window 2 current → its tabs first",
  );
});

test("Model - DeriveTabs precomputes host, lowercase haystack, protected flag", () => {
  const rules = [{ id: "r", type: "host", pattern: "example.com" }];
  const derived = deriveTabs([tab({ title: "Example PAGE" }), tab({ id: 2, url: "https://other.io/" })], rules);
  assert.equal(derived.get(1).host, "example.com");
  assert.ok(derived.get(1).haystack.includes("example page"), "haystack lowercased");
  assert.equal(derived.get(1).protected, true);
  assert.equal(derived.get(2).protected, false);
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

test("Model - GroupHeader formats current and other windows, collapse indicator", () => {
  const tabs = [tab({ id: 1 }), tab({ id: 2 }), tab({ id: 3, windowId: 2 })];
  const { indexes } = windowMaps(tabs, 1);
  const ctx = { count: 1, total: 2, currentWindowId: 1, indexes };
  // arrow is rendered by the view (right-aligned span), not part of the text
  assert.equal(groupHeader(1, ctx), "Window Current #1 - 1/2");
  assert.equal(groupHeader(2, { ...ctx, total: 1 }), "Window #2 - 1/1");
});

test("Model - GroupByWindow keeps order and splits runs", () => {
  const tabs = [tab({ id: 1 }), tab({ id: 2 }), tab({ id: 3, windowId: 2 }), tab({ id: 4, windowId: 2 })];
  const groups = groupByWindow(tabs);
  assert.deepEqual(groups.map(([id, list]) => [id, list.map((t) => t.id)]), [[1, [1, 2]], [2, [3, 4]]]);
  assert.deepEqual(groupByWindow([]), []);
});

test("Model - EmptyMessage picks the right hint", () => {
  assert.match(emptyMessage("xyz", "all"), /No tabs match/);
  assert.match(emptyMessage("", "snoozed"), /Nothing snoozed/);
  assert.match(emptyMessage("", "protected"), /No protected tabs/);
  assert.equal(emptyMessage("", "all"), "No open tabs.");
});

test("Model - RowViewModel maps tab state to plain data", () => {
  const rules = [{ id: "r", type: "host", pattern: "example.com" }];
  const rowTabs = [
    tab({ active: true }),
    tab({ id: 3, discarded: true, title: "Zzz" }),
    tab({ id: 4, url: "chrome://settings" }),
    tab({ id: 5, url: "about:blank" }),
  ];
  const ctx = {
    index: 0, cursor: 0, now: NOW, currentWindowId: 1, derived: deriveTabs(rowTabs, rules),
    selected: new Set([1]), ...windowMaps([tab(), tab({ id: 2, windowId: 2 })], 1),
    dotColors: windowMaps([tab(), tab({ id: 2, windowId: 2 })], 1).dotColors,
    indexes: windowMaps([tab(), tab({ id: 2, windowId: 2 })], 1).indexes,
  };
  const vm = rowViewModel(tab({ active: true }), ctx);
  assert.deepEqual(vm.classes, ["row", "cursor", "active-tab", "current"]);
  assert.equal(vm.checked, true);
  assert.equal(vm.viewTransitionName, "tab-1");
  assert.equal(vm.protectLabel, "Unprotect site");
  assert.equal(vm.protected, true, "protected flag drives the shield-off icon");
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
  const full = badges(tab({ discarded: true, pinned: true, audible: true }), true);
  assert.deepEqual(full, [["snoozed", "warn"], ["protected", "ok"], ["pinned", ""], ["🔊", ""]]);
  assert.deepEqual(badges(tab(), false), []);
});

test("Model - CountsByFilter", () => {
  const rules = [{ id: "r", type: "host", pattern: "example.com" }];
  const tabs = [tab(), tab({ id: 2, discarded: true }), tab({ id: 3, url: "https://other.io/" })];
  assert.deepEqual(countsByFilter(tabs, deriveTabs(tabs, rules)), { all: 3, awake: 2, snoozed: 1, protected: 2 });
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

// ---------- options/model.js ----------
const { aboutText, clampFontSize, clampedNumber, hasRule, releaseNotes, releaseSections } =
  await import("../options/model.js");

test("Model - Options - Clamps, rule lookup, about text", () => {
  assert.equal(clampFontSize("9"), 1.5, "max");
  assert.equal(clampFontSize("0.1"), 0.6, "min");
  assert.equal(clampFontSize("1.2"), 1.2);
  assert.equal(clampFontSize("garbage"), 1, "fallback then clamp");
  assert.equal(clampedNumber("50", 1), 50);
  assert.equal(clampedNumber("-3", 1), 1, "floor");
  assert.equal(clampedNumber("", 5), 5, "empty → floor");
  assert.equal(hasRule([{ pattern: "*.a.com" }], "*.a.com"), true);
  assert.equal(hasRule([{ pattern: "*.a.com" }], "a.com"), false);
  assert.equal(aboutText("1.2.3"), "Taboom 1.2.3");
});

test("Model - Options - ReleaseNotes picks version section, falls back to newest", () => {
  const md = "# CHANGES\n\n## v0.2.7 — 2026-08-16\n\n- new stuff\n\n## v0.2.6 — 2026-08-15\n\n- old stuff\n";
  assert.deepEqual(releaseNotes(md, "0.2.6"), { title: "v0.2.6 — 2026-08-15", body: "- old stuff" });
  assert.deepEqual(releaseNotes(md, "9.9.9"), { title: "v0.2.7 — 2026-08-16", body: "- new stuff" }, "fallback to newest");
  assert.equal(releaseNotes("no sections here", "1.0.0"), null);
});

test("Model - Options - ReleaseSections caps history, newest first, drops file header", () => {
  const md = "# CHANGES\n\n## v3 — a\n\n- c3\n\n## v2 — b\n\n- c2\n\n## v1 — c\n\n- c1\n";
  assert.deepEqual(releaseSections(md, 2), [
    { title: "v3 — a", body: "- c3" },
    { title: "v2 — b", body: "- c2" },
  ]);
  assert.equal(releaseSections(md).length, 3, "count beyond sections is fine");
  assert.deepEqual(releaseSections("no sections", 5), []);
});

// ---------- core resolveColorScheme ----------
const { resolveColorScheme } = await import("../core/core.js");

test("Model - ResolveColorScheme: explicit themes pass, anything else follows system", () => {
  assert.equal(resolveColorScheme("light"), "light");
  assert.equal(resolveColorScheme("dark"), "dark");
  assert.equal(resolveColorScheme("auto"), "");
  assert.equal(resolveColorScheme(undefined), "");
});

test("Model - Options - PerfLines formats metrics readably", async () => {
  const { perfLines } = await import("../options/model.js");
  const lines = perfLines({ "sidepanel.render": { count: 3, avg: 12.34, min: 6, max: 20.5, last: 6 } });
  assert.equal(lines.length, 1);
  assert.match(lines[0], /^sidepanel\.render: count 3 · avg 12\.3ms · min 6\.0 · max 20\.5 · last 6\.0$/);
  assert.deepEqual(perfLines({}), []);
});

test("Model - Options - SnapshotBlocks: newest first, timestamp header, indented metrics", async () => {
  const { snapshotBlocks } = await import("../options/model.js");
  const metrics = { render: { count: 1, avg: 5, min: 5, max: 5, last: 5 } };
  const blocks = snapshotBlocks([
    { at: 1700000000000, metrics },
    { at: 1700000100000, metrics },
  ]);
  assert.equal(blocks.length, 2);
  assert.equal(blocks[0], `${new Date(1700000100000).toLocaleString()}\n  render: count 1 · avg 5.0ms · min 5.0 · max 5.0 · last 5.0`, "newest first");
  assert.deepEqual(snapshotBlocks([]), []);
});
