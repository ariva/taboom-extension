import assert from "node:assert/strict";
import { test } from "vitest";
import type { ChromeMockOptions } from "../../helpers/chrome-mock.ts";
import { byId, q, qa } from "../../helpers/dom.ts";
import { loadPage, makeChrome, TEST_FEATURES, tick } from "../../helpers/ui.ts";

const GROUP_SELECT_ON = TEST_FEATURES.WINDOW_GROUP_SELECT?.enabled === true;
const GROUP_TITLE_ON = TEST_FEATURES.GROUP_BY_TITLE?.enabled === true;

const NOW = Date.now();
const HOUR = 3_600_000;
const tabs: NonNullable<ChromeMockOptions["tabs"]> = [
  {
    id: 1,
    windowId: 1,
    active: false,
    discarded: false,
    url: "https://zeta.org/x",
    title: "Charlie",
    lastAccessed: NOW - 3 * HOUR,
  },
  {
    id: 2,
    windowId: 1,
    active: false,
    discarded: false,
    url: "https://alpha.dev/y",
    title: "Bravo",
    lastAccessed: NOW - 1 * HOUR,
  },
  {
    id: 3,
    windowId: 1,
    active: false,
    discarded: false,
    url: "https://mid.io/z",
    title: "Alpha",
    lastAccessed: NOW - 2 * HOUR,
  },
  {
    id: 4,
    windowId: 2,
    active: false,
    discarded: false,
    url: "https://bb.aa/q",
    title: "Delta",
    lastAccessed: NOW - 4 * HOUR,
  },
];

const stored: { ui?: Record<string, unknown> } = {};
const calls: string[] = [];
const groups: ChromeMockOptions["groups"] = [
  { id: 7, title: "work", color: "blue", collapsed: false, windowId: 1 },
  { id: 8, title: "beta", color: "red", collapsed: false, windowId: 1 },
];
const chrome = makeChrome({ tabs, calls, stored, groups });
loadPage("src/pages/sidepanel/index.html", chrome);
await import("../../../src/pages/sidepanel/main.ts");
await tick();
await tick();

// the untyped original dereferenced these lookups blindly (TypeError when missing) — same failure, readable message
function must<T>(value: T | null | undefined, what: string): T {
  if (value == null) {
    throw new Error(`test: missing ${what}`);
  }
  return value;
}
const tabOf = (id: number) =>
  must(
    tabs.find((t) => t.id === id),
    `tab ${id}`,
  );
const titles = () => qa(document, ".row .title").map((el) => el.textContent);
function setSort(value: string) {
  const select = byId<HTMLSelectElement>("sort");
  select.value = value;
  select.dispatchEvent(new window.Event("change", { bubbles: true }));
}

test("UI - Sidepanel Sort - Default is Group by window on first launch", () => {
  assert.equal(byId<HTMLSelectElement>("sort").value, "window");
  assert.equal(document.querySelectorAll(".group-header").length, 2, "grouped view by default");
  assert.equal(byId("collapse-all").hidden, false, "fold-all visible");
  const header = q(document, ".group-header");
  assert.match(
    must(header.dataset.tip, "header data-tip"),
    /Window Current #1\n0\/3 selected tabs\n3\/3 visible tabs\nClick to collapse/,
    "tip carries group, selection, visibility info + action",
  );
  header.dispatchEvent(new window.Event("mouseover", { bubbles: true }));
  const tip = byId("hover-tip");
  assert.equal(tip.hidden, false, "custom tip shows on hover");
  assert.match(tip.textContent, /0\/3 selected tabs/);
  byId("tab-list").dispatchEvent(new window.Event("mouseleave"));
  assert.equal(tip.hidden, true, "tip hides when leaving the list");
});

test("UI - Sidepanel Sort - Recent: most recently used first", () => {
  setSort("recent");
  assert.deepEqual(titles(), ["Bravo", "Alpha", "Charlie", "Delta"]);
});

test("UI - Sidepanel Sort - Oldest: least recently used first", () => {
  setSort("oldest");
  assert.deepEqual(titles(), ["Delta", "Charlie", "Alpha", "Bravo"]);
});

