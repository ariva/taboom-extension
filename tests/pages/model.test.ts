// Pure tests for sidepanel/model.js — no DOM, no chrome stub, bare node.
import assert from "node:assert/strict";
import { test } from "vitest";
import {
  badges,
  bulkSummary,
  fitTagPills,
  countsByFilter,
  deriveTabs,
  emptyMessage,
  groupTabs,
  titleGroupName,
  windowGroupName,
  rowViewModel,
  fuzzyScore,
  highlightRanges,
  searchCandidates,
  selectVisible,
  windowColor,
  windowMaps,
} from "../../src/pages/sidepanel/model/index.ts";
import type { Badge, RowContext, RowViewModel, SearchView, SelectView } from "../../src/pages/sidepanel/model/index.ts";
import type { ProtectionRule, Tag, TagPage, UiPrefs } from "../../src/app/types.ts";
import { tagGroupName } from "../../src/pages/sidepanel/model/index.ts";
import { nextTagSort, orderedTags, sortedTags } from "../../src/app/tags.ts";
import type { TagSort } from "../../src/app/types.ts";

type Tab = chrome.tabs.Tab;
type TabGroup = chrome.tabGroups.TabGroup;

const NOW = 1_700_000_000_000;
const HOUR = 3_600_000;
// chrome.tabs.Tab also requires index / groupId / highlighted / frozen / incognito / selected /
// autoDiscardable. The models read a missing index as 0 and a missing groupId as -1 and never
// read the rest, so these defaults keep every fixture's observable values unchanged.
const tab = (overrides: Partial<Tab> = {}): Tab => ({
  index: 0,
  groupId: -1,
  highlighted: false,
  frozen: false,
  incognito: false,
  selected: false,
  autoDiscardable: true,
  id: 1,
  windowId: 1,
  active: false,
  discarded: false,
  pinned: false,
  audible: false,
  url: "https://example.com/x",
  title: "Example",
  lastAccessed: NOW - 2 * HOUR,
  ...overrides,
});
// derived defaults to no protection rules; pass rules when a test needs them
// the tests' rules carry no createdAt (nothing in the models reads it)
const rule = (partial: Omit<ProtectionRule, "createdAt">): ProtectionRule => ({ createdAt: 0, ...partial });
// only a tab group's title is read by the models
const tabGroup = (partial: Partial<TabGroup>): TabGroup => ({
  id: 0,
  windowId: 1,
  collapsed: false,
  shared: false,
  color: "grey",
  ...partial,
});
// the favicon is { pageUrl } | { letter }: read .letter like the untyped test did (undefined on the other variant)
const letterOf = (favicon: RowViewModel["favicon"]): string | undefined =>
  "letter" in favicon ? favicon.letter : undefined;
const view = (tabs: Tab[], overrides: Partial<SelectView> = {}, rules: ProtectionRule[] = []): SelectView => ({
  query: "",
  scope: "all-windows",
  filter: "all",
  sort: "recent",
  currentWindowId: 1,
  derived: deriveTabs(tabs, rules),
  now: NOW,
  ...overrides,
});

test("Model - SelectVisible combines search, scope, filter, and sort", () => {
  const tabs = [
    tab({ id: 1, title: "Alpha", lastAccessed: NOW - 1 * HOUR }),
    tab({ id: 2, title: "Beta", discarded: true, lastAccessed: NOW - 2 * HOUR }),
    tab({ id: 3, title: "Gamma", windowId: 2, lastAccessed: NOW - 3 * HOUR }),
  ];
  assert.deepEqual(
    selectVisible(tabs, view(tabs)).map((t) => t.id),
    [1, 2, 3],
    "recent",
  );
  assert.deepEqual(
    selectVisible(tabs, view(tabs, { sort: "oldest" })).map((t) => t.id),
    [3, 2, 1],
  );
  assert.deepEqual(
    selectVisible(tabs, view(tabs, { filter: "snoozed" })).map((t) => t.id),
    [2],
  );
  assert.deepEqual(
    selectVisible(tabs, view(tabs, { scope: "current-window" })).map((t) => t.id),
    [1, 2],
  );
  assert.deepEqual(
    selectVisible(tabs, view(tabs, { query: "gam" })).map((t) => t.id),
    [3],
  );
  // window sort: current window (1) first, recent-first within
  assert.deepEqual(
    selectVisible(tabs, view(tabs, { sort: "window" })).map((t) => t.id),
    [1, 2, 3],
  );
  assert.deepEqual(
    selectVisible(tabs, view(tabs, { sort: "window", currentWindowId: 2 })).map((t) => t.id),
    [3, 1, 2],
    "window 2 current → its tabs first",
  );
});

test("Model - SortDir: flat sorts flip, grouped sorts order groups by visible size", () => {
  const tabs = [
    tab({ id: 1, title: "Alpha", lastAccessed: NOW - 1 * HOUR }),
    tab({ id: 2, title: "Beta", lastAccessed: NOW - 2 * HOUR }),
    tab({ id: 3, title: "Gamma", windowId: 2, lastAccessed: NOW - 3 * HOUR }),
  ];
  assert.deepEqual(
    selectVisible(tabs, view(tabs, { sort: "title", sortDir: "desc" })).map((t) => t.id),
    [3, 2, 1],
    "title Z..A",
  );
  // window 1 has 2 visible tabs, window 2 has 1
  assert.deepEqual(
    selectVisible(tabs, view(tabs, { sort: "window", sortDir: "desc" })).map((t) => t.id),
    [1, 2, 3],
    "most tabs first (window 1), recent-first within",
  );
  // two-list model: the current window stays first; size ordering applies
  // to the remaining windows (each band sorts internally)
  assert.deepEqual(
    selectVisible(tabs, view(tabs, { sort: "window", sortDir: "asc" })).map((t) => t.id),
    [1, 2, 3],
    "current window first, then fewest tabs first",
  );
  assert.deepEqual(
    selectVisible(tabs, view(tabs, { sort: "window" })).map((t) => t.id),
    [1, 2, 3],
    "no sortDir: natural order (current window first)",
  );
  const dupes = [tab({ id: 1, title: "Beta" }), tab({ id: 2, title: "Beta" }), tab({ id: 3, title: "Alpha" })];
  assert.deepEqual(
    selectVisible(dupes, view(dupes, { sort: "group-title", sortDir: "asc" })).map((t) => t.title),
    ["Alpha", "Beta", "Beta"],
    "group-title asc: smallest groups first",
  );
});

