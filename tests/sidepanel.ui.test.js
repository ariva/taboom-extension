import assert from "node:assert/strict";
import { test } from "node:test";
import { makeChrome, loadPage, tick, TEST_FEATURES } from "./helpers/ui.js";

const AUTO_ALL_ON = TEST_FEATURES.SEARCH_AUTO_SELECT_ALL?.enabled === true;

const NOW = Date.now();
const tabs = [
  { id: 1, windowId: 1, active: true, discarded: false, pinned: false, audible: false,
    url: "https://github.com/pr/1", title: "My Pull Request", lastAccessed: NOW },
  { id: 2, windowId: 1, active: false, discarded: true, pinned: false, audible: false,
    url: "https://youtube.com/watch", title: "Some Video", lastAccessed: NOW - 3_600_000 },
  { id: 3, windowId: 2, active: true, discarded: false, pinned: true, audible: false,
    url: "https://mail.google.com/inbox", title: "Inbox", lastAccessed: NOW - 60_000 },
];

const calls = [];
const chrome = makeChrome({
  tabs,
  calls,
  stored: {
    protectionRules: [{ id: "r1", type: "host", pattern: "mail.google.com" }],
    ui: { defaultFilter: "all", scope: "all-windows", sort: "recent", theme: "dark", density: "compact" },
  },
});
loadPage("../../sidepanel/index.html", chrome);
await import("../sidepanel/sidepanel.js");
await tick();
await tick();

test("UI - Sidepanel - Renders one row per tab with filter counts", () => {
  assert.equal(document.querySelectorAll(".row").length, 3);
  const counts = [...document.querySelectorAll("#filters .count")].map((el) => el.textContent);
  assert.deepEqual(counts, ["3", "2", "1", "1"], "all/awake/snoozed/protected");
});

test("UI - Sidepanel - Current window's active tab is marked, other window's is not", () => {
  const current = document.querySelector(".row.active-tab.current");
  assert.ok(current, "row 1 has .current (windowId 1 = last focused)");
  assert.match(current.textContent, /My Pull Request/);
  const other = [...document.querySelectorAll(".row.active-tab:not(.current)")];
  assert.equal(other.length, 1);
  assert.match(other[0].textContent, /Inbox/);
});

test("UI - Sidepanel - Badges: snoozed=warn, protected=ok, pinned plain", () => {
  assert.match(document.querySelector(".badge.warn")?.textContent, /snoozed/);
  assert.match(document.querySelector(".badge.ok")?.textContent, /protected/);
  const pinned = [...document.querySelectorAll(".badge")].find((b) => b.textContent === "pinned");
  assert.ok(pinned && !pinned.classList.contains("ok") && !pinned.classList.contains("warn"));
});

test("UI - Sidepanel - UI prefs applied: dark theme + compact density", () => {
  assert.equal(document.documentElement.style.colorScheme, "dark");
  assert.ok(document.getElementById("tab-list").classList.contains("compact"));
});

test("UI - Sidepanel - Search narrows list; no match shows empty state; Escape clears", () => {
  const counts = () => [...document.querySelectorAll("#filters .count")].map((el) => el.textContent);
  const search = document.getElementById("search");
  search.value = "inbox";
  search.dispatchEvent(new window.Event("input", { bubbles: true }));
  assert.equal(document.querySelectorAll(".row").length, 1);
  // active search: chips count the FOUND items (Inbox: awake + protected)
  assert.deepEqual(counts(), ["1", "1", "0", "1"], "counts follow search matches");

  search.value = "zzz-nothing";
  search.dispatchEvent(new window.Event("input", { bubbles: true }));
  assert.equal(document.querySelectorAll(".row").length, 0);
  assert.match(document.querySelector(".empty").textContent, /No tabs match/);
  assert.deepEqual(counts(), ["0", "0", "0", "0"], "no matches: all chips zero");

  document.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  assert.equal(document.querySelectorAll(".row").length, 3);
  assert.deepEqual(counts(), ["3", "2", "1", "1"], "clearing search restores full counts");
});

