import assert from "node:assert/strict";
import { test } from "node:test";
import { makeChrome, loadPage, tick, TEST_FEATURES } from "./helpers/ui.js";

const GROUP_SELECT_ON = TEST_FEATURES.WINDOW_GROUP_SELECT?.enabled === true;
const GROUP_TITLE_ON = TEST_FEATURES.GROUP_BY_TITLE?.enabled === true;

const NOW = Date.now();
const HOUR = 3_600_000;
const tabs = [
  { id: 1, windowId: 1, active: false, discarded: false, url: "https://zeta.org/x", title: "Charlie", lastAccessed: NOW - 3 * HOUR },
  { id: 2, windowId: 1, active: false, discarded: false, url: "https://alpha.dev/y", title: "Bravo", lastAccessed: NOW - 1 * HOUR },
  { id: 3, windowId: 1, active: false, discarded: false, url: "https://mid.io/z", title: "Alpha", lastAccessed: NOW - 2 * HOUR },
  { id: 4, windowId: 2, active: false, discarded: false, url: "https://bb.aa/q", title: "Delta", lastAccessed: NOW - 4 * HOUR },
];

const stored = {};
const chrome = makeChrome({ tabs, calls: [], stored });
loadPage("../../sidepanel/index.html", chrome);
await import("../sidepanel/sidepanel.js");
await tick();
await tick();

const titles = () => [...document.querySelectorAll(".row .title")].map((el) => el.textContent);
function setSort(value) {
  const select = document.getElementById("sort");
  select.value = value;
  select.dispatchEvent(new window.Event("change", { bubbles: true }));
}