test("Model - DeriveTabs precomputes host, lowercase haystack, protected flag", () => {
  const rules = [rule({ id: "r", type: "host", pattern: "example.com" })];
  const derived = deriveTabs([tab({ title: "Example PAGE" }), tab({ id: 2, url: "https://other.io/" })], rules);
  assert.equal(derived.get(1)?.host, "example.com");
  assert.ok(derived.get(1)?.haystack.includes("example page"), "haystack lowercased");
  assert.equal(derived.get(1)?.protected, true);
  assert.equal(derived.get(2)?.protected, false);
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
  assert.ok(multi.dotColors.get(2)?.startsWith("#"));
});

test("Model - WindowColor: palette first, unique golden-angle hues beyond", () => {
  assert.ok(windowColor(0).startsWith("#"));
  assert.ok(windowColor(8).startsWith("hsl("), "9th color is procedural");
  const fifty = new Set(Array.from({ length: 50 }, (_, i) => windowColor(i)));
  assert.equal(fifty.size, 50, "no repeats");
});

test("Model - Group names: window label and title fallback (counts/arrow live in the view)", () => {
  const tabs = [tab({ id: 1 }), tab({ id: 2 }), tab({ id: 3, windowId: 2 })];
  const { indexes } = windowMaps(tabs, 1);
  assert.equal(windowGroupName(1, { currentWindowId: 1, indexes }), "Window Current #1");
  assert.equal(windowGroupName(2, { currentWindowId: 1, indexes }), "Window #2");
  assert.equal(titleGroupName("Some tab"), "Some tab");
  assert.equal(titleGroupName(""), "(untitled)");
});

test("Model - GroupTabs keeps order and splits runs by any key", () => {
  const tabs = [tab({ id: 1 }), tab({ id: 2 }), tab({ id: 3, windowId: 2 }), tab({ id: 4, windowId: 2 })];
  const byWindow = groupTabs(tabs, (t) => t.windowId);
  assert.deepEqual(
    byWindow.map(([id, list]) => [id, list.map((t) => t.id)]),
    [
      [1, [1, 2]],
      [2, [3, 4]],
    ],
  );
  assert.deepEqual(
    groupTabs([], (t: Tab) => t.windowId),
    [],
  );

  const titled = [tab({ id: 1, title: "A" }), tab({ id: 2, title: "A" }), tab({ id: 3, title: "B" })];
  assert.deepEqual(
    groupTabs(titled, (t) => t.title ?? "").map(([key, list]) => [key, list.map((t) => t.id)]),
    [
      ["A", [1, 2]],
      ["B", [3]],
    ],
    "same key fn contract works for titles",
  );
});

test("Model - Group-domain sort clusters by host with the shared size ordering", () => {
  const tabs = [
    tab({ id: 1, url: "https://b.com/x", lastAccessed: NOW - 2 * HOUR }),
    tab({ id: 2, url: "https://a.com/y", lastAccessed: NOW - 3 * HOUR }),
    tab({ id: 3, url: "https://b.com/z", lastAccessed: NOW - 1 * HOUR }),
  ];
  assert.deepEqual(
    selectVisible(tabs, view(tabs, { sort: "group-domain", sortDir: "desc" })).map((t) => t.id),
    [3, 1, 2],
    "b.com pair first (recent-first within), then a.com",
  );
  assert.deepEqual(
    selectVisible(tabs, view(tabs, { sort: "group-domain" })).map((t) => t.id),
    [2, 3, 1],
    "no direction: hosts alphabetical",
  );
});

test("Model - Group-title sort: natural = alphabetical, desc = biggest groups first", () => {
  const tabs = [
    tab({ id: 1, title: "Beta", lastAccessed: NOW - 2 * HOUR }),
    tab({ id: 2, title: "Alpha", lastAccessed: NOW - 3 * HOUR }),
    tab({ id: 3, title: "Beta", lastAccessed: NOW - 1 * HOUR }),
    tab({ id: 4, title: "Zulu", lastAccessed: NOW - 1 * HOUR }),
  ];
  assert.deepEqual(
    selectVisible(tabs, view(tabs, { sort: "group-title" })).map((t) => t.id),
    [2, 3, 1, 4],
    "natural: groups alphabetical, recent-first within Beta",
  );
  assert.deepEqual(
    selectVisible(tabs, view(tabs, { sort: "group-title", sortDir: "desc" })).map((t) => t.id),
    [3, 1, 2, 4],
    "desc: Beta pair (size 2) first, then singles alphabetical",
  );
});

test("Model - EmptyMessage picks the right hint", () => {
  assert.match(emptyMessage("xyz", "all"), /No tabs match/);
  assert.match(emptyMessage("", "snoozed"), /Nothing snoozed/);
  assert.match(emptyMessage("", "protected"), /No protected tabs/);
  assert.equal(emptyMessage("", "all"), "No open tabs.");
});