test(
  "UI - Sidepanel - Hidden-matches behavior: keep filter by default, switch to All when opted in",
  { skip: !AUTO_ALL_ON && "SEARCH_AUTO_SELECT_ALL disabled in features.json" },
  async () => {
    const search = document.getElementById("search");
    const type = (value) => {
      search.value = value;
      search.dispatchEvent(new window.Event("input", { bubbles: true }));
    };

    // default (searchEmptyFilter "keep"): flag alone must NOT jump
    document.querySelector('#filters button[data-filter="snoozed"]').click();
    type("inbox"); // Inbox is awake: 0 snoozed matches
    assert.equal(document.querySelectorAll(".row").length, 0, "default: filter kept");
    document.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Escape", bubbles: true }));

    // opt in via the Customization setting
    const { ui } = await chrome.storage.local.get("ui");
    await chrome.storage.local.set({ ui: { ...ui, searchEmptyFilter: "all" } });
    await chrome.storage.onChanged.fire({ ui: { newValue: {} } }, "local");
    await new Promise((resolve) => setTimeout(resolve, 200)); // refresh debounce

    document.querySelector('#filters button[data-filter="snoozed"]').click();
    type("inbox");
    assert.equal(document.querySelectorAll(".row").length, 1, "match visible after auto-jump");
    assert.equal(
      document.querySelector('#filters button[data-filter="all"]').getAttribute("aria-pressed"),
      "true",
      "All filter auto-selected",
    );
    document.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    document.querySelector('#filters button[data-filter="all"]').click();

    await chrome.storage.local.set({ ui: { ...ui, searchEmptyFilter: "keep" } });
    await chrome.storage.onChanged.fire({ ui: { newValue: {} } }, "local");
    await new Promise((resolve) => setTimeout(resolve, 200));
  },
);

test(
  "UI - Sidepanel - SEARCH_AUTO_SELECT_ALL off: empty filter stays put during search",
  { skip: AUTO_ALL_ON && "SEARCH_AUTO_SELECT_ALL enabled in features.json" },
  () => {
    const search = document.getElementById("search");
    document.querySelector('#filters button[data-filter="snoozed"]').click();
    search.value = "inbox"; // Inbox is awake: 0 snoozed matches
    search.dispatchEvent(new window.Event("input", { bubbles: true }));
    assert.equal(document.querySelectorAll(".row").length, 0, "no rows: filter kept");
    assert.equal(
      document.querySelector('#filters button[data-filter="snoozed"]').getAttribute("aria-pressed"),
      "true",
      "snoozed filter still selected",
    );
    document.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    document.querySelector('#filters button[data-filter="all"]').click();
  },
);

test("UI - Sidepanel - Snoozed filter shows only discarded tabs", () => {
  document.querySelector('#filters button[data-filter="snoozed"]').click();
  const rows = document.querySelectorAll(".row");
  assert.equal(rows.length, 1);
  assert.match(rows[0].textContent, /Some Video/);
  document.querySelector('#filters button[data-filter="all"]').click();
});

test("UI - Sidepanel - Bulk bar appears on selection; Wake reloads only discarded tabs", async () => {
  assert.equal(document.getElementById("bulk-bar").hidden, false, "bar always visible");
  assert.equal(document.getElementById("bulk-snooze").disabled, true, "actions disabled with no selection");
  // select all visible via the select-all checkbox
  const selectAll = document.getElementById("select-all");
  selectAll.checked = true;
  selectAll.dispatchEvent(new window.Event("change", { bubbles: true }));
  assert.equal(document.getElementById("bulk-snooze").disabled, false, "actions enabled with selection");
  assert.match(document.getElementById("bulk-count").textContent, /3 selected/);

  calls.length = 0;
  document.getElementById("bulk-wake").click();
  await tick();
  const reloads = calls.filter((c) => c.startsWith("tabs.reload"));
  assert.deepEqual(reloads, ["tabs.reload 2"], "only the discarded tab is reloaded");
});