test("UI - Sidepanel Sort - Default is Group by window on first launch", () => {
  assert.equal(document.getElementById("sort").value, "window");
  assert.equal(document.querySelectorAll(".group-header").length, 2, "grouped view by default");
  assert.equal(document.getElementById("collapse-all").hidden, false, "fold-all visible");
  const header = document.querySelector(".group-header");
  assert.match(
    header.dataset.tip,
    /Window Current #1\n0\/3 selected tabs\n3\/3 visible tabs\nClick to collapse/,
    "tip carries group, selection, visibility info + action",
  );
  header.dispatchEvent(new window.Event("mouseover", { bubbles: true }));
  const tip = document.getElementById("hover-tip");
  assert.equal(tip.hidden, false, "custom tip shows on hover");
  assert.match(tip.textContent, /0\/3 selected tabs/);
  document.getElementById("tab-list").dispatchEvent(new window.Event("mouseleave"));
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
  assert.deepEqual(titles(), ["Bravo", "Alpha", "Charlie", "Delta"], "current window recent-first, then window 2");
  const headers = [...document.querySelectorAll(".group-header")].map((el) => el.textContent);
  assert.deepEqual(headers, ["Window Current #13/3▾", "Window #21/1▾"], "name + counts + arrow spans");
  assert.deepEqual(
    [...document.querySelectorAll(".group-header .group-count")].map((el) => el.textContent),
    ["3/3", "1/1"],
    "counts in their own non-truncating span",
  );

  // filtered list → visible / total diverge
  const search = document.getElementById("search");
  search.value = "Bravo";
  search.dispatchEvent(new window.Event("input", { bubbles: true }));
  assert.deepEqual(
    [...document.querySelectorAll(".group-header")].map((el) => el.textContent),
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
  const headerFor = (needle) =>
    [...document.querySelectorAll(".group-header")].find((el) => el.textContent.includes(needle));

  headerFor("Window Current #1").click();
  assert.equal(document.querySelectorAll(".row").length, 1, "only window 2's row left");
  assert.match(headerFor("Window Current #1").textContent, /▸$/, "collapsed indicator at the right");
  assert.equal(document.querySelectorAll(".group-header").length, 2, "header stays visible");

  // search finds a tab inside the collapsed group → group auto-expands
  const search = document.getElementById("search");
  search.value = "Charlie";
  search.dispatchEvent(new window.Event("input", { bubbles: true }));
  assert.equal(document.querySelectorAll(".row").length, 1);
  assert.match(document.querySelector(".row .title").textContent, /Charlie/);
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
  const dots = [...document.querySelectorAll(".win-dot")];
  assert.equal(dots.length, 4, "one dot per row");
  assert.equal(dots.filter((d) => d.classList.contains("current")).length, 3, "current-window rows use accent dot");
  const other = dots.find((d) => !d.classList.contains("current"));
  assert.ok(other.style.background, "other window dot has a palette color");
  assert.equal(other.title, "Window #2");
});

test("UI - Sidepanel Sort - Collapse-all button folds and unfolds every group", () => {
  const btn = document.getElementById("collapse-all");
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

test(
  "UI - Sidepanel Sort - Window header checkbox selects that window's visible tabs",
  { skip: !GROUP_SELECT_ON && "WINDOW_GROUP_SELECT disabled in features.json" },
  () => {
    setSort("window");
    const boxes = document.querySelectorAll(".group-header .group-select");
    assert.equal(boxes.length, 2, "one checkbox per window header");
    const rowBox = document.querySelector('.row input[type="checkbox"]');
    assert.equal(window.getComputedStyle(boxes[0]).width, "14px", "explicit size, not platform default");
    assert.equal(
      window.getComputedStyle(boxes[0]).width,
      window.getComputedStyle(rowBox).width,
      "same size as row checkboxes",
    );

    assert.equal(boxes[0].title, "Select window tabs", "tooltip before select");
    boxes[0].click(); // window 1: tabs 1,2,3
    assert.match(document.getElementById("bulk-count").textContent, /3 selected/);
    const rowBoxes = [...document.querySelectorAll('.row input[type="checkbox"]')];
    assert.equal(rowBoxes.filter((box) => box.checked).length, 3, "rows follow the group box");

    const freshBoxes = document.querySelectorAll(".group-header .group-select");
    assert.equal(freshBoxes[0].checked, true, "group box checked after select");
    assert.equal(freshBoxes[0].title, "Unselect window tabs", "tooltip flips when checked");
    freshBoxes[0].click(); // unselect the window again
    assert.match(document.getElementById("bulk-count").textContent, /0 selected/);
  },
);

test(
  "UI - Sidepanel Sort - WINDOW_GROUP_SELECT off: headers carry no checkbox",
  { skip: GROUP_SELECT_ON && "WINDOW_GROUP_SELECT enabled in features.json" },
  () => {
    setSort("window");
    assert.equal(document.querySelector(".group-header .group-select"), null);
  },
);

test("UI - Sidepanel Sort - Window headers carry the window color dot", () => {
  setSort("window");
  const dots = document.querySelectorAll(".group-header .win-dot");
  assert.equal(dots.length, 2, "one dot per window header");
  assert.equal(window.getComputedStyle(dots[0]).width, "6px", "dot actually has a size outside rows");
  assert.ok(dots[0].classList.contains("current"), "current window uses the accent dot");
  assert.ok(dots[1].style.background, "other window gets its palette color");
});

test(
  "UI - Sidepanel Sort - Group by title: alphabetical groups, collapse + fold-all work",
  { skip: !GROUP_TITLE_ON && "GROUP_BY_TITLE disabled in features.json" },
  () => {
  setSort("group-title");
  assert.equal(
    document.getElementById("sort-dir").dataset.dir,
    "desc",
    "group-title defaults to descending (biggest groups first)",
  );
  const headers = [...document.querySelectorAll(".group-header .group-label")].map((el) => el.textContent);
  assert.deepEqual(
    headers,
    ["Alpha", "Bravo", "Charlie", "Delta"],
    "one group per title, alphabetical (all size 1 → ties alphabetical under desc)",
  );
  assert.ok(
    [...document.querySelectorAll(".group-header .group-count")].every((el) => el.textContent === "1/1"),
    "counts rendered separately",
  );
  assert.equal(document.getElementById("collapse-all").hidden, false, "fold-all available");
  assert.equal(document.querySelectorAll(".group-header .win-dot").length, 0, "no window dots in title grouping");

  document.querySelectorAll(".group-header")[0].click(); // collapse "Alpha"
  assert.equal(document.querySelectorAll(".row").length, 3, "collapsed group's row hidden");
  assert.match(document.querySelectorAll(".group-header .fold-arrow")[0].textContent, /▸/);
  document.querySelectorAll(".group-header")[0].click(); // expand again
  assert.equal(document.querySelectorAll(".row").length, 4);
  setSort("window");
  },
);

test(
  "UI - Sidepanel Sort - GROUP_BY_TITLE off: option hidden, stored pref falls back to window",
  { skip: GROUP_TITLE_ON && "GROUP_BY_TITLE enabled in features.json" },
  async () => {
    const option = document.querySelector('#sort option[value="group-title"]');
    assert.equal(option.hidden, true, "dropdown option hidden");
    setSort("group-title"); // simulates a stored preference from when the flag was on
    await tick();
    const headers = [...document.querySelectorAll(".group-header .group-label")].map((el) => el.textContent);
    assert.ok(headers.every((h) => h.startsWith("Window")), "falls back to window grouping");
    setSort("window");
  },
);

test("UI - Sidepanel Sort - Groups collapse during search without touching pre-search state", () => {
  setSort("window");
  const search = document.getElementById("search");
  const type = (value) => {
    search.value = value;
    search.dispatchEvent(new window.Event("input", { bubbles: true }));
  };
  const headerFor = (needle) =>
    [...document.querySelectorAll(".group-header")].find((el) => el.textContent.includes(needle));

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
  const dirBtn = document.getElementById("sort-dir");
  const sortSel = document.getElementById("sort");

  setSort("recent");
  assert.equal(dirBtn.dataset.dir, "desc", "recent shows the desc glyph");
  document.getElementById("tab-list").scrollTop = 90;
  dirBtn.click();
  await tick();
  assert.equal(sortSel.value, "oldest", "smart swap to the paired option");
  assert.equal(dirBtn.dataset.dir, "asc");
  assert.deepEqual(titles(), ["Delta", "Charlie", "Alpha", "Bravo"], "list actually reversed");
  assert.equal(document.getElementById("tab-list").scrollTop, 0, "direction change scrolls to top");

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
  const firstHeader = () => document.querySelector(".group-header .group-label").textContent;
  assert.match(firstHeader(), /Window Current #1/, "natural: current window first");
  dirBtn.click();
  await tick();
  assert.equal(dirBtn.dataset.dir, "desc");
  assert.match(firstHeader(), /Window Current #1/, "most tabs first: window 1 (3 tabs)");
  dirBtn.click();
  await tick();
  assert.equal(dirBtn.dataset.dir, "asc");
  assert.match(firstHeader(), /Window #2/, "fewest tabs first: window 2 (1 tab)");
  dirBtn.click();
  await tick();
  assert.equal(dirBtn.dataset.dir, "none", "cycle wraps back to natural");
});

test("UI - Sidepanel Sort - Sort memory: remember mode restores each sort's last direction", async () => {
  const dirBtn = document.getElementById("sort-dir");
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

test(
  "UI - Sidepanel Sort - Group by domain: host groups with counts",
  { skip: !GROUP_DOMAIN_ON && "GROUP_BY_DOMAIN disabled in features.json" },
  () => {
    setSort("group-domain");
    const headers = [...document.querySelectorAll(".group-header .group-label")].map((el) => el.textContent);
    assert.deepEqual(
      headers,
      ["alpha.dev", "bb.aa", "mid.io", "zeta.org"],
      "one group per host (all size 1 → ties alphabetical under desc default)",
    );
    assert.ok(
      [...document.querySelectorAll(".group-header .group-count")].every((el) => el.textContent === "1/1"),
      "counts rendered per group",
    );
    setSort("window");
  },
);

test(
  "UI - Sidepanel Sort - GROUP_BY_DOMAIN off: option hidden, stored pref falls back to window",
  { skip: GROUP_DOMAIN_ON && "GROUP_BY_DOMAIN enabled in features.json" },
  async () => {
    const option = document.querySelector('#sort option[value="group-domain"]');
    assert.equal(option.hidden, true, "dropdown option hidden");
    setSort("group-domain");
    await tick();
    const headers = [...document.querySelectorAll(".group-header .group-label")].map((el) => el.textContent);
    assert.ok(headers.every((h) => h.startsWith("Window")), "falls back to window grouping");
    setSort("window");
  },
);

test("UI - Sidepanel Sort - Group by window is the last dropdown option", () => {
  const options = [...document.querySelectorAll("#sort option")];
  assert.equal(options[options.length - 1].value, "window");
});

test("UI - Sidepanel Sort - sort-dir hides with a lone group, like fold-all", () => {
  setSort("window");
  const dirBtn = document.getElementById("sort-dir");
  const scope = document.getElementById("scope");
  assert.equal(dirBtn.hidden, false, "multiple window groups: visible");
  scope.value = "current-window";
  scope.dispatchEvent(new window.Event("change", { bubbles: true }));
  assert.equal(dirBtn.hidden, true, "lone group: direction hidden");
  assert.equal(document.getElementById("collapse-all").hidden, true, "same rule as fold-all");
  setSort("recent");
  assert.equal(dirBtn.hidden, false, "non-grouped sort: always visible");
  scope.value = "all-windows";
  scope.dispatchEvent(new window.Event("change", { bubbles: true }));
  setSort("window");
});