test("UI - Sidepanel Sort - Title: alphabetical", () => {
  setSort("title");
  assert.deepEqual(titles(), ["Alpha", "Bravo", "Charlie", "Delta"]);
});

test("UI - Sidepanel Sort - Domain: alphabetical by hostname", () => {
  setSort("domain");
  // alpha.dev < bb.aa < mid.io < zeta.org
  assert.deepEqual(titles(), ["Bravo", "Delta", "Alpha", "Charlie"]);
});

test("UI - Sidepanel Sort - Group by window: current window first, headers with counts", () => {
  setSort("window");
  assert.deepEqual(
    titles(),
    ["Charlie", "Bravo", "Alpha", "Delta"],
    "current window in strip order (default same-as-window), then window 2",
  );
  const headers = qa(document, ".group-header").map((el) => el.textContent);
  const dots = TEST_FEATURES.WINDOW_NAMES?.enabled === true ? "⋯" : ""; // ⋯ window-menu button
  assert.deepEqual(headers, [`Window Current #13/3${dots}▾`, `Window #21/1${dots}▾`], "name + counts + arrow spans");
  assert.deepEqual(
    qa(document, ".group-header .group-count").map((el) => el.textContent),
    ["3/3", "1/1"],
    "counts in their own non-truncating span",
  );

  // filtered list → visible / total diverge
  const search = byId<HTMLInputElement>("search");
  search.value = "Bravo";
  search.dispatchEvent(new window.Event("input", { bubbles: true }));
  assert.deepEqual(
    qa(document, ".group-header").map((el) => el.textContent),
    ["Window Current #11/3"],
    "single matching group: static header, no fold arrow",
  );
  search.value = "";
  search.dispatchEvent(new window.Event("input", { bubbles: true }));
  setSort("recent");
  assert.equal(document.querySelector(".group-header"), null, "headers only in window mode");
});

test("UI - Sidepanel Sort - Collapse hides a group's rows; search auto-expands", () => {
  setSort("window");
  const headerFor = (needle: string) =>
    must(
      qa(document, ".group-header").find((el) => el.textContent.includes(needle)),
      `group header "${needle}"`,
    );

  headerFor("Window Current #1").click();
  assert.equal(document.querySelectorAll(".row").length, 1, "only window 2's row left");
  assert.match(headerFor("Window Current #1").textContent, /▸$/, "collapsed indicator at the right");
  assert.equal(document.querySelectorAll(".group-header").length, 2, "header stays visible");

  // search finds a tab inside the collapsed group → group auto-expands
  const search = byId<HTMLInputElement>("search");
  search.value = "Charlie";
  search.dispatchEvent(new window.Event("input", { bubbles: true }));
  assert.equal(document.querySelectorAll(".row").length, 1);
  assert.match(q(document, ".row .title").textContent, /Charlie/);
  assert.ok(!headerFor("Window Current #1").textContent.includes("▸"), "not marked collapsed during search");
  assert.ok(headerFor("Window Current #1").classList.contains("static"), "single visible group → no collapse UI");

  // clearing the search restores the collapsed state
  search.value = "";
  search.dispatchEvent(new window.Event("input", { bubbles: true }));
  assert.equal(document.querySelectorAll(".row").length, 1, "window 1 collapsed again");

  headerFor("Window Current #1").click();
  assert.equal(document.querySelectorAll(".row").length, 4, "expanded back");
  setSort("recent");
});

test("UI - Sidepanel Sort - Window dots shown on every row when multiple windows", () => {
  const dots = qa(document, ".win-dot");
  assert.equal(dots.length, 4, "one dot per row");
  assert.equal(dots.filter((d) => d.classList.contains("current")).length, 3, "current-window rows use accent dot");
  const other = must(
    dots.find((d) => !d.classList.contains("current")),
    "other-window dot",
  );
  assert.ok(other.style.background, "other window dot has a palette color");
  assert.equal(other.title, "Window #2");
});