test("UI - Sidepanel - Activating a row scrolls the current tab into view after re-render", async () => {
  const scrolled = [];
  window.HTMLElement.prototype.scrollIntoView = function () {
    scrolled.push(this.className);
  };
  // click a non-active row → activate() → event-driven refresh re-renders
  const listEl = document.getElementById("tab-list");
  listEl.scrollTop = 500; // pretend we're scrolled deep down
  const rows = [...document.querySelectorAll(".row")];
  rows.find((r) => !r.classList.contains("current")).click();
  await tick();
  await chrome.tabs.onActivated.fire({});
  await new Promise((resolve) => setTimeout(resolve, 200)); // 150ms debounce
  // activated tab sorts to the top → full scroll to top (not just nearest)
  assert.equal(listEl.scrollTop, 0, "list scrolled fully to top");
  // a plain event-driven refresh must NOT autoscroll
  listEl.scrollTop = 500;
  scrolled.length = 0;
  await chrome.tabs.onActivated.fire({});
  await new Promise((resolve) => setTimeout(resolve, 200));
  assert.equal(listEl.scrollTop, 500, "no follow without user activation");
  assert.equal(scrolled.length, 0);
});

// regression guard: [hidden] must actually hide even when author CSS sets a
// display value (.icon-btn is inline-flex, footer is flex) — asserts COMPUTED style
test("UI - Sidepanel - [hidden] beats author display rules (computed style)", () => {
  const btn = document.getElementById("collapse-all");
  btn.hidden = true;
  assert.equal(window.getComputedStyle(btn).display, "none", "hidden icon-btn not displayed");
  btn.hidden = false;
  assert.notEqual(window.getComputedStyle(btn).display, "none");

  const bar = document.getElementById("bulk-bar");
  assert.notEqual(window.getComputedStyle(bar).display, "none", "bulk bar always visible");
  assert.equal(window.getComputedStyle(bar).flexWrap, "wrap", "narrow panel: buttons wrap, not crop");
  bar.hidden = true;
  assert.equal(window.getComputedStyle(bar).display, "none");
  bar.hidden = false;
});

test("UI - Sidepanel - Scroll position is per filter; search starts at top and restores", async () => {
  const list = document.getElementById("tab-list");
  const filter = (name) => document.querySelector(`#filters button[data-filter="${name}"]`).click();

  filter("all");
  list.scrollTop = 120;
  filter("awake");
  assert.equal(list.scrollTop, 0, "fresh filter starts at top");
  list.scrollTop = 60;
  filter("all");
  assert.equal(list.scrollTop, 120, "all-filter position restored");
  filter("awake");
  assert.equal(list.scrollTop, 60, "awake-filter position restored");

  const search = document.getElementById("search");
  search.value = "zzz";
  search.dispatchEvent(new window.Event("input", { bubbles: true }));
  assert.equal(list.scrollTop, 0, "search resets to top");
  search.value = "";
  search.dispatchEvent(new window.Event("input", { bubbles: true }));
  assert.equal(list.scrollTop, 60, "clearing search restores filter position");
});

// covers the delegated #tab-list click dispatch + template variant pruning
test("UI - Sidepanel - Row action buttons dispatch per-tab actions without activating", async () => {
  document.querySelector('#filters button[data-filter="all"]').click(); // previous test leaves "awake"
  const row = (id) => document.querySelector(`.row[data-tab-id="${id}"]`);

  // template prunes per row: no snooze on discarded, one protect variant kept
  assert.equal(row(2).querySelector('[data-action="snooze"]'), null, "no snooze button on discarded tab");
  assert.ok(row(1).querySelector('[data-icon="protect"]'), "unprotected tab keeps protect icon");
  assert.equal(row(1).querySelector('[data-icon="unprotect"]'), null);
  assert.ok(row(3).querySelector('[data-icon="unprotect"]'), "protected tab keeps unprotect icon");
  assert.equal(row(3).querySelector('[data-action="toggle-protect"]').title, "Unprotect site");
  assert.equal(row(1).querySelector('[data-action="toggle-protect"]').title, "Protect site");

  calls.length = 0;
  row(1).querySelector('input[type="checkbox"]').click();
  await tick();
  assert.match(document.getElementById("bulk-count").textContent, /1 selected/, "checkbox selects only its tab");

  row(1).querySelector('[data-action="snooze"]').click();
  await tick();
  assert.ok(calls.includes("sendMessage snooze-tab"), "snooze message sent");

  row(1).querySelector('[data-action="toggle-protect"]').click();
  await tick();
  assert.ok(calls.includes("sendMessage toggle-site-protection"), "protect message sent");

  row(1).querySelector('[data-action="close"]').click();
  await tick();
  assert.ok(calls.some((c) => c.startsWith("tabs.remove 1")), "close removes the tab");

  // none of the above may fall through to row activation
  assert.ok(!calls.some((c) => c.startsWith("windows.update")), "button clicks never activate the row");
});