test("Model - RowViewModel maps tab state to plain data", () => {
  const rules = [rule({ id: "r", type: "host", pattern: "example.com" })];
  const rowTabs = [
    tab({ active: true }),
    tab({ id: 3, discarded: true, title: "Zzz" }),
    tab({ id: 4, url: "chrome://settings" }),
    tab({ id: 5, url: "about:blank" }),
  ];
  const ctx: RowContext = {
    index: 0,
    cursor: 0,
    now: NOW,
    currentWindowId: 1,
    derived: deriveTabs(rowTabs, rules),
    selected: new Set([1]),
    ...windowMaps([tab(), tab({ id: 2, windowId: 2 })], 1),
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
  assert.equal(vm.dot?.title, "Current window");

  const snoozed = rowViewModel(tab({ id: 3, discarded: true, title: "Zzz" }), {
    ...ctx,
    cursor: -1,
    selected: new Set(),
  });
  assert.ok(snoozed.title.startsWith("⏸ "));
  assert.equal(snoozed.canSnooze, false);
  assert.deepEqual(snoozed.badges[0], ["snoozed", "warn"]);

  const internal = rowViewModel(tab({ id: 4, url: "chrome://settings" }), { ...ctx, cursor: -1 });
  assert.equal(letterOf(internal.favicon), "S", "first letter of chrome page hostname");
  assert.equal(internal.canSnooze, false);
  const hostless = rowViewModel(tab({ id: 5, url: "about:blank" }), { ...ctx, cursor: -1 });
  assert.equal(letterOf(hostless.favicon), "•", "no hostname → bullet fallback");

  // a split pair's two rows sit nested under the Split sub-header (edges come from the visible order)
  const splitEdges = new Map<number, "first" | "last" | "only">([
    [4, "first"],
    [5, "last"],
    [1, "only"],
  ]);
  assert.deepEqual(rowViewModel(tab({ id: 4, url: "chrome://settings" }), { ...ctx, cursor: -1, splitEdges }).classes, [
    "row",
    "in-split",
    "split-first",
  ]);
  assert.deepEqual(rowViewModel(tab({ id: 5, url: "about:blank" }), { ...ctx, cursor: -1, splitEdges }).classes, [
    "row",
    "in-split",
    "split-last",
  ]);
  assert.deepEqual(rowViewModel(tab({ id: 3, discarded: true }), { ...ctx, cursor: -1, splitEdges }).classes, [
    "row",
    "snoozed",
  ]);
  assert.deepEqual(rowViewModel(tab(), { ...ctx, cursor: -1, splitEdges }).classes, [
    "row",
    "in-split",
    "split-first",
    "split-last",
  ]);
});

test("Model - Badges order and kinds", () => {
  const full = badges(tab({ discarded: true, pinned: true, audible: true }), true, true);
  assert.deepEqual(full, [
    ["snoozed", "warn"],
    ["protected", "ok"],
    ["kept alive", "ok"],
    ["pinned", ""],
    ["🔊", ""],
  ]);
  assert.deepEqual(badges(tab(), false), [], "kept-alive flag defaults to off");
  assert.deepEqual(badges(tab({ splitViewId: 5 }), false), [["split", ""]], "a split-view member");
  assert.deepEqual(badges(tab({ splitViewId: -1 }), false), [], "SPLIT_VIEW_ID_NONE is not a split");
});

test("Model - DeriveTabs flags kept-alive pages by url without fragment", () => {
  const tabs = [
    tab({ url: "https://example.com/page#x" }),
    tab({ id: 2, url: "https://other.io/" }),
    tab({ id: 3, url: "https://paused.io/" }),
  ];
  const derived = deriveTabs(
    tabs,
    [],
    [
      { url: "https://example.com/page", title: "P", minutes: 25, nextReload: 0 },
      { url: "https://paused.io/", title: "Paused", minutes: 25, paused: true, nextReload: 0 },
    ],
  );
  assert.equal(derived.get(1)?.keptAlive, true);
  assert.equal(derived.get(2)?.keptAlive, false);
  assert.equal(derived.get(3)?.keptAlive, false, "a paused mark reloads nothing: no badge");
  assert.equal(deriveTabs(tabs, []).get(1)?.keptAlive, false, "no list = nothing kept");
});

test("Model - CountsByFilter", () => {
  const rules = [rule({ id: "r", type: "host", pattern: "example.com" })];
  const tabs = [tab(), tab({ id: 2, discarded: true }), tab({ id: 3, url: "https://other.io/" })];
  assert.deepEqual(countsByFilter(tabs, deriveTabs(tabs, rules)), {
    all: 3,
    awake: 2,
    snoozed: 1,
    protected: 2,
    tags: 0,
  });
});

test("Model - BulkSummary states: none, partial, all selected", () => {
  const tabs = [tab(), tab({ id: 2 })];
  assert.deepEqual(bulkSummary(tabs, new Set()), {
    hidden: true,
    text: "0 selected",
    allChecked: false,
    indeterminate: false,
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
const {
  FONT_SIZE_STEPS,
  aboutText,
  settingsTitle,
  clampFontSize,
  clampedNumber,
  hasRule,
  releaseNotes,
  releaseSections,
  stepFontSize,
} = await import("../../src/pages/options/model.ts");

test("Model - Options - Clamps, rule lookup, about text", () => {
  assert.equal(clampFontSize("9"), 3, "max");
  assert.equal(clampFontSize("0.1"), 0.6, "min");
  assert.equal(clampFontSize("1.2"), 1.2);
  assert.equal(clampFontSize("garbage"), 1, "fallback then clamp");
  assert.equal(clampedNumber("50", 1), 50);
  assert.equal(clampedNumber("-3", 1), 1, "floor");
  assert.equal(clampedNumber("", 5), 5, "empty → floor");
  assert.equal(hasRule([{ pattern: "*.a.com" }], "*.a.com"), true);
  assert.equal(hasRule([{ pattern: "*.a.com" }], "a.com"), false);
  assert.equal(aboutText("1.2.3"), "Taboom 1.2.3");
  assert.equal(settingsTitle("1.2.3"), "Taboom Extension v1.2.3 Settings");
});

test("Model - Options - Zoom steps walk the presets and snap in-between values", () => {
  assert.equal(FONT_SIZE_STEPS[0], 0.6, "smallest preset = FONT_SIZE_MIN");
  assert.equal(FONT_SIZE_STEPS[FONT_SIZE_STEPS.length - 1], 3, "largest preset = FONT_SIZE_MAX");
  assert.equal(stepFontSize(1, 1), 1.1);
  assert.equal(stepFontSize(1, -1), 0.9);
  assert.equal(stepFontSize(3, 1), 3, "stays at max");
  assert.equal(stepFontSize(0.6, -1), 0.6, "stays at min");
  assert.equal(stepFontSize(1.05, 1), 1.1, "between presets: next preset up");
  assert.equal(stepFontSize(1.05, -1), 1, "between presets: next preset down");
  assert.equal(stepFontSize(9, -1), 3, "out of range steps back into it");
});

test("Model - Options - ReleaseNotes picks version section, falls back to newest", () => {
  const md = "# CHANGES\n\n## v0.2.7 — 2026-08-16\n\n- new stuff\n\n## v0.2.6 — 2026-08-15\n\n- old stuff\n";
  assert.deepEqual(releaseNotes(md, "0.2.6"), { title: "v0.2.6 — 2026-08-15", body: "- old stuff" });
  assert.deepEqual(
    releaseNotes(md, "9.9.9"),
    { title: "v0.2.7 — 2026-08-16", body: "- new stuff" },
    "fallback to newest",
  );
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
const { resolveColorScheme } = await import("../../src/app/core.ts");

test("Model - ResolveColorScheme: explicit themes pass, anything else follows system", () => {
  assert.equal(resolveColorScheme("light"), "light");
  assert.equal(resolveColorScheme("dark"), "dark");
  assert.equal(resolveColorScheme("auto"), "");
  assert.equal(resolveColorScheme(undefined), "");
});

test("Model - Options - PerfLines formats metrics readably", async () => {
  const { perfLines } = await import("../../src/pages/options/model.ts");
  const lines = perfLines({ "sidepanel.render": { count: 3, avg: 12.34, min: 6, max: 20.5, last: 6 } });
  assert.equal(lines.length, 1);
  // lines[0]!: exactly one line asserted above
  assert.match(lines[0]!, /^sidepanel\.render: count 3 · avg 12\.3ms · min 6\.0 · max 20\.5 · last 6\.0$/);
  assert.deepEqual(perfLines({}), []);
});

test("Model - Options - SnapshotBlocks: newest first, timestamp header, indented metrics", async () => {
  const { snapshotBlocks } = await import("../../src/pages/options/model.ts");
  const metrics = { render: { count: 1, avg: 5, min: 5, max: 5, last: 5 } };
  const blocks = snapshotBlocks([
    { at: 1700000000000, metrics },
    { at: 1700000100000, metrics },
  ]);
  assert.equal(blocks.length, 2);
  assert.equal(
    blocks[0],
    `${new Date(1700000100000).toLocaleString()}\n  render: count 1 · avg 5.0ms · min 5.0 · max 5.0 · last 5.0`,
    "newest first",
  );
  assert.deepEqual(snapshotBlocks([]), []);
});

test("Model - fuzzyScore tiers: whole word > word start > mid substring > subsequence > none", () => {
  const wholeWord = fuzzyScore("my pull request", "pull");
  const atStart = fuzzyScore("pull it", "pull"); // whole word AND haystack start
  const wordStart = fuzzyScore("my pullrequests", "pull");
  const midSubstring = fuzzyScore("spullx", "pull");
  const subsequence = fuzzyScore("p u l l", "pull");
  assert.ok(atStart > wholeWord, "haystack start tops everything");
  assert.ok(wholeWord > wordStart, "whole word beats prefix-of-word");
  assert.ok(wordStart > midSubstring, "word start beats mid-word substring");
  assert.ok(midSubstring > subsequence, "any substring beats a scattered match");
  assert.ok(subsequence > 0, "scattered in-order chars still match");
  assert.equal(fuzzyScore("nothing here", "xyz"), 0, "chars out of order / missing: no match");
});

test("Model - searchCandidates with FUZZY_SEARCH ranks by relevance, ties recent-first", () => {
  const tabs = [
    tab({ id: 1, windowId: 1, url: "https://a.dev/x", title: "grep manual", lastAccessed: 5 }),
    tab({ id: 2, windowId: 1, url: "https://b.dev/y", title: "my report", lastAccessed: 9 }),
    tab({ id: 3, windowId: 1, url: "https://c.dev/z", title: "rust example page", lastAccessed: 7 }),
    tab({ id: 4, windowId: 1, url: "https://d.dev/q", title: "vim notes", lastAccessed: 8 }),
  ];
  const derived = deriveTabs(tabs, []);
  const view = { query: "rep", scope: "all-windows", currentWindowId: 1, derived };
  const fuzzy = searchCandidates(tabs, { ...view, features: { FUZZY_SEARCH: { enabled: true } } });
  assert.deepEqual(
    fuzzy.map((t) => t.title),
    ["my report", "grep manual", "rust example page"],
    "word-start substring > mid-word substring > subsequence; no-p tab excluded",
  );
  const plain = searchCandidates(tabs, view);
  assert.deepEqual(
    plain.map((t) => t.title),
    ["grep manual", "my report"],
    "flag off: substring matches only, original order kept",
  );
  const visible = selectVisible(tabs, {
    ...view,
    features: { FUZZY_SEARCH: { enabled: true } },
    filter: "all",
    sort: "title",
    sortDir: "asc",
    now: 10,
  });
  assert.deepEqual(
    visible.map((t) => t.title),
    ["my report", "grep manual", "rust example page"],
    "relevance order survives selectVisible instead of the active sort",
  );
});

test("Model - highlightRanges: substring occurrences, overlap merge, fuzzy scatter fallback", () => {
  assert.deepEqual(highlightRanges("My Pull Request", ["pull"]), [[3, 7]], "case-insensitive substring");
  assert.deepEqual(highlightRanges("abab", ["ab"]), [[0, 4]], "every occurrence marked, touching ranges merge");
  assert.deepEqual(highlightRanges("abcd", ["abc", "bcd"]), [[0, 4]], "overlapping tokens merge");
  assert.deepEqual(
    highlightRanges("grep manual", ["gm"], true),
    [
      [0, 1],
      [5, 6],
    ],
    "fuzzy marks scattered chars",
  );
  assert.deepEqual(highlightRanges("grep manual", ["gm"]), [], "no scatter marks without fuzzy");
  assert.deepEqual(highlightRanges("grep manual", ["xq"], true), [], "missing char: nothing marked");
});

test("Model - URL-only matches stay searchable and get a 'url match' badge", () => {
  const tabs = [
    tab({ id: 1, windowId: 1, url: "https://zzz.dev/abc", title: "report", lastAccessed: 1 }),
    // r/e/p only reachable through the raw url — nothing markable in title/host
    tab({ id: 2, windowId: 1, url: "https://r.dev/e-p", title: "zzz", lastAccessed: 2 }),
  ];
  const derived = deriveTabs(tabs, []);
  const view = {
    query: "rep",
    scope: "all-windows",
    currentWindowId: 1,
    derived,
    features: { FUZZY_SEARCH: { enabled: true } },
  };
  assert.deepEqual(
    searchCandidates(tabs, view)
      .map((t) => t.id)
      .sort(),
    [1, 2],
    "url scatter still matches",
  );
  const vmOf = (t: Tab) =>
    rowViewModel(t, {
      index: 0,
      cursor: -1,
      now: 10,
      currentWindowId: 1,
      derived,
      selected: new Set(),
      dotColors: new Map(),
      indexes: new Map(),
      queryTokens: ["rep"],
      fuzzy: true,
    });
  assert.ok(
    vmOf(tabs[1]!).badges.some(([label]) => label === "url match"),
    "invisible match explained by badge",
  );
  assert.ok(!vmOf(tabs[0]!).badges.some(([label]) => label === "url match"), "no badge when the title carries marks");
});

test("Model - experimental_fuzzySearch pref gates fuzzy only while the flag is experimental", () => {
  const tabs = [tab({ id: 1, windowId: 1, url: "https://x.dev/", title: "blahblah", lastAccessed: 1 })];
  const derived = deriveTabs(tabs, []);
  const base = { query: "lh", scope: "all-windows", currentWindowId: 1, derived };
  const experimental = { FUZZY_SEARCH: { enabled: true, experimental: true } };
  const stable = { FUZZY_SEARCH: { enabled: true } };
  const hits = (view: SearchView) => searchCandidates(tabs, view).length;
  assert.equal(hits({ ...base, features: experimental }), 1, "pref absent: default on");
  assert.equal(
    hits({ ...base, features: experimental, ui: { experimental_fuzzySearch: false } }),
    0,
    "pref off: plain search only",
  );
  assert.equal(
    hits({ ...base, features: stable, ui: { experimental_fuzzySearch: false } }),
    1,
    "promoted stable: stale experimental_ pref ignored",
  );
});

test("Model - Group-url sort clusters duplicate urls with the shared size ordering", () => {
  const tabs = [
    tab({ id: 1, url: "https://b.com/x", lastAccessed: NOW - 2 * HOUR }),
    tab({ id: 2, url: "https://a.com/y", lastAccessed: NOW - 3 * HOUR }),
    tab({ id: 3, url: "https://b.com/x", lastAccessed: NOW - 1 * HOUR }),
  ];
  assert.deepEqual(
    selectVisible(tabs, view(tabs, { sort: "group-url", sortDir: "desc" })).map((t) => t.id),
    [3, 1, 2],
    "duplicate-url pair first (recent-first within), then the single",
  );
  assert.deepEqual(
    selectVisible(tabs, view(tabs, { sort: "group-url" })).map((t) => t.id),
    [2, 3, 1],
    "no direction: urls alphabetical",
  );
});

test("Model - groupByWindowTabsOrder controls within-window order in the window grouping", () => {
  const tabs = [
    tab({ id: 1, title: "Bravo", index: 2, lastAccessed: NOW - 1 * HOUR }),
    tab({ id: 2, title: "Alpha", index: 0, lastAccessed: NOW - 3 * HOUR }),
    tab({ id: 3, title: "Charlie", index: 1, lastAccessed: NOW - 2 * HOUR }),
  ];
  const order = (groupByWindowTabsOrder: UiPrefs["groupByWindowTabsOrder"] | undefined) =>
    selectVisible(
      tabs,
      view(tabs, { sort: "window", ui: groupByWindowTabsOrder ? { groupByWindowTabsOrder } : {} }),
    ).map((t) => t.id);
  assert.deepEqual(order(undefined), [1, 3, 2], "default: recently used first");
  assert.deepEqual(order("recent"), [1, 3, 2], "explicit recent matches default");
  assert.deepEqual(order("same-as-window"), [2, 3, 1], "same-as-window: tab strip position");
  assert.deepEqual(order("title-asc"), [2, 1, 3], "titles A-Z");
  assert.deepEqual(order("title-desc"), [3, 1, 2], "titles Z-A");
});

test("Model - Pinned windows sort above unpinned in the window grouping (current always first)", () => {
  const tabs = [tab({ id: 1, windowId: 1 }), tab({ id: 2, windowId: 2 }), tab({ id: 3, windowId: 3 })];
  const windowMeta = new Map([[3, { pinnedWindow: true }]]);
  const order = selectVisible(tabs, view(tabs, { sort: "window", windowMeta })).map((t) => t.windowId);
  assert.deepEqual(order, [1, 3, 2], "current #1, pinned #3 lifted above #2");
  const noMeta = selectVisible(tabs, view(tabs, { sort: "window" })).map((t) => t.windowId);
  assert.deepEqual(noMeta, [1, 2, 3], "no meta: default labels keep chrome-id order");

  // two lists, same internal ordering: names sort ABC inside each band
  const named = new Map([
    [2, { name: "Zulu", pinnedWindow: true }],
    [3, { name: "Alpha", pinnedWindow: true }],
    [4, { name: "Mid" }],
  ]);
  const four = [...tabs, tab({ id: 4, windowId: 4 })];
  const banded = selectVisible(four, view(four, { sort: "window", windowMeta: named })).map((t) => t.windowId);
  // current 1, pinned band ABC (Alpha=3, Zulu=2), unpinned band ABC (Mid=4)
  assert.deepEqual(banded, [1, 3, 2, 4], "pinned band ABC above unpinned band");
});

test("Model - WINDOW_NAMES: custom names and colors resolve through windowMaps meta", () => {
  const tabs = [tab({ id: 1 }), tab({ id: 2, windowId: 2 }), tab({ id: 3, windowId: 3 })];
  const meta = new Map([
    [1, { name: "Research" }],
    [2, { color: "#123456" }],
  ]);
  const maps = windowMaps(tabs, 1, meta);
  assert.equal(
    windowGroupName(1, { currentWindowId: 1, indexes: maps.indexes, names: maps.names }),
    "Research — Current #1",
    "named current window keeps its index suffix",
  );
  assert.equal(
    windowGroupName(2, { currentWindowId: 1, indexes: maps.indexes, names: maps.names }),
    "Window #2",
    "color-only meta leaves the default label",
  );
  assert.equal(maps.dotColors.get(2), "#123456", "custom color wins over positional");
  assert.equal(maps.dotColors.get(1), "", "current window: accent while no custom color");
  const coloredCurrent = windowMaps(tabs, 1, new Map([[1, { color: "#abcdef" }]]));
  assert.equal(coloredCurrent.dotColors.get(1), "#abcdef", "custom color wins on the current window too");
  assert.ok(maps.dotColors.get(3)?.startsWith("#"), "unset window keeps auto color");

  const named = new Map([[2, { name: "Media" }]]);
  const namedMaps = windowMaps(tabs, 1, named);
  assert.equal(
    windowGroupName(2, { currentWindowId: 1, indexes: namedMaps.indexes, names: namedMaps.names }),
    "Media",
    "named other window: name only, no index",
  );
});

test("Model - Tab groups sort: strip order inside a group, recency in the ungrouped bucket", () => {
  const groups = new Map([[7, tabGroup({ title: "work" })]]);
  const tabs = [
    tab({ id: 1, groupId: 7, index: 2, lastAccessed: NOW }),
    tab({ id: 2, groupId: 7, index: 0, lastAccessed: NOW - 3 * HOUR }),
    tab({ id: 3, groupId: 7, index: 1, lastAccessed: NOW - 1 * HOUR }),
    tab({ id: 4, index: 5, lastAccessed: NOW - 2 * HOUR }),
    tab({ id: 5, index: 4, lastAccessed: NOW }),
  ];
  const order = selectVisible(tabs, view(tabs, { sort: "group-tabgroup", tabGroups: groups })).map((t) => t.id);
  // group "work" first (2,3,1 by strip index), then ungrouped by recency (5,4)
  assert.deepEqual(order, [2, 3, 1, 5, 4]);
});

// ---------- tags ----------
const work: Tag = { id: "t1", name: "Work", color: "blue" };
const bills: Tag = { id: "t2", name: "bills", color: "yellow" };
const tagging = {
  tags: [work, bills],
  pages: [
    { url: "https://example.com/x", tagIds: ["t2", "t1"] },
    { url: "https://other.io/", tagIds: ["t2"] },
  ] satisfies TagPage[],
};

test("Model - TAGS: deriveTabs attaches a tab's tags (tag-list order) and searches their names", () => {
  const tabs = [
    tab({ url: "https://example.com/x#frag" }),
    tab({ id: 2, url: "https://other.io/" }),
    tab({ id: 3, url: "https://none.io/" }),
  ];
  const derived = deriveTabs(tabs, [], [], tagging);
  assert.deepEqual(derived.get(1)?.tags, [work, bills], "fragment ignored, tag-list order");
  assert.deepEqual(derived.get(2)?.tags, [bills]);
  assert.deepEqual(derived.get(3)?.tags, []);
  assert.deepEqual(
    derived.get(1)?.tagOrigins,
    new Map([
      ["t2", "page"],
      ["t1", "page"],
    ]),
    "its own entry",
  );
  assert.deepEqual(derived.get(3)?.tagOrigins, new Map());
  const site = { ...tagging, pages: [...tagging.pages, { url: "example.com", tagIds: ["t1"] }] };
  assert.deepEqual(
    deriveTabs(tabs, [], [], site).get(1)?.tagOrigins,
    new Map([
      ["t2", "page"],
      ["t1", "page"],
    ]),
    "the page's own entry wins over the domain's",
  );
  assert.match(derived.get(1)?.haystack ?? "", / work bills$/, "plain words find tagged tabs");
  assert.deepEqual(deriveTabs(tabs, []).get(1)?.tags, [], "no tagging = no tags");
  const offList = { ...tagging, tags: [{ ...work, disabled: true }, bills] };
  assert.deepEqual(deriveTabs(tabs, [], [], offList).get(1)?.tags, [bills], "a disabled tag is not a tag here");
  assert.doesNotMatch(deriveTabs(tabs, [], [], offList).get(1)?.haystack ?? "", /work/);
});

test("Model - TAGS: badges carry the tag as a solid pill after the plain states (pinned included); hits marked", () => {
  const list = badges(tab({ pinned: true }), true, false, [work, bills], new Set(["t2"]));
  assert.deepEqual(list, [
    ["protected", "ok"],
    ["pinned", ""],
    ["bills", "tag dark hit", "#f9ab00"], // the hit comes first
    ["Work", "tag", "#1a73e8"],
  ]);
  // a tag from a domain or pattern entry says so in the pill: a glyph before the name (part of the
  // label, so fitTagPills measures it) and the origin in the kind
  const origins = new Map<string, "page" | "domain" | "pattern">([
    ["t1", "domain"],
    ["t2", "pattern"],
  ]);
  assert.deepEqual(badges(tab(), false, false, [work, bills], new Set(), origins), [
    ["⌂ Work", "tag domain", "#1a73e8"],
    ["✱ bills", "tag dark pattern", "#f9ab00"],
  ]);
  // every tag is a pill here (fitTagPills trims to the line) — a search hit moves to the front
  const many: Tag[] = [
    work,
    bills,
    { id: "t3", name: "c", color: "red" },
    { id: "t4", name: "d", color: "cyan" },
    { id: "t5", name: "e", color: "green" },
  ];
  assert.deepEqual(
    badges(tab(), false, false, many).map(([label]) => label),
    ["Work", "bills", "c", "d", "e"],
  );
  assert.deepEqual(
    badges(tab(), false, false, many, new Set(["t5"])).map(([label, kind]) => [label, kind]),
    [
      ["e", "tag hit"],
      ["Work", "tag"],
      ["bills", "tag dark"],
      ["c", "tag"],
      ["d", "tag"],
    ],
    "the hit tag moves to the front; the rest keep their order",
  );
});

test("Model - TAGS: fitTagPills keeps the pills that fit the meta line and folds the rest into +N", () => {
  const pill = (name: string, kind = "tag"): Badge => [name, kind, "#1a73e8"];
  const list: Badge[] = [["pinned", ""], pill("alpha"), pill("beta"), pill("gamma"), pill("delta"), ["🔊", ""]];
  // 6 px per character, 10 px per rem: a pill = text + 7.5 px, a plain badge = text + 6.25 px, the gap
  // 3.75 px, the host keeps 60 px; no action buttons unless said
  const measured = (line: number) => ({ line, rem: 10, textWidth: (label: string) => label.length * 6 });
  const labels = (badges: Badge[]) => badges.map(([label]) => label);
  const on = (line: number, age: string | null = null, buttons = 0) =>
    labels(fitTagPills(list, age, "example.com", buttons, measured(line)));
  assert.deepEqual(
    labels(fitTagPills(list, null, "example.com", 0, undefined)),
    ["pinned", "alpha", "beta", "gamma", "+1", "🔊"],
    "no measure: three pills",
  );
  assert.deepEqual(on(1000), ["pinned", "alpha", "beta", "gamma", "delta", "🔊"], "room for all: no +N");
  // host 60 + gap + pinned 42.25 + gap + alpha 37.5 + gap + beta 31.5 + gap + "+2" 12 + gap + 🔊 (2 chars) 18.25 = 220.25
  assert.deepEqual(on(221), ["pinned", "alpha", "beta", "+2", "🔊"]);
  assert.deepEqual(on(219), ["pinned", "alpha", "+3", "🔊"], "the +N itself needs its room");
  assert.deepEqual(on(50), ["pinned", "alpha", "+3", "🔊"], "the first pill always shows");
  // the age is set in the meta's font: 2 chars × 6 × 0.85/0.77 ≈ 13.25 + a gap
  assert.deepEqual(on(237, "3h"), ["pinned", "alpha", "+3", "🔊"], "the age takes its share");
  assert.deepEqual(on(238, "3h"), ["pinned", "alpha", "beta", "+2", "🔊"]);
  // three buttons: 3 × 15 + 2 × 1.25 + the 3.75 row gap = 51.25 off the line
  assert.deepEqual(on(272, null, 3), ["pinned", "alpha", "beta", "+2", "🔊"]);
  assert.deepEqual(on(271, null, 3), ["pinned", "alpha", "+3", "🔊"], "the buttons take theirs");
  // one pill that cannot fit whole: it carries the room left after the host floor, the plain badges and the
  // "+N" (60 + 42.25 + 18.25 + 12 + 4 gaps 15 = 147.5 → 32.5 of 180), the CSS ellipsizes it; never under 2rem
  assert.deepEqual(fitTagPills(list, null, "example.com", 0, measured(180))[1], ["alpha", "tag", "#1a73e8", 32.5]);
  assert.deepEqual(fitTagPills(list, null, "example.com", 0, measured(100))[1], ["alpha", "tag", "#1a73e8", 20]);
  assert.equal(fitTagPills([["pinned", ""]], null, "x", 0, measured(10)).length, 1, "no pills: untouched");
  assert.deepEqual(
    fitTagPills(list, null, "x", 0, measured(1000))[1],
    pill("alpha"),
    "pills keep their kind and color",
  );
});

test("Model - TAGS: the tags filter (any tag, or the ticked ones) and its count", () => {
  const tabs = [tab(), tab({ id: 2, url: "https://other.io/" }), tab({ id: 3, url: "https://none.io/" })];
  const derived = deriveTabs(tabs, [], [], tagging);
  const base = view(tabs, { filter: "tags", derived });
  assert.deepEqual(
    selectVisible(tabs, base).map((t) => t.id),
    [1, 2],
    "no tick = any tagged tab",
  );
  assert.deepEqual(
    selectVisible(tabs, { ...base, tagFilter: new Set(["t1"]) }).map((t) => t.id),
    [1],
  );
  assert.deepEqual(
    selectVisible(tabs, { ...base, tagFilter: new Set(["t1", "t2"]) }).map((t) => t.id),
    [1, 2],
    "OR",
  );
  assert.deepEqual(
    selectVisible(tabs, { ...base, tagFilter: new Set(["zz"]) }).map((t) => t.id),
    [],
    "a vanished tag matches nothing",
  );
  assert.equal(countsByFilter(tabs, derived).tags, 2);
  assert.equal(countsByFilter(tabs, derived, new Set(["t1"])).tags, 1, "the chip counts what it would show");
  assert.match(emptyMessage("", "tags"), /No tagged tabs/);
});

test("Model - TAGS: #token searches tag names by prefix, text tokens stay text, both must match", () => {
  const tabs = [
    tab({ title: "Alpha" }),
    tab({ id: 2, url: "https://other.io/", title: "Beta" }),
    tab({ id: 3, url: "https://none.io/", title: "Gamma work" }),
  ];
  const derived = deriveTabs(tabs, [], [], tagging);
  const ids = (query: string) => selectVisible(tabs, view(tabs, { query, derived })).map((t) => t.id);
  assert.deepEqual(ids("#wo"), [1], "prefix on the tag name — the title 'work' of tab 3 is not a tag");
  assert.deepEqual(ids("#bills"), [1, 2]);
  assert.deepEqual(ids("#bills beta"), [2]);
  assert.deepEqual(ids("work"), [1, 3], "plain word: tag name or title");
  assert.deepEqual(ids("#"), [1, 2, 3], "a lone # is noise");
  assert.deepEqual(ids("#zz"), []);
});

test("Model - TAGS: group-tag sort clusters by the first tag (tag-list order), untagged last", () => {
  const tabs = [
    tab({ id: 1, url: "https://none.io/", title: "none" }),
    tab({ id: 2, url: "https://other.io/", title: "bills only", lastAccessed: NOW - 3 * HOUR }),
    tab({ id: 3, url: "https://example.com/x", title: "work+bills" }),
    tab({ id: 4, url: "https://other.io/#two", title: "bills newer", lastAccessed: NOW - HOUR }),
  ];
  const derived = deriveTabs(tabs, [], [], tagging);
  assert.deepEqual(
    selectVisible(tabs, view(tabs, { sort: "group-tag", sortDir: "none", derived })).map((t) => t.id),
    [4, 2, 3, 1],
    "groups ABC by tag name (bills, Work), recent-first inside, No tag last",
  );
  assert.deepEqual(
    selectVisible(tabs, view(tabs, { sort: "group-tag", sortDir: "asc", derived })).map((t) => t.id),
    [3, 1, 4, 2],
    "asc: smallest groups first, ties ABC (Work, then the untagged bucket), bills last",
  );
  assert.equal(tagGroupName(work), "Work");
  assert.equal(tagGroupName(undefined), "No tag");
});

test("Model - RowViewModel tip: the url, the row's plain badges as a states line, the tags apart", () => {
  const rules = [rule({ id: "r", type: "host", pattern: "example.com" })];
  const tabs = [tab({ discarded: true, pinned: true, audible: true }), tab({ id: 2, url: "https://none.io/" })];
  const ctx: RowContext = {
    index: 0,
    cursor: -1,
    now: NOW,
    currentWindowId: 1,
    derived: deriveTabs(tabs, rules, [], tagging),
    selected: new Set(),
    dotColors: new Map(),
    indexes: new Map(),
  };
  const vm = rowViewModel(tabs[0]!, ctx);
  assert.equal(vm.tip, "https://example.com/x", "the text is the url; states and tags are their own lines");
  assert.deepEqual(vm.tipBadges, [
    ["snoozed", "warn"],
    ["protected", "ok"],
    ["pinned", ""],
    ["🔊", ""],
  ]);
  assert.deepEqual(vm.tipTags, [
    { name: "Work", color: "#1a73e8", dark: false },
    { name: "bills", color: "#f9ab00", dark: true },
  ]);
  assert.equal(rowViewModel(tabs[1]!, ctx).tip, "https://none.io/", "nothing to say: the url alone");
  assert.deepEqual(rowViewModel(tabs[1]!, ctx).tipBadges, []);
  assert.deepEqual(rowViewModel(tabs[1]!, ctx).tipTags, []);
  assert.equal(
    rowViewModel(tab({ id: 3, url: undefined }), { ...ctx, derived: deriveTabs([tab({ id: 3, url: undefined })], []) })
      .tip,
    "",
  );
});

test("Model - Options - Tag table sort: a header cycles none → asc → desc → none; another header starts asc", () => {
  const counts = new Map([
    ["t1", 2],
    ["t2", 0],
    ["t3", 5],
  ]);
  const list: Tag[] = [
    { id: "t1", name: "work", color: "blue" },
    { id: "t2", name: "Alpha", color: "red" },
    { id: "t3", name: "bills", color: "grey" },
  ];
  assert.deepEqual(nextTagSort(null, "name"), { key: "name", dir: "asc" });
  assert.deepEqual(nextTagSort({ key: "name", dir: "asc" }, "name"), { key: "name", dir: "desc" });
  assert.equal(nextTagSort({ key: "name", dir: "desc" }, "name"), null, "third click: the stored order");
  assert.deepEqual(nextTagSort({ key: "name", dir: "desc" }, "pages"), { key: "pages", dir: "asc" });
  const ids = (sort: TagSort | null) => sortedTags(list, counts, sort).map((tag) => tag.id);
  assert.deepEqual(ids(null), ["t1", "t2", "t3"], "no sort: as stored");
  assert.deepEqual(ids({ key: "name", dir: "asc" }), ["t2", "t3", "t1"], "names A–Z, case-insensitive");
  assert.deepEqual(ids({ key: "name", dir: "desc" }), ["t1", "t3", "t2"]);
  assert.deepEqual(ids({ key: "pages", dir: "asc" }), ["t2", "t1", "t3"]);
  assert.deepEqual(ids({ key: "pages", dir: "desc" }), ["t3", "t1", "t2"]);
  assert.deepEqual(ids({ key: "color", dir: "asc" }), ["t3", "t1", "t2"], "palette order: grey, blue, red");
  assert.deepEqual(ids({ key: "color", dir: "desc" }), ["t2", "t1", "t3"]);
  // every picker list: enabled tags in the "Tags order in pickers" order
  const pages = [
    { url: "https://a.test/", tagIds: ["t1", "t3"] },
    { url: "https://b.test/", tagIds: ["t3"] },
  ];
  const picked = (ui: Parameters<typeof orderedTags>[2]) => orderedTags(list, pages, ui).map((tag) => tag.id);
  assert.deepEqual(picked({ tagPickOrder: "stored" }), ["t1", "t2", "t3"]);
  assert.deepEqual(picked({}), ["t1", "t2", "t3"], "absent = stored");
  assert.deepEqual(picked({ tagPickOrder: "name" }), ["t2", "t3", "t1"]);
  assert.deepEqual(picked({ tagPickOrder: "used" }), ["t3", "t1", "t2"], "most pages first");
  assert.deepEqual(picked({ tagPickOrder: "table", tagSort: { key: "name", dir: "desc" } }), ["t1", "t3", "t2"]);
  assert.deepEqual(picked({ tagPickOrder: "table" }), ["t1", "t2", "t3"], "no table sort = stored");
  assert.deepEqual(
    picked({ tagPickOrder: "stored", tagSort: { key: "name", dir: "asc" } }),
    ["t1", "t2", "t3"],
    "a table sort alone does not reorder the pickers",
  );
  assert.deepEqual(
    orderedTags([{ ...list[0]!, disabled: true }, list[1]!, list[2]!], pages, { tagPickOrder: "name" }).map(
      (tag) => tag.id,
    ),
    ["t2", "t3"],
    "switched-off tags are left out",
  );
});