test("UI - Sidepanel Sort - Collapse-all button folds and unfolds every group", () => {
  const btn = byId("collapse-all");
  assert.equal(btn.hidden, true, "hidden outside window sort");

  setSort("window");
  assert.equal(btn.hidden, false, "visible with 2+ groups");
  assert.equal(btn.title, "Click to Collapse");

  btn.click();
  assert.equal(document.querySelectorAll(".row").length, 0, "all groups folded");
  assert.equal(document.querySelectorAll(".group-header").length, 2, "headers remain");
  assert.equal(btn.title, "Click to Expand");

  btn.click();
  assert.equal(document.querySelectorAll(".row").length, 4, "all groups unfolded");
  assert.equal(btn.title, "Click to Collapse");
  setSort("recent");
  assert.equal(btn.hidden, true);
});

test("UI - Sidepanel Sort - Window header checkbox selects that window's visible tabs", {
  skip: !GROUP_SELECT_ON, // WINDOW_GROUP_SELECT disabled in features.json
}, () => {
  setSort("window");
  const boxes = qa<HTMLInputElement>(document, ".group-header .group-select");
  assert.equal(boxes.length, 2, "one checkbox per window header");
  const firstBox = must(boxes[0], "window 1 header checkbox");
  const rowBox = q(document, '.row input[type="checkbox"]');
  assert.equal(window.getComputedStyle(firstBox).width, "14px", "explicit size, not platform default");
  assert.equal(
    window.getComputedStyle(firstBox).width,
    window.getComputedStyle(rowBox).width,
    "same size as row checkboxes",
  );

  assert.equal(firstBox.title, "Select window tabs", "tooltip before select");
  firstBox.click(); // window 1: tabs 1,2,3
  assert.match(byId("bulk-count").textContent, /3 selected/);
  const rowBoxes = qa<HTMLInputElement>(document, '.row input[type="checkbox"]');
  assert.equal(rowBoxes.filter((box) => box.checked).length, 3, "rows follow the group box");

  const freshBox = q<HTMLInputElement>(document, ".group-header .group-select"); // first match = freshBoxes[0]
  assert.equal(freshBox.checked, true, "group box checked after select");
  assert.equal(freshBox.title, "Unselect window tabs", "tooltip flips when checked");
  freshBox.click(); // unselect the window again
  assert.match(byId("bulk-count").textContent, /0 selected/);
});

test("UI - Sidepanel Sort - WINDOW_GROUP_SELECT off: headers carry no checkbox", {
  skip: GROUP_SELECT_ON, // WINDOW_GROUP_SELECT enabled in features.json
}, () => {
  setSort("window");
  assert.equal(document.querySelector(".group-header .group-select"), null);
});

test("UI - Sidepanel Sort - Window headers carry the window color dot", () => {
  setSort("window");
  const dots = qa(document, ".group-header .win-dot");
  assert.equal(dots.length, 2, "one dot per window header");
  const [currentDot, otherDot] = [must(dots[0], "window 1 dot"), must(dots[1], "window 2 dot")];
  assert.equal(window.getComputedStyle(currentDot).width, "6px", "dot actually has a size outside rows");
  assert.ok(currentDot.classList.contains("current"), "current window uses the accent dot");
  assert.ok(otherDot.style.background, "other window gets its palette color");
});

test("UI - Sidepanel Sort - Group by title: alphabetical groups, collapse + fold-all work", {
  skip: !GROUP_TITLE_ON, // GROUP_BY_TITLE disabled in features.json
}, () => {
  setSort("group-title");
  assert.equal(byId("sort-dir").dataset.dir, "desc", "group-title defaults to descending (biggest groups first)");
  const headers = qa(document, ".group-header .group-label").map((el) => el.textContent);
  assert.deepEqual(
    headers,
    ["Alpha", "Bravo", "Charlie", "Delta"],
    "one group per title, alphabetical (all size 1 → ties alphabetical under desc)",
  );
  assert.ok(
    qa(document, ".group-header .group-count").every((el) => el.textContent === "1/1"),
    "counts rendered separately",
  );
  assert.equal(byId("collapse-all").hidden, false, "fold-all available");
  assert.equal(document.querySelectorAll(".group-header .win-dot").length, 0, "no window dots in title grouping");

  q(document, ".group-header").click(); // collapse "Alpha"
  assert.equal(document.querySelectorAll(".row").length, 3, "collapsed group's row hidden");
  assert.match(q(document, ".group-header .fold-arrow").textContent, /▸/);
  q(document, ".group-header").click(); // expand again
  assert.equal(document.querySelectorAll(".row").length, 4);
  setSort("window");
});