test("UI - Sidepanel - Own ui-prefs storage echo is ignored; foreign ui change re-renders", async () => {
  calls.length = 0;
  document.querySelector('#filters button[data-filter="awake"]').click();
  const firstRow = document.querySelector(".row");
  assert.ok(firstRow, "filter click rendered");

  // deliver the storage echo of exactly what the click persisted
  const lastSet = calls.filter((c) => c.startsWith("storage.set")).at(-1);
  const { ui } = JSON.parse(lastSet.slice("storage.set ".length));
  await chrome.storage.onChanged.fire({ ui: { newValue: ui } });
  await new Promise((resolve) => setTimeout(resolve, 200)); // past the 150ms debounce
  assert.equal(document.querySelector(".row"), firstRow, "own echo: no second render");

  // a change written elsewhere (e.g. options page) must still re-render
  await chrome.storage.onChanged.fire({ ui: { newValue: { ...ui, density: "comfortable" } } });
  await new Promise((resolve) => setTimeout(resolve, 200));
  assert.notEqual(document.querySelector(".row"), firstRow, "foreign ui change re-renders");

  document.querySelector('#filters button[data-filter="all"]').click();
});

// in-search scroll positions live in their own per-filter map: switching
// filters mid-search remembers positions within the results, while the
// pre-search positions survive untouched and come back once the search clears
test("UI - Sidepanel - Mid-search filter positions are separate from pre-search ones", () => {
  const list = document.getElementById("tab-list");
  const filter = (name) => document.querySelector(`#filters button[data-filter="${name}"]`).click();
  const search = document.getElementById("search");
  const type = (value) => {
    search.value = value;
    search.dispatchEvent(new window.Event("input", { bubbles: true }));
  };

  filter("awake");
  list.scrollTop = 77;
  filter("all"); // saves awake→77
  list.scrollTop = 150;

  type("e"); // entering search saves all→150, results start at top
  assert.equal(list.scrollTop, 0, "search starts at top");
  list.scrollTop = 40; // scroll within search results
  filter("awake"); // in-search: all→40 saved; awake not visited in this search yet
  assert.equal(list.scrollTop, 0, "first mid-search visit of a filter starts at top");
  list.scrollTop = 15;
  filter("all"); // in-search: awake→15 saved
  assert.equal(list.scrollTop, 40, "in-search position remembered per filter");

  type(""); // clearing restores the PRE-search position of the current filter
  assert.equal(list.scrollTop, 150, "pre-search position survives mid-search filter clicks");
  filter("awake");
  assert.equal(list.scrollTop, 77, "other filter's pre-search position intact too");
});

test("UI - Sidepanel - History dropdown caret flips with the popover toggle event", () => {
  const btn = document.getElementById("hist-list-btn");
  const pop = document.getElementById("history-pop");
  assert.ok(btn.querySelector(".caret-closed") && btn.querySelector(".caret-open"), "both variants present");

  const toggle = (newState) => {
    const event = new window.Event("toggle");
    event.newState = newState;
    pop.dispatchEvent(event);
  };
  toggle("open");
  assert.ok(btn.classList.contains("open"), "open state flips caret up");
  assert.equal(btn.title, "Hide Navigation History");
  toggle("closed");
  assert.ok(!btn.classList.contains("open"), "closed state flips caret back down");
  assert.equal(btn.title, "Show Navigation History");
});

test("UI - Sidepanel - Long-press on a history arrow opens the popover instead of navigating", async () => {
  const back = document.getElementById("hist-back");
  const pop = document.getElementById("history-pop");
  back.disabled = false; // gesture wiring under test, not the disabled logic
  const pointer = (type, button = 0) => {
    const event = new window.Event(type, { bubbles: true });
    event.button = button;
    back.dispatchEvent(event);
  };

  // hold past the threshold → release opens the popover, click is swallowed
  calls.length = 0;
  pointer("pointerdown");
  await new Promise((resolve) => setTimeout(resolve, 550));
  pointer("pointerup");
  await tick();
  assert.ok(pop.querySelector(".hist-head"), "popover filled on long-press release");
  back.click();
  assert.ok(!calls.includes("sendMessage history-back"), "hold's click does not navigate");

  // quick click (no hold) still navigates
  pointer("pointerdown");
  pointer("pointerup");
  back.click();
  await tick();
  assert.ok(calls.includes("sendMessage history-back"), "plain click still goes back");
});