test("UI - Sidepanel Sort - GROUP_BY_TITLE off: option hidden, stored pref falls back to window", {
  skip: GROUP_TITLE_ON, // GROUP_BY_TITLE enabled in features.json
}, async () => {
  const option = q<HTMLOptionElement>(document, '#sort option[value="group-title"]');
  assert.equal(option.hidden, true, "dropdown option hidden");
  setSort("group-title"); // simulates a stored preference from when the flag was on
  await tick();
  const headers = qa(document, ".group-header .group-label").map((el) => el.textContent);
  assert.ok(
    headers.every((h) => h.startsWith("Window")),
    "falls back to window grouping",
  );
  setSort("window");
});

test("UI - Sidepanel Sort - Groups collapse during search without touching pre-search state", () => {
  setSort("window");
  const search = byId<HTMLInputElement>("search");
  const type = (value: string) => {
    search.value = value;
    search.dispatchEvent(new window.Event("input", { bubbles: true }));
  };
  const headerFor = (needle: string) =>
    must(
      qa(document, ".group-header").find((el) => el.textContent.includes(needle)),
      `group header "${needle}"`,
    );

  headerFor("Window Current #1").click(); // collapse window 1 BEFORE searching
  assert.equal(document.querySelectorAll(".row").length, 1, "window 1 folded pre-search");

  type("a"); // matches tabs in both windows; search starts fully expanded
  assert.equal(document.querySelectorAll(".row").length, 4, "search auto-expands");

  headerFor("Window #2").click(); // fold a group WITHIN the search
  assert.equal(document.querySelectorAll(".row").length, 3, "group folds mid-search");
  assert.match(headerFor("Window #2").textContent, /▸/, "collapsed indicator shows");

  type(""); // search over: pre-search collapse state resumes
  assert.equal(document.querySelectorAll(".row").length, 1, "window 1 still folded, window 2 open");
  assert.ok(!headerFor("Window #2").textContent.includes("▸"), "search-time fold did not leak");
  headerFor("Window Current #1").click(); // restore expanded state for other tests
});

test("UI - Sidepanel Sort - Direction: pair swap, flat flip, grouped tri-state cycle", async () => {
  const dirBtn = byId("sort-dir");
  const sortSel = byId<HTMLSelectElement>("sort");

  setSort("recent");
  assert.equal(dirBtn.dataset.dir, "desc", "recent shows the desc glyph");
  byId("tab-list").scrollTop = 90;
  dirBtn.click();
  await tick();
  assert.equal(sortSel.value, "oldest", "smart swap to the paired option");
  assert.equal(dirBtn.dataset.dir, "asc");
  assert.deepEqual(titles(), ["Delta", "Charlie", "Alpha", "Bravo"], "list actually reversed");
  assert.equal(byId("tab-list").scrollTop, 0, "direction change scrolls to top");

  setSort("title");
  assert.equal(dirBtn.dataset.dir, "asc", "title starts ascending");
  dirBtn.click();
  await tick();
  assert.equal(sortSel.value, "title", "no paired option: dropdown unchanged");
  assert.deepEqual(titles(), ["Delta", "Charlie", "Bravo", "Alpha"], "title Z..A");
  assert.equal(dirBtn.dataset.dir, "desc");

  // grouped tri-state: none → desc (most tabs) → asc (fewest) → none
  setSort("window"); // window 1: 3 tabs, window 2: 1 tab
  assert.equal(dirBtn.dataset.dir, "none", "grouped sorts start in natural order");
  const firstHeader = () => q(document, ".group-header .group-label").textContent;
  assert.match(firstHeader(), /Window Current #1/, "natural: current window first");
  dirBtn.click();
  await tick();
  assert.equal(dirBtn.dataset.dir, "desc");
  assert.match(firstHeader(), /Window Current #1/, "most tabs first: window 1 (3 tabs)");
  dirBtn.click();
  await tick();
  assert.equal(dirBtn.dataset.dir, "asc");
  // two-list model: current window always leads; size orders the rest
  assert.match(firstHeader(), /Window Current #1/, "current window stays first under size sort");
  dirBtn.click();
  await tick();
  assert.equal(dirBtn.dataset.dir, "none", "cycle wraps back to natural");
});

test("UI - Sidepanel Sort - Sort memory: remember mode restores each sort's last direction", async () => {
  const dirBtn = byId("sort-dir");
  // clean slate: earlier tests' clicks persisted per-sort directions already
  stored.ui = { ...(stored.ui ?? {}), sortDirMode: "remember", sortDirections: {} };
  await chrome.storage.onChanged.fire({ ui: {} }, "local"); // refresh picks up the mode
  await new Promise((resolve) => setTimeout(resolve, 200)); // debounce

  setSort("title");
  dirBtn.click(); // title → desc, persisted per-sort
  await tick();
  assert.equal(dirBtn.dataset.dir, "desc");
  setSort("window");
  assert.equal(dirBtn.dataset.dir, "none", "window never used: canonical");
  setSort("title");
  assert.equal(dirBtn.dataset.dir, "desc", "title direction remembered");
  assert.deepEqual(titles(), ["Delta", "Charlie", "Bravo", "Alpha"], "restored order applied");

  stored.ui = { ...stored.ui, sortDirMode: "default" };
  await chrome.storage.onChanged.fire({ ui: {} }, "local");
  await new Promise((resolve) => setTimeout(resolve, 200));
  setSort("window");
  setSort("title");
  assert.equal(dirBtn.dataset.dir, "asc", "default mode: canonical on every change");
  setSort("window");
});

const GROUP_DOMAIN_ON = TEST_FEATURES.GROUP_BY_DOMAIN?.enabled === true;

test("UI - Sidepanel Sort - Group by domain: host groups with counts", {
  skip: !GROUP_DOMAIN_ON, // GROUP_BY_DOMAIN disabled in features.json
}, () => {
  setSort("group-domain");
  const headers = qa(document, ".group-header .group-label").map((el) => el.textContent);
  assert.deepEqual(
    headers,
    ["alpha.dev", "bb.aa", "mid.io", "zeta.org"],
    "one group per host (all size 1 → ties alphabetical under desc default)",
  );
  assert.ok(
    qa(document, ".group-header .group-count").every((el) => el.textContent === "1/1"),
    "counts rendered per group",
  );
  setSort("window");
});

test("UI - Sidepanel Sort - GROUP_BY_DOMAIN off: option hidden, stored pref falls back to window", {
  skip: GROUP_DOMAIN_ON, // GROUP_BY_DOMAIN enabled in features.json
}, async () => {
  const option = q<HTMLOptionElement>(document, '#sort option[value="group-domain"]');
  assert.equal(option.hidden, true, "dropdown option hidden");
  setSort("group-domain");
  await tick();
  const headers = qa(document, ".group-header .group-label").map((el) => el.textContent);
  assert.ok(
    headers.every((h) => h.startsWith("Window")),
    "falls back to window grouping",
  );
  setSort("window");
});

test("UI - Sidepanel Sort - Group by window is the last dropdown option", () => {
  const options = qa<HTMLOptionElement>(document, "#sort option");
  assert.equal(must(options[options.length - 1], "last sort option").value, "window");
});

test("UI - Sidepanel Sort - sort-dir hides with a lone group, like fold-all", () => {
  setSort("window");
  const dirBtn = byId("sort-dir");
  const scope = byId<HTMLSelectElement>("scope");
  assert.equal(dirBtn.hidden, false, "multiple window groups: visible");
  scope.value = "current-window";
  scope.dispatchEvent(new window.Event("change", { bubbles: true }));
  assert.equal(dirBtn.hidden, true, "lone group: direction hidden");
  assert.equal(byId("collapse-all").hidden, true, "same rule as fold-all");
  setSort("recent");
  assert.equal(dirBtn.hidden, false, "non-grouped sort: always visible");
  scope.value = "all-windows";
  scope.dispatchEvent(new window.Event("change", { bubbles: true }));
  setSort("window");
});

const GROUP_URL_ON = TEST_FEATURES.GROUP_BY_URL?.enabled === true;

test("UI - Sidepanel Sort - Group by URL: full-url groups with counts", {
  skip: !GROUP_URL_ON, // GROUP_BY_URL disabled in features.json
}, () => {
  setSort("group-url");
  const headers = qa(document, ".group-header .group-label").map((el) => el.textContent);
  assert.deepEqual(
    headers,
    ["https://alpha.dev/y", "https://bb.aa/q", "https://mid.io/z", "https://zeta.org/x"],
    "one group per url (all size 1 → ties alphabetical under desc default)",
  );
  assert.ok(
    qa(document, ".group-header .group-count").every((el) => el.textContent === "1/1"),
    "counts rendered per group",
  );
  setSort("window");
});

test("UI - Sidepanel Sort - GROUP_BY_URL off: option hidden, stored pref falls back to window", {
  skip: GROUP_URL_ON, // GROUP_BY_URL enabled in features.json
}, async () => {
  const option = q<HTMLOptionElement>(document, '#sort option[value="group-url"]');
  assert.equal(option.hidden, true, "dropdown option hidden");
  setSort("group-url");
  await tick();
  const headers = qa(document, ".group-header .group-label").map((el) => el.textContent);
  assert.ok(
    headers.every((h) => h.startsWith("Window")),
    "falls back to window grouping",
  );
  setSort("window");
});

test("UI - Sidepanel Sort - Window focus switch scrolls current window's group into view", async () => {
  setSort("window");
  await tick();
  const listEl = byId("tab-list");
  const scrolled: string[] = [];
  window.HTMLElement.prototype.scrollIntoView = function () {
    scrolled.push(this.className);
  };
  tabOf(4).active = true; // window 2's active tab
  chrome.windows.getLastFocused = async () => ({ id: 2 });
  listEl.scrollTop = 400; // pretend we're scrolled deep down
  await chrome.windows.onFocusChanged.fire(2);
  await new Promise((resolve) => setTimeout(resolve, 200)); // 150ms refresh debounce
  assert.equal(listEl.scrollTop, 0, "focus switch scrolls to top");
  assert.ok(
    scrolled.some((c) => c.includes("current")),
    "then reveals the current tab",
  );

  // same window again: plain refresh keeps scroll position
  listEl.scrollTop = 400;
  scrolled.length = 0;
  await chrome.windows.onFocusChanged.fire(2);
  await new Promise((resolve) => setTimeout(resolve, 200));
  assert.equal(listEl.scrollTop, 400, "no autoscroll without a window change");
  assert.equal(scrolled.length, 0);

  // restore fixture: window 1 focused, no active tab in window 2
  chrome.windows.getLastFocused = async () => ({ id: 1 });
  tabOf(4).active = false;
  await chrome.windows.onFocusChanged.fire(1);
  await new Promise((resolve) => setTimeout(resolve, 200));
  listEl.scrollTop = 0;
});

// regression guard: a revealed row (keyboard history, arrows) must not land under
// the sticky window header — asserts COMPUTED style, the rule hangs on a sibling combinator
test("UI - Sidepanel Sort - Rows under a sticky window header keep scroll-margin-top clear of it", async () => {
  setSort("window");
  await tick();
  const row = q(document, ".group-header ~ .row");
  assert.equal(window.getComputedStyle(row).scrollMarginTop, "2rem", "grouped row clears the header");
  setSort("recent");
  await tick();
  const flat = q(document, ".row");
  assert.equal(window.getComputedStyle(flat).scrollMarginTop, "", "flat sort: nothing to clear");
  setSort("window");
  await tick();
});

test("UI - Sidepanel Sort - Tab groups sort: ABC groups, ungrouped last, group menu", {
  skip: !(TEST_FEATURES.TAB_GROUPS?.enabled === true), // TAB_GROUPS disabled in features.json
}, async () => {
  // tabs 1,2 (win 1) → groups; 3,4 stay ungrouped
  tabOf(1).groupId = 7; // work
  tabOf(2).groupId = 8; // beta
  await chrome.tabs.onUpdated.fire(1, { groupId: 7 });
  await new Promise((resolve) => setTimeout(resolve, 200)); // refresh debounce
  setSort("group-tabgroup");
  await tick();
  assert.deepEqual(
    qa(document, ".group-header .group-label").map((el) => el.textContent),
    ["beta", "work", "No group"],
    "groups ABC by title, ungrouped bucket last",
  );

  // right-click a group header → tab-group menu
  const header = document.querySelector('.group-header[data-tab-group-id="7"]');
  assert.ok(header, "group header carries its group id");
  assert.ok(header.querySelector(".tg-square"), "group header marker is a square");
  assert.equal(header.querySelector(".win-dot"), null, "…not a circle");
  assert.equal(
    document.querySelector('.row[data-tab-id="1"] .tg-square'),
    null,
    "rows under a group header carry no redundant square",
  );
  header.dispatchEvent(new window.Event("contextmenu", { bubbles: true }));
  const menu = byId("ctx-menu");
  assert.equal(q(menu, ".ctx-title").textContent, "work", "menu header = group title");
  const items = qa(menu, ".ctx-item").map((el) => el.textContent);
  assert.ok(items.includes("Rename group…"), "rename offered");
  assert.ok(items.includes("Collapse in tab strip"), "strip collapse offered");
  assert.ok(items.includes("Ungroup 1 tab"), "ungroup with count");

  // pick a color → tabGroups.update
  calls.length = 0;
  must(
    qa(menu, ".ctx-item").find((el) => el.textContent === "Red"),
    "Red menu item",
  ).click();
  await tick();
  await tick();
  assert.ok(calls.includes('tabGroups.update 7 {"color":"red"}'), "color persisted via Chrome");
  document.body.click();

  // drag a grouped tab onto the "No group" header → ungrouped
  const rowOf = (id: number) => q(document, `.row[data-tab-id="${id}"]`);
  calls.length = 0;
  rowOf(1).dispatchEvent(new window.Event("dragstart", { bubbles: true }));
  const noGroup = document.querySelector('.group-header[data-tab-group-id="-1"]');
  assert.ok(noGroup, "ungrouped bucket is a drop target");
  noGroup.dispatchEvent(new window.Event("drop", { bubbles: true }));
  await tick();
  await tick();
  assert.ok(calls.includes("tabs.ungroup 1"), "drop on No group ungroups");
  tabOf(1).groupId = 7; // stub does mutate — keep grouped for the B section

  // B: window sort shows the runs as sub-headers; collapsing folds the rows
  setSort("window");
  await tick();
  const sub = document.querySelector<HTMLElement>('.tabgroup-header[data-tab-group-id="7"]');
  assert.ok(sub, "sub-header rendered inside the window group");
  assert.equal(q(sub, ".tg-title").textContent, "work");
  assert.ok(sub.querySelector(".win-dot"), "window indicator on the group line");
  assert.ok(sub.querySelector(".tg-square"), "…followed by the group square");
  assert.equal(q(sub, ".tg-count").textContent, "1/1", "visible/total like window headers");
  assert.match(
    must(sub.dataset.tip, "sub-header data-tip"),
    /Group "work"\n0\/1 selected tabs\n1\/1 visible tabs\nClick to collapse/,
    "hover tip mirrors the window-header info shape",
  );
  if (GROUP_SELECT_ON) {
    const box = sub.querySelector<HTMLInputElement>(".group-select");
    assert.ok(box, "sub-header carries the select checkbox");
    box.checked = true;
    box.dispatchEvent(new window.Event("click", { bubbles: true }));
    await tick();
    assert.equal(
      q<HTMLInputElement>(document, '.row[data-tab-id="1"] input').checked,
      true,
      "checkbox selects the run's tabs",
    );
    const boxAgain = q<HTMLInputElement>(document, '.tabgroup-header[data-tab-group-id="7"] .group-select');
    boxAgain.checked = false;
    boxAgain.dispatchEvent(new window.Event("click", { bubbles: true }));
    await tick();
  }
  assert.ok(document.querySelector('.row[data-tab-id="1"] .tg-square'), "grouped row carries the group square");
  assert.equal(document.querySelector('.row[data-tab-id="3"] .tg-square'), null, "ungrouped row has none");

  // flat sorts: square sits AFTER the window dot, no indent
  setSort("recent");
  await tick();
  const flatRow = q(document, '.row[data-tab-id="1"]');
  assert.ok(!flatRow.classList.contains("in-group"), "no nesting indent outside the window view");
  const flatKids = [...flatRow.children].map((el) => el.className.split(" ")[0]);
  assert.ok(
    flatKids.indexOf("win-dot") < flatKids.indexOf("tg-square"),
    `square after the window dot, got: ${flatKids.join(",")}`,
  );
  setSort("window");
  await tick();
  const rowsBefore = document.querySelectorAll(".row").length;
  sub.click();
  await tick();
  assert.equal(document.querySelectorAll(".row").length, rowsBefore - 1, "folded run hides its row");
  q(document, '.tabgroup-header[data-tab-group-id="7"]').click(); // unfold
  await tick();

  // drag & drop into groups (window sort still active from the B section)
  calls.length = 0;
  rowOf(4).dispatchEvent(new window.Event("dragstart", { bubbles: true })); // window 2, ungrouped
  q(document, '.tabgroup-header[data-tab-group-id="7"]').dispatchEvent(new window.Event("drop", { bubbles: true }));
  await tick();
  await tick();
  assert.ok(
    calls.some((c) => c.startsWith("tabs.move 4") && c.includes('"windowId":1')),
    "cross-window join moves into the group's window first",
  );
  assert.ok(calls.includes("tabs.group 4 7"), "then joins the group");
  await new Promise((resolve) => setTimeout(resolve, 200)); // refresh debounce

  calls.length = 0;
  rowOf(3).dispatchEvent(new window.Event("dragstart", { bubbles: true })); // win 1, ungrouped
  rowOf(1).dispatchEvent(new window.Event("drop", { bubbles: true })); // row inside group 7
  await tick();
  await tick();
  assert.ok(calls.includes("tabs.group 3 7"), "drop on a grouped row joins its group");
  await new Promise((resolve) => setTimeout(resolve, 200)); // refresh debounce

  // reorder INSIDE a group: move + re-group (tabs.move strips membership)
  tabOf(4).groupId = 7; // 1 and 4 now share group 7 (both win 1)
  tabOf(4).windowId = 1;
  await chrome.tabs.onUpdated.fire(4, { groupId: 7 });
  await new Promise((resolve) => setTimeout(resolve, 200));
  calls.length = 0;
  rowOf(4).dispatchEvent(new window.Event("dragstart", { bubbles: true }));
  rowOf(1).dispatchEvent(new window.Event("drop", { bubbles: true }));
  await tick();
  await tick();
  assert.ok(
    calls.some((c) => c.startsWith("tabs.move 4")),
    "in-group drop moves the tab",
  );
  assert.ok(calls.includes("tabs.group 4 7"), "membership restored after the move");
  await new Promise((resolve) => setTimeout(resolve, 200));

  // in-group reorder also works in the Tab groups sort (strip-ordered there)
  setSort("group-tabgroup");
  await tick();
  calls.length = 0;
  rowOf(1).dispatchEvent(new window.Event("dragstart", { bubbles: true }));
  rowOf(4).dispatchEvent(new window.Event("drop", { bubbles: true }));
  await tick();
  await tick();
  assert.ok(
    calls.some((c) => c.startsWith("tabs.move 1")),
    "reorder allowed in Tab groups sort",
  );
  assert.ok(calls.includes("tabs.group 1 7"), "membership kept there too");

  // restore fixture
  tabOf(4).windowId = 2;
  for (const id of [1, 2, 3, 4]) {
    tabOf(id).groupId = -1;
  }
  await chrome.tabs.onUpdated.fire(1, { groupId: -1 });
  await new Promise((resolve) => setTimeout(resolve, 200));
  setSort("window");
});