test("UI - Sidepanel - Open history popover live-refreshes when the trail changes", async () => {
  const pop = document.getElementById("history-pop");
  await chrome.storage.local.set({ tabHistory: { stack: [1, 2], cursor: 1 } });
  pop.matches = () => true; // simulate :popover-open (no popover engine in happy-dom)
  await chrome.storage.onChanged.fire({ tabHistory: {} }, "local");
  await tick();
  assert.equal(pop.querySelectorAll(".hist-row").length, 2, "rows refilled from the new trail");
  assert.match(pop.querySelector(".hist-row.current").textContent, /Some Video|2/, "cursor row marked");

  pop.matches = () => false; // closed popover: no refill
  pop.textContent = "";
  await chrome.storage.onChanged.fire({ tabHistory: {} }, "local");
  await tick();
  assert.equal(pop.querySelectorAll(".hist-row").length, 0, "closed popover left alone");
  delete pop.matches;
});

test("UI - Sidepanel - Focus transitions close the popup and announce themselves", async () => {
  const pop = document.getElementById("history-pop");
  const hides = [];
  pop.hidePopover = () => hides.push(1);
  calls.length = 0;
  window.dispatchEvent(new window.Event("blur"));
  await tick();
  assert.equal(hides.length, 1, "popup closed on focus loss");
  assert.ok(calls.includes("sendMessage sidebar-no-focus"), "focus loss announced");

  window.dispatchEvent(new window.Event("focus"));
  await tick();
  assert.ok(calls.includes("sendMessage sidebar-focused"), "focus gain announced");
  assert.equal(hides.length, 1, "gaining focus closes nothing");
  delete pop.hidePopover;
});

test("UI - Sidepanel - Navigation mode switch closes an open history popup", async () => {
  const pop = document.getElementById("history-pop");
  const hides = [];
  pop.hidePopover = () => hides.push(1);
  await chrome.storage.onChanged.fire(
    { ui: { oldValue: { historyNav: "traditional" }, newValue: { historyNav: "compact" } } },
    "local",
  );
  await tick();
  assert.equal(hides.length, 1, "mode change hides the popup");

  await chrome.storage.onChanged.fire(
    { ui: { oldValue: { historyNav: "compact", theme: "dark" }, newValue: { historyNav: "compact", theme: "light" } } },
    "local",
  );
  await tick();
  assert.equal(hides.length, 1, "unrelated ui change leaves it open");
  delete pop.hidePopover;
});

test("UI - Sidepanel - Right-click on an arrow with open popup closes it", async () => {
  const back = document.getElementById("hist-back");
  const pop = document.getElementById("history-pop");
  back.disabled = false;
  const hides = [];
  pop.matches = () => true; // popup open at gesture start
  pop.hidePopover = () => hides.push(1);
  pop.textContent = "sentinel";
  const pointer = (type, button) => {
    const event = new window.Event(type, { bubbles: true });
    event.button = button;
    back.dispatchEvent(event);
  };
  pointer("pointerdown", 2);
  pop.matches = () => false; // light dismiss closed it mid-gesture
  pointer("pointerup", 2);
  await tick();
  assert.equal(hides.length, 1, "gesture closes, not reopens");
  assert.equal(pop.textContent, "sentinel", "popup not refilled");

  // popup closed at gesture start: right-click opens as before
  pointer("pointerdown", 2);
  pointer("pointerup", 2);
  await tick();
  assert.ok(pop.querySelector(".hist-head"), "opens when it was closed");
  delete pop.matches;
  delete pop.hidePopover;
});

test("UI - Sidepanel - History entry X sends history-remove with the entry's index", async () => {
  const pop = document.getElementById("history-pop");
  await chrome.storage.local.set({ tabHistory: { stack: [1, 2], cursor: 1 } });
  pop.matches = () => true; // "open" so the storage echo fills the rows
  await chrome.storage.onChanged.fire({ tabHistory: {} }, "local");
  await tick();
  const items = pop.querySelectorAll(".hist-item");
  assert.equal(items.length, 2, "one item per entry, each with its X");

  calls.length = 0;
  items[0].querySelector(".hist-x").click(); // newest-first: top item is stack index 1
  await tick();
  assert.ok(calls.includes("sendMessage history-remove"), "remove message sent");
  pop.matches = () => false;
  delete pop.matches;
});

test("UI - Sidepanel - Escape with open history popover leaves the search alone", () => {
  const search = document.getElementById("search");
  search.value = "abc";
  search.dispatchEvent(new window.Event("input", { bubbles: true }));
  const pop = document.getElementById("history-pop");
  pop.matches = () => true; // happy-dom has no :popover-open — simulate "open"
  document.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  assert.equal(search.value, "abc", "search untouched while popover open (Esc closes popover natively)");
  pop.matches = () => false;
  document.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  assert.equal(search.value, "", "next Escape clears the search as usual");
  delete pop.matches;
});

test("UI - Sidepanel - Scope and sort changes reset scroll and forget saved positions", () => {
  const list = document.getElementById("tab-list");
  const filter = (name) => document.querySelector(`#filters button[data-filter="${name}"]`).click();
  const select = (id, value) => {
    const el = document.getElementById(id);
    el.value = value;
    el.dispatchEvent(new window.Event("change", { bubbles: true }));
  };

  filter("all");
  list.scrollTop = 130;
  select("scope", "current-window");
  assert.equal(list.scrollTop, 0, "scope switch starts at top");

  list.scrollTop = 90;
  filter("awake"); // saves all→90 in the new scope
  filter("all");
  assert.equal(list.scrollTop, 90, "positions saved after the switch still work");

  select("sort", "title");
  assert.equal(list.scrollTop, 0, "sort switch also resets");
  filter("awake");
  assert.equal(list.scrollTop, 0, "old positions forgotten after sort change");

  select("sort", "recent");
  select("scope", "all-windows");
  assert.equal(list.scrollTop, 0, "switching back also resets");
});

test("UI - Sidepanel - Update nudge: dismissible, silent for the same version, back for a newer one", async () => {
  const banner = document.getElementById("update-banner");
  await chrome.storage.local.set({ updateAvailable: "9.9.9" });
  await chrome.storage.onChanged.fire({ updateAvailable: {} }, "local");
  await tick();
  assert.equal(banner.hidden, false, "nudge shows");
  assert.match(
    document.getElementById("update-restart").textContent,
    /Update 9\.9\.9 ready — click to update or restart Taboom/,
    "text tells the user to click",
  );
  assert.match(
    document.getElementById("update-restart").title,
    /restart Taboom and apply the update/,
    "restart tooltip explains the click",
  );
  assert.match(
    document.getElementById("update-dismiss").title,
    /Closes this notice/,
    "dismiss tooltip explains the close",
  );

  calls.length = 0;
  document.getElementById("update-dismiss").click();
  await tick();
  assert.ok(!calls.includes("runtime.reload"), "dismiss must not restart the extension");
  await chrome.storage.onChanged.fire({ dismissedUpdate: {} }, "local"); // storage echo
  await tick();
  assert.equal(banner.hidden, true, "dismiss hides the nudge");
  const { dismissedUpdate } = await chrome.storage.local.get("dismissedUpdate");
  assert.equal(dismissedUpdate, "9.9.9", "dismissed version remembered");

  await chrome.storage.onChanged.fire({ updateAvailable: {} }, "local"); // same version again
  await tick();
  assert.equal(banner.hidden, true, "same version never re-nudges");

  await chrome.storage.local.set({ updateAvailable: "9.9.10" });
  await chrome.storage.onChanged.fire({ updateAvailable: {} }, "local");
  await tick();
  assert.equal(banner.hidden, false, "a newer version nudges again");

  // clicking the banner text is what applies the update
  calls.length = 0;
  document.getElementById("update-restart").click();
  await tick();
  assert.ok(calls.includes("runtime.reload"), "banner click restarts the extension to apply the update");
  await chrome.storage.local.remove(["updateAvailable", "dismissedUpdate"]);
});
