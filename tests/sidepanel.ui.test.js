import assert from "node:assert/strict";
import { test } from "node:test";
import { makeChrome, loadPage, tick, RAW_FEATURES, TEST_EXPERIMENTAL, TEST_FEATURES } from "./helpers/ui.js";

const AUTO_ALL_ON = TEST_FEATURES.SEARCH_AUTO_SELECT_ALL?.enabled === true;

const NOW = Date.now();
const tabs = [
  { id: 1, windowId: 1, index: 0, active: true, discarded: false, pinned: false, audible: false,
    url: "https://github.com/pr/1", title: "My Pull Request", lastAccessed: NOW },
  { id: 2, windowId: 1, index: 1, active: false, discarded: true, pinned: false, audible: false,
    url: "https://youtube.com/watch", title: "Some Video", lastAccessed: NOW - 3_600_000 },
  { id: 3, windowId: 2, index: 0, active: true, discarded: false, pinned: true, audible: false,
    url: "https://mail.google.com/inbox", title: "Inbox", lastAccessed: NOW - 60_000 },
];

const calls = [];
const groups = [{ id: 7, title: "work", color: "blue", collapsed: false, windowId: 1 }];
const chrome = makeChrome({
  tabs,
  calls,
  groups,
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

test("UI - Sidepanel - Toolbar selects open the custom dropdown, not the native popup", async () => {
  const scope = document.getElementById("scope");
  const dd = document.querySelector(".dd-pop");
  const down = new window.Event("mousedown", { bubbles: true, cancelable: true });
  scope.dispatchEvent(down);
  assert.equal(down.defaultPrevented, true, "native popup suppressed");
  assert.equal(dd.hidden, false, "custom list opens");
  const items = [...dd.querySelectorAll(".dd-item")].map((el) => el.textContent);
  assert.deepEqual(items, ["All windows", "Current window"], "scope options listed");
  assert.ok(dd.querySelector(".dd-item.current").textContent === "All windows", "current value marked");

  // picking an option updates the select and fires its change handler
  [...dd.querySelectorAll(".dd-item")].find((el) => el.textContent === "Current window").click();
  assert.equal(dd.hidden, true, "list closes on pick");
  assert.equal(scope.value, "current-window", "select value follows");
  assert.equal(document.querySelectorAll(".row").length, 2, "scope change applied (window 1 only)");

  // restore
  scope.dispatchEvent(new window.Event("mousedown", { bubbles: true, cancelable: true }));
  [...dd.querySelectorAll(".dd-item")].find((el) => el.textContent === "All windows").click();
  assert.equal(scope.value, "all-windows");
  await tick();

  // hidden (flag-gated) sort options never appear in the custom list
  const sort = document.getElementById("sort");
  sort.dispatchEvent(new window.Event("mousedown", { bubbles: true, cancelable: true }));
  const sortItems = [...dd.querySelectorAll(".dd-item")].map((el) => el.textContent);
  const hiddenLabels = [...sort.options].filter((o) => o.hidden).map((o) => o.textContent);
  for (const label of hiddenLabels) {
    assert.ok(!sortItems.includes(label), `hidden option not offered: ${label}`);
  }
  document.dispatchEvent(new window.Event("mousedown", { bubbles: true })); // click-away closes
  assert.equal(dd.hidden, true, "outside mousedown closes the list");
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
  assert.ok(calls.includes("sendMessage tabs-woken"), "wake reported so the SW restarts its clock");
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

test("UI - Sidepanel - Update nudge: ui.hideUpdateBanner suppresses it entirely", async () => {
  const banner = document.getElementById("update-banner");
  const { ui } = await chrome.storage.local.get("ui");
  await chrome.storage.local.set({ updateAvailable: "9.9.11", ui: { ...ui, hideUpdateBanner: true } });
  await chrome.storage.onChanged.fire({ updateAvailable: {}, ui: {} }, "local");
  await tick();
  assert.equal(banner.hidden, true, "option keeps the nudge hidden");
  await chrome.storage.local.set({ ui: { ...ui, hideUpdateBanner: false } });
  await chrome.storage.onChanged.fire({ ui: {} }, "local");
  await tick();
  assert.equal(banner.hidden, false, "clearing the option shows it again");
  await chrome.storage.local.remove(["updateAvailable", "dismissedUpdate"]);
  await chrome.storage.onChanged.fire({ updateAvailable: {} }, "local");
  await tick();
});

test("UI - Sidepanel - Search highlights the found tokens in the list", async () => {
  const search = document.getElementById("search");
  search.value = "pull";
  search.dispatchEvent(new window.Event("input", { bubbles: true }));
  await tick();
  const marks = [...document.querySelectorAll(".row .title mark")].map((m) => m.textContent);
  assert.deepEqual(marks, ["Pull"], "matched token wrapped in <mark>, original casing kept");
  search.value = "";
  search.dispatchEvent(new window.Event("input", { bubbles: true }));
  await tick();
  assert.equal(document.querySelector(".row mark"), null, "no marks without a search");
});

test("UI - Sidepanel - Row hover shows the full URL in the custom tip", async () => {
  const row = document.querySelector(".row");
  assert.ok(row.dataset.tip.startsWith("https://"), "row carries its url as tip");
  row.dispatchEvent(new window.Event("mouseover", { bubbles: true }));
  const tip = document.getElementById("hover-tip");
  assert.equal(tip.hidden, false, "tip visible on row hover");
  assert.equal(tip.textContent, row.dataset.tip, "tip text = tab url");
  document.getElementById("tab-list").dispatchEvent(new window.Event("mouseleave"));
  assert.equal(tip.hidden, true);
});

test("UI - Sidepanel - Hover tip highlights the searched tokens inside the URL", async () => {
  const search = document.getElementById("search");
  search.value = "github";
  search.dispatchEvent(new window.Event("input", { bubbles: true }));
  await tick();
  const row = document.querySelector(".row");
  row.dispatchEvent(new window.Event("mouseover", { bubbles: true }));
  const tip = document.getElementById("hover-tip");
  assert.equal(tip.hidden, false);
  const marks = [...tip.querySelectorAll("mark")].map((m) => m.textContent);
  assert.deepEqual(marks, ["github"], "matched token marked inside the tip URL");
  assert.equal(tip.textContent, row.dataset.tip, "full url still shown");
  search.value = "";
  search.dispatchEvent(new window.Event("input", { bubbles: true }));
  await tick();
  // rows were rebuilt by the render — hover the fresh one, not the detached ref
  document.querySelector(".row").dispatchEvent(new window.Event("mouseover", { bubbles: true }));
  assert.equal(tip.querySelectorAll("mark").length, 0, "no marks without a search");
});

test("UI - Sidepanel - Fuzzy checkbox by the search box drives experimental_fuzzySearch", async () => {
  const label = document.getElementById("fuzzy-label");
  // visible only when the experimental opt-in itself flipped the flag on
  const offered =
    TEST_EXPERIMENTAL &&
    RAW_FEATURES.FUZZY_SEARCH?.enabled !== true &&
    TEST_FEATURES.FUZZY_SEARCH?.enabled === true;
  assert.equal(label.hidden, !offered, "visible only via the experimental opt-in");
  if (!offered) {
    return;
  }
  const box = document.getElementById("fuzzy-toggle");
  assert.equal(box.checked, true, "defaults on");
  calls.length = 0;
  box.checked = false;
  box.dispatchEvent(new window.Event("change", { bubbles: true }));
  await tick();
  assert.ok(
    calls.some((c) => c.startsWith("storage.set") && c.includes('"experimental_fuzzySearch":false')),
    "pref persisted from the sidepanel",
  );
  box.checked = true;
  box.dispatchEvent(new window.Event("change", { bubbles: true }));
  await tick();
});

test("UI - Sidepanel - Closing one tab keeps the rest of the selection", async () => {
  // clean slate — earlier tests may leave scope/filter narrowed
  document.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  const scope = document.getElementById("scope");
  scope.value = "all-windows";
  scope.dispatchEvent(new window.Event("change", { bubbles: true }));
  document.querySelector('#filters button[data-filter="all"]').click();
  const selectAll = document.getElementById("select-all");
  selectAll.checked = true;
  selectAll.dispatchEvent(new window.Event("change", { bubbles: true }));
  assert.match(document.getElementById("bulk-count").textContent, /3 selected/);

  // row X close: only the closed tab leaves the selection
  document.querySelector('.row[data-tab-id="3"] [data-action="close"]').click();
  await tick();
  await tick();
  assert.ok(calls.some((c) => c.startsWith("tabs.remove 3")), "close issued");
  assert.match(document.getElementById("bulk-count").textContent, /2 selected/, "others still selected");

  // tab closed outside the panel: stale id pruned on refresh, rest survives
  const external = tabs.splice(1, 1)[0]; // tab id 2 disappears from chrome
  await chrome.tabs.onRemoved.fire(2, {});
  await new Promise((resolve) => setTimeout(resolve, 200)); // refresh debounce
  assert.match(document.getElementById("bulk-count").textContent, /1 selected/, "stale id pruned");

  tabs.splice(1, 0, external); // restore fixture
  document.getElementById("bulk-clear").click();
  await new Promise((resolve) => setTimeout(resolve, 200));
});

test("UI - Sidepanel - Drag a tab onto another window's row moves it there", async () => {
  const rowOf = (id) => document.querySelector(`.row[data-tab-id="${id}"]`);
  calls.length = 0;
  // tab 1 lives in window 1; tab 3 in window 2 — drop tab 1 anywhere on window 2's tabs
  rowOf(1).dispatchEvent(new window.Event("dragstart", { bubbles: true }));
  rowOf(3).dispatchEvent(new window.Event("dragover", { bubbles: true }));
  assert.ok(rowOf(3).classList.contains("drop-target"), "target row highlighted");
  rowOf(3).dispatchEvent(new window.Event("drop", { bubbles: true }));
  await tick();
  await tick();
  assert.ok(
    calls.some((c) => c.startsWith("tabs.move 1") && c.includes('"windowId":2')),
    "moved into window 2",
  );
  tabs[0].windowId = 1; // restore fixture
  await new Promise((resolve) => setTimeout(resolve, 200));
});

test("UI - Sidepanel - Right-click row offers move-to-window menu (selection-aware)", async () => {
  const rowOf = (id) => document.querySelector(`.row[data-tab-id="${id}"]`);
  const menu = document.getElementById("ctx-menu");
  calls.length = 0;
  rowOf(1).dispatchEvent(new window.Event("contextmenu", { bubbles: true }));
  assert.equal(menu.hidden, false, "menu opens on row right-click");
  const items = [...menu.querySelectorAll(".ctx-item")].map((el) => el.textContent);
  assert.deepEqual(
    items,
    ["Snooze", "Wake", "Protect", "Unprotect", "Pin", "Close", "Move tab to ▸", "Window #2", "New window",
      // TAB_GROUPS: move-to-group submenu (fixture has one group) — flag on in
      // shipped+experimental; the disabled pass hides it
      ...(TEST_FEATURES.TAB_GROUPS?.enabled === true ? ["Move to group ▸", "work", "New group…"] : [])],
    "bulk actions first, then the Move-to dropdown (own window excluded)",
  );
  const submenu = menu.querySelector(".ctx-submenu");
  assert.equal(submenu.hidden, true, "move targets folded by default");
  const moveToggle = [...menu.querySelectorAll(".ctx-item")].find((el) =>
    el.textContent.startsWith("Move tab to"),
  );
  moveToggle.dispatchEvent(new window.Event("mouseenter"));
  assert.equal(submenu.hidden, true, "not yet — hover-intent delay");
  await new Promise((resolve) => setTimeout(resolve, 600)); // > SUBMENU_HOVER_DELAY_MS (500)
  assert.equal(submenu.hidden, false, "hover auto-expands the dropdown after the delay");
  assert.equal(moveToggle.querySelector(".ctx-caret").textContent, "▾", "caret shows expanded state");
  [...menu.querySelectorAll(".ctx-item")]
    .find((el) => el.textContent === "Snooze")
    .dispatchEvent(new window.Event("mouseover", { bubbles: true }));
  assert.equal(submenu.hidden, false, "hovering plain actions keeps it expanded");
  assert.equal(moveToggle.querySelector(".ctx-caret").textContent, "▾", "caret stays expanded");
  moveToggle.click();
  assert.equal(submenu.hidden, true, "click folds it");
  moveToggle.click();
  assert.equal(submenu.hidden, false, "click again expands the dropdown");
  assert.equal(menu.hidden, false, "menu itself stays open");

  [...menu.querySelectorAll(".ctx-item")].find((el) => el.textContent === "Window #2").click();
  await tick();
  await tick();
  assert.equal(menu.hidden, true, "menu closes after picking");
  assert.ok(
    calls.some((c) => c.startsWith("tabs.move 1") && c.includes('"windowId":2')),
    "move issued to the picked window",
  );
  tabs[0].windowId = 1;

  // bulk: right-clicking a selected row moves the whole selection to a new window
  const selectAll = document.getElementById("select-all");
  selectAll.checked = true;
  selectAll.dispatchEvent(new window.Event("change", { bubbles: true }));
  calls.length = 0;
  rowOf(1).dispatchEvent(new window.Event("contextmenu", { bubbles: true }));
  const moveBtn = [...menu.querySelectorAll(".ctx-item")].find((el) =>
    el.textContent.startsWith("Move 3 tabs to"),
  );
  assert.ok(moveBtn, "dropdown label counts the selection");
  moveBtn.click();
  [...menu.querySelectorAll(".ctx-item")].find((el) => el.textContent === "New window").click();
  await tick();
  await tick();
  assert.ok(calls.some((c) => c.startsWith("windows.create") && c.includes('"tabId":')), "new window around first tab");
  assert.ok(calls.some((c) => c.startsWith("tabs.move") && c.includes('"windowId":900')), "rest follow into it");
  assert.equal(tabs.find((tab) => tab.id === 3).pinned, true, "pinned tab stays pinned across the window move");
  for (const tab of tabs) tab.windowId = tab.id === 3 ? 2 : 1; // restore fixture
  document.getElementById("bulk-clear").click();
  await new Promise((resolve) => setTimeout(resolve, 200));
});

test("UI - Sidepanel - Context menu actions act on the clicked tab / whole selection", async () => {
  const rowOf = (id) => document.querySelector(`.row[data-tab-id="${id}"]`);
  const menu = document.getElementById("ctx-menu");
  const pick = (label) =>
    [...menu.querySelectorAll(".ctx-item")].find((el) => el.textContent.startsWith(label)).click();

  calls.length = 0;
  rowOf(1).dispatchEvent(new window.Event("contextmenu", { bubbles: true }));
  pick("Snooze");
  await tick();
  await tick();
  assert.ok(calls.includes("sendMessage snooze-tab"), "snooze via service worker");
  assert.equal(menu.hidden, true, "menu closes after action");

  calls.length = 0;
  rowOf(2).dispatchEvent(new window.Event("contextmenu", { bubbles: true }));
  pick("Wake");
  await tick();
  await tick();
  assert.ok(calls.some((c) => c.startsWith("tabs.reload 2")), "wake reloads the discarded tab");

  calls.length = 0;
  rowOf(1).dispatchEvent(new window.Event("contextmenu", { bubbles: true }));
  pick("Protect");
  await tick();
  await tick();
  assert.ok(calls.includes("sendMessage protect-hosts"), "protect via service worker");

  calls.length = 0;
  rowOf(1).dispatchEvent(new window.Event("contextmenu", { bubbles: true }));
  pick("Pin");
  await tick();
  await tick();
  assert.ok(calls.some((c) => c.startsWith("tabs.update 1") && c.includes('"pinned":true')), "pin via tabs.update");

  calls.length = 0;
  rowOf(1).dispatchEvent(new window.Event("contextmenu", { bubbles: true }));
  assert.ok(
    ![...menu.querySelectorAll(".ctx-item")].some((el) => el.textContent === "Pin"),
    "pinned tab: no Pin entry",
  );
  pick("Unpin");
  await tick();
  await tick();
  assert.ok(calls.some((c) => c.startsWith("tabs.update 1") && c.includes('"pinned":false')), "unpin via tabs.update");
  tabs.find((t) => t.id === 1).pinned = false; // restore fixture

  calls.length = 0;
  rowOf(3).dispatchEvent(new window.Event("contextmenu", { bubbles: true }));
  pick("Unprotect");
  await tick();
  await tick();
  assert.ok(calls.includes("sendMessage unprotect-hosts"), "unprotect via service worker");

  calls.length = 0;
  rowOf(1).dispatchEvent(new window.Event("contextmenu", { bubbles: true }));
  pick("Close");
  await tick();
  await tick();
  assert.ok(calls.some((c) => c.startsWith("tabs.remove 1")), "close removes only the clicked tab");
  await new Promise((resolve) => setTimeout(resolve, 200));
});

test("UI - Sidepanel - Context menu closes on selection change, outside click, window blur", async () => {
  const rowOf = (id) => document.querySelector(`.row[data-tab-id="${id}"]`);
  const menu = document.getElementById("ctx-menu");

  const selectAll = document.getElementById("select-all");
  selectAll.checked = true;
  selectAll.dispatchEvent(new window.Event("change", { bubbles: true }));
  rowOf(1).dispatchEvent(new window.Event("contextmenu", { bubbles: true }));
  assert.equal(menu.hidden, false, "menu open over the selection");
  document.getElementById("bulk-clear").click(); // unselect all = click outside + re-render
  assert.equal(menu.hidden, true, "unselecting closes the menu");

  rowOf(1).dispatchEvent(new window.Event("contextmenu", { bubbles: true }));
  assert.equal(menu.hidden, false);
  window.dispatchEvent(new window.Event("blur")); // clicked another window/tab
  assert.equal(menu.hidden, true, "focus loss closes the menu");
});

test("UI - Sidepanel - groupByWindowTabsOrder reorders tabs inside window groups", async () => {
  const select = document.getElementById("sort");
  select.value = "window";
  select.dispatchEvent(new window.Event("change", { bubbles: true }));
  const titles = () => [...document.querySelectorAll(".row .title")].map((el) => el.textContent);
  assert.deepEqual(titles(), ["My Pull Request", "⏸ Some Video", "Inbox"], "recent within window 1");

  const { ui } = await chrome.storage.local.get("ui");
  await chrome.storage.local.set({ ui: { ...ui, groupByWindowTabsOrder: "title-desc" } });
  await chrome.storage.onChanged.fire({ ui: { newValue: {} } }, "local");
  await new Promise((resolve) => setTimeout(resolve, 200)); // refresh debounce
  assert.deepEqual(titles(), ["⏸ Some Video", "My Pull Request", "Inbox"], "titles Z-A within window 1");

  await chrome.storage.local.set({ ui: { ...ui, groupByWindowTabsOrder: "recent" } });
  await chrome.storage.onChanged.fire({ ui: { newValue: {} } }, "local");
  await new Promise((resolve) => setTimeout(resolve, 200));
  select.value = "recent";
  select.dispatchEvent(new window.Event("change", { bubbles: true }));
});

test("UI - Sidepanel - Window header right-click: window-wide actions + Change order dropdown", async () => {
  const sort = document.getElementById("sort");
  sort.value = "window";
  sort.dispatchEvent(new window.Event("change", { bubbles: true }));
  const menu = document.getElementById("ctx-menu");
  const header = document.querySelector('.group-header[data-window-id="1"]');
  assert.ok(header, "window header carries its windowId");
  header.dispatchEvent(new window.Event("contextmenu", { bubbles: true }));
  assert.equal(menu.hidden, false, "menu opens on header right-click");
  const items = [...menu.querySelectorAll(".ctx-item")].map((el) => el.textContent);
  const NAMES_ON = TEST_FEATURES.WINDOW_NAMES?.enabled === true;
  assert.deepEqual(
    items,
    [
      // WINDOW_NAMES puts focus/rename/color on top (+ 8 palette swatches and
      // Auto); Focus window only for non-current windows (header 1 IS current)
      ...(NAMES_ON ? ["Pin window", "Rename window…", "Window color ▸",
        "Red", "Teal", "Yellow", "Green", "Purple", "Pink", "Gray", "Gold", "Auto"] : []),
      "Snooze 2 tabs", "Wake 2 tabs", "Protect 2 tabs", "Unprotect 2 tabs",
      "Pin 2 tabs", "Close 2 tabs", // both unpinned → no Unpin offered
      "Tabs Order ▸",
      "Recently used", "Same as window", "Title sorted A-Z", "Title sorted Z-A",
    ],
    "actions cover the window's visible tabs; order dropdown follows",
  );
  if (NAMES_ON) {
    // accordion: opening one submenu folds the other
    const toggles = [...menu.querySelectorAll(".ctx-item.ctx-move")];
    const orderToggle = toggles.find((el) => el.textContent.startsWith("Tabs Order"));
    const colorToggle = toggles.find((el) => el.textContent.startsWith("Window color"));
    orderToggle.dispatchEvent(new window.Event("mouseenter"));
    await new Promise((resolve) => setTimeout(resolve, 600)); // > SUBMENU_HOVER_DELAY_MS (500)
    assert.equal(orderToggle.nextElementSibling.hidden, false, "Tabs Order expands");
    colorToggle.dispatchEvent(new window.Event("mouseenter"));
    await new Promise((resolve) => setTimeout(resolve, 600));
    assert.equal(colorToggle.nextElementSibling.hidden, false, "Window color expands");
    assert.equal(orderToggle.nextElementSibling.hidden, true, "Tabs Order folds (accordion)");
    colorToggle.click(); // fold again for the assertions below
  }
  const currentItems = [...menu.querySelectorAll(".ctx-item.current")].map((el) => el.textContent);
  // WINDOW_NAMES: unset window color marks the "Auto" swatch current too
  assert.deepEqual(currentItems, [...(NAMES_ON ? ["Auto"] : []), "Recently used"], "current order highlighted");

  // picking an order persists ui.groupByWindowTabsOrder and reorders the group live
  calls.length = 0;
  [...menu.querySelectorAll(".ctx-item")].find((el) => el.textContent === "Title sorted Z-A").click();
  await tick();
  assert.equal(menu.hidden, true, "menu closes after picking");
  assert.ok(
    calls.some((c) => c.startsWith("storage.set") && c.includes('"groupByWindowTabsOrder":"title-desc"')),
    "option persisted — options page will mirror it",
  );
  const titles = [...document.querySelectorAll(".row .title")].map((el) => el.textContent);
  assert.deepEqual(titles.slice(0, 2), ["⏸ Some Video", "My Pull Request"], "window 1 reordered Z-A");

  // reopening shows the new current selection
  document.querySelector('.group-header[data-window-id="1"]')
    .dispatchEvent(new window.Event("contextmenu", { bubbles: true }));
  assert.deepEqual(
    [...menu.querySelectorAll(".ctx-item.current")].map((el) => el.textContent),
    [...(NAMES_ON ? ["Auto"] : []), "Title sorted Z-A"],
    "highlight follows the stored option",
  );

  // restore fixture state
  [...menu.querySelectorAll(".ctx-item")].find((el) => el.textContent === "Recently used").click();
  await tick();

  // with a selection inside the window, header actions target only the selected tabs
  document.querySelector('.row[data-tab-id="1"] input').click(); // toggles checked + fires click
  document.querySelector('.group-header[data-window-id="1"]')
    .dispatchEvent(new window.Event("contextmenu", { bubbles: true }));
  const actionLabels = [...menu.querySelectorAll(".ctx-item")]
    .map((el) => el.textContent)
    .filter((t) => /^(Snooze|Wake|Protect|Unprotect|Close)( \d+ tabs?)?$/.test(t));
  assert.deepEqual(
    actionLabels,
    ["Snooze 1 tab", "Wake 1 tab", "Protect 1 tab", "Unprotect 1 tab", "Close 1 tab"],
    "1 of 2 selected — actions name the single-tab scope explicitly",
  );
  calls.length = 0;
  [...menu.querySelectorAll(".ctx-item")].find((el) => el.textContent === "Close 1 tab").click();
  await tick();
  await tick();
  assert.ok(calls.includes("tabs.remove 1"), "only the selected tab closed");
  document.getElementById("bulk-clear").click();
  await new Promise((resolve) => setTimeout(resolve, 200));

  sort.value = "recent";
  sort.dispatchEvent(new window.Event("change", { bubbles: true }));
});

test("UI - Sidepanel - Same-as-window mode: in-window drag reorder; cross-window drop keeps position", async () => {
  const sort = document.getElementById("sort");
  sort.value = "window";
  sort.dispatchEvent(new window.Event("change", { bubbles: true }));
  const rowOf = (id) => document.querySelector(`.row[data-tab-id="${id}"]`);

  // recency order: a same-window row is NOT a reorder target
  rowOf(1).dispatchEvent(new window.Event("dragstart", { bubbles: true }));
  rowOf(2).dispatchEvent(new window.Event("dragover", { bubbles: true }));
  assert.ok(!rowOf(2).classList.contains("drop-target"), "no in-window reorder outside same-as-window");
  rowOf(1).dispatchEvent(new window.Event("dragend", { bubbles: true }));

  const { ui } = await chrome.storage.local.get("ui");
  await chrome.storage.local.set({ ui: { ...ui, groupByWindowTabsOrder: "same-as-window" } });
  await chrome.storage.onChanged.fire({ ui: { newValue: {} } }, "local");
  await new Promise((resolve) => setTimeout(resolve, 200)); // refresh debounce

  // in-window reorder: drop lands at the target row's strip position
  calls.length = 0;
  rowOf(1).dispatchEvent(new window.Event("dragstart", { bubbles: true }));
  rowOf(2).dispatchEvent(new window.Event("dragover", { bubbles: true }));
  assert.ok(rowOf(2).classList.contains("drop-target"), "same-window row is a valid target now");
  rowOf(2).dispatchEvent(new window.Event("drop", { bubbles: true }));
  await tick();
  await tick();
  assert.ok(
    calls.some((c) => c.startsWith("tabs.move 1") && c.includes('"windowId":1') && c.includes('"index":1')),
    "reordered to the target row's position",
  );

  // cross-window row drop: the new position is preserved, not appended
  calls.length = 0;
  rowOf(2).dispatchEvent(new window.Event("dragstart", { bubbles: true }));
  rowOf(3).dispatchEvent(new window.Event("drop", { bubbles: true }));
  await tick();
  await tick();
  assert.ok(
    calls.some((c) => c.startsWith("tabs.move 2") && c.includes('"windowId":2') && c.includes('"index":0')),
    "moved into window 2 at the drop row's position",
  );

  // restore fixture
  tabs[0].index = 0;
  tabs[1].windowId = 1;
  tabs[1].index = 1;
  await chrome.storage.local.set({ ui: { ...ui, groupByWindowTabsOrder: "recent" } });
  await chrome.storage.onChanged.fire({ ui: { newValue: {} } }, "local");
  await new Promise((resolve) => setTimeout(resolve, 200));
  sort.value = "recent";
  sort.dispatchEvent(new window.Event("change", { bubbles: true }));
});

test(
  "UI - Sidepanel - WINDOW_NAMES: named headers, custom dots, overview list, inline rename",
  { skip: !(TEST_FEATURES.WINDOW_NAMES?.enabled === true) && "WINDOW_NAMES disabled in features.json" },
  async () => {
    // third window named "Alpha" — proves the overview sorts others by name
    tabs.push({ id: 99, windowId: 3, index: 0, active: true, discarded: false, pinned: false,
      audible: false, url: "https://alpha.example.com/", title: "Alpha Tab", lastAccessed: NOW });
    await chrome.storage.session.set({ windowSessionMap: { 1: "w-t1", 2: "w-t2", 3: "w-t3" } });
    await chrome.storage.local.set({
      windowProfiles: {
        "w-t1": { chromeWindowId: 1, name: "Research", updatedAt: Date.now() },
        "w-t2": { chromeWindowId: 2, color: "#123456", updatedAt: Date.now() },
        "w-t3": { chromeWindowId: 3, name: "Alpha", updatedAt: Date.now() },
      },
    });
    const sort = document.getElementById("sort");
    sort.value = "window";
    sort.dispatchEvent(new window.Event("change", { bubbles: true }));
    await chrome.tabs.onActivated.fire({});
    await new Promise((resolve) => setTimeout(resolve, 200)); // refresh debounce

    const labels = [...document.querySelectorAll(".group-header .group-label")].map((el) => el.textContent);
    // sidebar groups: current first, then ABC by display name ("Alpha" < "Window #2")
    assert.deepEqual(labels, ["Research — Current #1", "Alpha", "Window #2"], "custom name on the header");
    const header2 = document.querySelector('.group-header[data-window-id="2"]');
    assert.equal(header2.querySelector(".win-dot").style.background, "#123456", "custom dot color");
    assert.ok(header2.querySelector(".group-menu-btn"), "⋯ window-actions button present");

    // windows popover (S2): button visible, rows with stats; click focuses
    const winBtn = document.getElementById("win-list-btn");
    assert.equal(winBtn.hidden, false, "windows-list button visible with the flag on");
    winBtn.click(); // fills the popover (popovertarget handles show/hide natively)
    await tick();
    const pop = document.getElementById("windows-pop");
    // fixture has a Chrome group and a pinned tab → view switcher shows all three
    assert.deepEqual(
      [...pop.querySelectorAll(".win-view")].map((el) => el.textContent),
      ["Windows (3)", "Groups (1)", "Pins (1)"],
      "view tabs with counts",
    );
    assert.match(pop.querySelector(".win-view.on").textContent, /Windows \(3\)/, "Windows selected by default");
    const rows = [...pop.querySelectorAll(".win-row")];
    assert.deepEqual(
      rows.map((el) => el.querySelector(".win-title").textContent),
      ["Research — Current #1", "Alpha", "Window #2"],
      "current first, then others ABC by display name (Alpha before Window #2)",
    );
    assert.deepEqual(
      rows.map((el) => el.querySelector(".win-stats").textContent),
      ["2 tabs · 1 awake · 1 snoozed", "1 tab · 1 awake · 0 snoozed", "1 tab · 1 awake · 0 snoozed"],
    );
    assert.ok(rows[0].classList.contains("current"), "current window row emphasized");
    assert.match(rows[0].title, /Research — Current #1\n2 tabs · 1 awake · 1 snoozed\n0 pinned · 0 audible\nActive tab: My Pull Request/,
      "hover tooltip carries full name + stats + active tab");
    calls.length = 0;
    rows[1].click(); // "Alpha" = window 3
    await tick();
    assert.ok(calls.includes("windows.update 3"), "popover row click focuses the window");

    // right-click a popover row → the slim window-scoped menu (no tab actions)
    rows[2].dispatchEvent(new window.Event("contextmenu", { bubbles: true }));
    const ctx = document.getElementById("ctx-menu");
    assert.equal(ctx.hidden, false, "window menu opens from a popover row");
    assert.equal(ctx.querySelector(".ctx-title").textContent, "Window #2", "menu header names the window");
    assert.deepEqual(
      [...ctx.querySelectorAll(".ctx-item")].map((el) => el.textContent),
      ["Focus window", "Pin window", "Rename window…", "Window color ▸",
        "Red", "Teal", "Yellow", "Green", "Purple", "Pink", "Gray", "Gold", "Auto"],
      "only rename/color/focus — no bulk actions, no Tabs Order",
    );
    ctx.querySelector(".ctx-close").click();
    assert.equal(ctx.hidden, true, "corner X closes the menu");

    // each row carries a ⋯ trigger for the same menu (no right-click needed)
    const menuBtns = [...pop.querySelectorAll(".win-menu-btn")];
    assert.equal(menuBtns.length, rows.length, "one ⋯ per window row");
    menuBtns[1].click();
    assert.equal(ctx.hidden, false, "⋯ opens the window menu");

    // rename from the windows list edits IN the popover row, not the header
    [...ctx.querySelectorAll(".ctx-item")].find((el) => el.textContent === "Rename window…").click();
    const listInput = pop.querySelector(".rename-input");
    assert.ok(listInput, "input replaces the row's name inside the popover");
    listInput.value = "Beta";
    calls.length = 0;
    listInput.dispatchEvent(new window.Event("blur"));
    await tick();
    await tick();
    assert.ok(calls.includes("sendMessage window-rename"), "in-list rename sent to the service worker");
    document.body.click();

    // inline rename: ctx menu entry swaps the label for an input; Enter commits
    document.querySelector('.group-header[data-window-id="2"]')
      .dispatchEvent(new window.Event("contextmenu", { bubbles: true }));
    const menu = document.getElementById("ctx-menu");
    [...menu.querySelectorAll(".ctx-item")].find((el) => el.textContent === "Rename window…").click();
    const input = document.querySelector(".rename-input");
    assert.ok(input, "label replaced by input");
    input.value = "Media";
    calls.length = 0;
    input.dispatchEvent(new window.Event("blur"));
    await tick();
    await tick();
    assert.ok(calls.includes("sendMessage window-rename"), "rename sent to the service worker");

    // "Move tab to" targets follow the windows-list order: ABC by display name…
    const moveTargets = () => {
      document.querySelector('.row[data-tab-id="1"]').dispatchEvent(new window.Event("contextmenu", { bubbles: true }));
      const names = [...ctx.querySelector(".ctx-submenu").querySelectorAll(".ctx-item")].map((el) => el.textContent);
      document.body.click();
      return names;
    };
    assert.deepEqual(moveTargets(), ["Alpha", "Window #2", "New window"], "ABC, not Chrome's window order");

    // pin window 2 → sorts above Alpha despite the name; 📌 marker; Unpin label
    const { windowProfiles } = await chrome.storage.local.get("windowProfiles");
    windowProfiles["w-t2"] = { ...windowProfiles["w-t2"], pinnedWindow: true };
    await chrome.storage.local.set({ windowProfiles });
    await chrome.tabs.onActivated.fire({});
    await new Promise((resolve) => setTimeout(resolve, 200)); // refresh debounce
    winBtn.click(); // refill
    await tick();
    assert.deepEqual(
      [...pop.querySelectorAll(".win-row .win-title")].map((el) => el.textContent),
      ["Research — Current #1", "Window #2", "Alpha"],
      "pinned window jumps above the ABC block, current stays first",
    );
    assert.ok(pop.querySelector('.win-row[data-window-id="2"] .win-pin'), "pinned row carries the marker");
    assert.deepEqual(moveTargets(), ["Window #2", "Alpha", "New window"], "…with pinned windows lifted above");
    winBtn.click(); // the menu's click-away closed the popover — reopen
    await tick();
    pop.querySelector('.win-row[data-window-id="2"]').parentElement.querySelector(".win-menu-btn").click();
    assert.ok(
      [...ctx.querySelectorAll(".ctx-item")].some((el) => el.textContent === "Unpin window"),
      "menu offers Unpin for a pinned window",
    );
    document.body.click();

    // view switch closes an open window menu and cancels a rename in progress
    winBtn.click();
    await tick();
    const viewBtn = (name) => [...pop.querySelectorAll(".win-view")].find((el) => el.textContent.startsWith(name));
    pop.querySelector(".win-menu-btn").click();
    assert.equal(ctx.hidden, false, "⋯ opens the window menu");
    viewBtn("Groups").click();
    assert.equal(ctx.hidden, true, "view switch closes the window menu");
    viewBtn("Windows").click();
    pop.querySelector(".win-menu-btn").click();
    [...ctx.querySelectorAll(".ctx-item")].find((el) => el.textContent === "Rename window…").click();
    pop.querySelector(".rename-input").value = "Nope";
    calls.length = 0;
    const press = new window.Event("mousedown", { bubbles: true, cancelable: true });
    viewBtn("Groups").dispatchEvent(press);
    assert.equal(press.defaultPrevented, true, "press keeps focus — no blur-commit, no refill mid-press");
    assert.ok(pop.querySelector(".rename-input"), "rename survives the press, the click cancels it");
    viewBtn("Groups").click();
    await tick();
    await tick();
    assert.match(pop.querySelector(".win-view.on").textContent, /^Groups/, "view switched");
    assert.ok(!calls.includes("sendMessage window-rename"), "view switch cancels the rename, nothing sent");
    assert.equal(document.querySelector(".rename-input"), null, "rename input gone");
    document.body.click();

    // Groups view: group row navigates to the group's first tab
    winBtn.click();
    await tick();
    [...pop.querySelectorAll(".win-view")].find((el) => el.textContent.startsWith("Groups")).click();
    await tick();
    const groupRow = pop.querySelector('.win-row[data-tab-group-id="7"]');
    assert.ok(groupRow, "group listed");
    assert.equal(groupRow.querySelector(".win-title").textContent, "work");
    assert.ok(groupRow.querySelector(".tg-square"), "square marker");
    assert.equal(groupRow.querySelector(".win-stats").textContent, "0 tabs · 0 awake · 0 snoozed",
      "same stats shape as the Windows view");

    // rename from the Groups view edits IN the popover row, like the Windows view
    groupRow.parentElement.querySelector(".win-menu-btn").click();
    [...ctx.querySelectorAll(".ctx-item")].find((el) => el.textContent === "Rename group…").click();
    const groupInput = pop.querySelector('.win-row[data-tab-group-id="7"] .rename-input');
    assert.ok(groupInput, "input replaces the group's name inside the popover");
    assert.equal(groupInput.value, "work");
    groupInput.value = "play";
    calls.length = 0;
    groupInput.dispatchEvent(new window.Event("blur"));
    await tick();
    await tick();
    assert.ok(calls.includes('tabGroups.update 7 {"title":"play"}'), "in-list group rename sent to Chrome");
    await chrome.tabGroups.update(7, { title: "work" }); // shared fixture — later tests pick "work"
    assert.match(pop.querySelector(".win-view.on").textContent, /^Groups/, "popover stays on Groups");
    assert.equal(pop.querySelector(".rename-input"), null, "input gone after commit");

    // bottom "+ New group…" row: inline name input. Esc / empty name create nothing…
    const newGroupInput = () => {
      pop.querySelector(".win-row.win-new").click();
      return pop.querySelector(".win-row.win-new .rename-input");
    };
    // assert.ok, not equal: a failing equal would inspect whole DOM nodes
    assert.ok(pop.querySelector(".win-item:last-child .win-row")?.classList.contains("win-new"),
      "new-group row sits at the bottom of the list");
    calls.length = 0;
    const emptyName = newGroupInput();
    assert.ok(emptyName, "click swaps the label for a name input");
    emptyName.dispatchEvent(new window.Event("blur"));
    await tick();
    await tick();
    assert.ok(!calls.some((c) => c.startsWith("tabs.group")), "empty name: no group created");
    assert.ok(pop.querySelector(".win-row.win-new"), "row back in place");
    // …a name opens a background New Tab in the current window and groups THAT
    // (Chrome has no empty groups) — the active tab AND a sidebar selection are left alone
    const selectAllBox = document.getElementById("select-all");
    selectAllBox.checked = true;
    selectAllBox.dispatchEvent(new window.Event("change", { bubbles: true }));
    await new Promise((resolve) => setTimeout(resolve, 200));
    winBtn.click();
    await tick();
    [...pop.querySelectorAll(".win-view")].find((el) => el.textContent.startsWith("Groups")).click();
    calls.length = 0;
    const named = newGroupInput();
    named.value = "reading";
    named.dispatchEvent(new window.Event("blur"));
    await tick();
    await tick();
    assert.ok(calls.includes('tabs.create {"windowId":1,"active":false}'), "background New Tab in the current window");
    const created = tabs.find((t) => t.id >= 1000);
    assert.ok(calls.includes(`tabs.group ${created.id} new`), "the new tab is what gets grouped");
    assert.deepEqual(calls.filter((c) => c.startsWith("tabs.group")), [`tabs.group ${created.id} new`],
      "nothing else grouped — not the active tab, not the selected tabs");
    document.getElementById("bulk-clear").click();
    assert.ok(calls.includes('tabGroups.update 900 {"title":"reading"}'), "group named from the input");
    assert.match(pop.querySelector(".win-view.on").textContent, /^Groups/, "popover stays on Groups");
    tabs.splice(tabs.indexOf(created), 1); // restore fixture
    await chrome.tabs.onUpdated.fire(1, { groupId: -1 });
    await new Promise((resolve) => setTimeout(resolve, 200));

    // the press that ends an inline edit only ends the edit: clicking a group row to
    // commit the new-group name must not ALSO navigate to that group / close the popover
    const realHide = pop.hidePopover;
    pop.hidePopover = () => calls.push("hidePopover"); // what a group-row click does first
    const pressed = newGroupInput();
    pressed.value = "later";
    calls.length = 0;
    const workRow = pop.querySelector('.win-row[data-tab-group-id="7"]');
    workRow.dispatchEvent(new window.Event("mousedown", { bubbles: true }));
    pressed.dispatchEvent(new window.Event("blur"));
    workRow.dispatchEvent(new window.Event("mouseup", { bubbles: true }));
    workRow.dispatchEvent(new window.Event("click", { bubbles: true, cancelable: true }));
    await tick();
    await tick();
    assert.ok(calls.some((c) => c.startsWith("tabs.group")), "the edit still commits");
    assert.ok(!calls.includes("hidePopover"), "committing click does not activate the row under it");
    // …and only that one click is swallowed
    calls.length = 0;
    const workRowAgain = pop.querySelector('.win-row[data-tab-group-id="7"]');
    workRowAgain.dispatchEvent(new window.Event("mousedown", { bubbles: true }));
    workRowAgain.dispatchEvent(new window.Event("mouseup", { bubbles: true }));
    workRowAgain.dispatchEvent(new window.Event("click", { bubbles: true, cancelable: true }));
    await tick();
    await tick();
    assert.ok(calls.includes("hidePopover"), "next click works normally");
    pop.hidePopover = realHide;
    tabs.splice(tabs.findIndex((t) => t.id >= 1000), 1); // restore fixture
    await chrome.tabs.onActivated.fire({});
    await new Promise((resolve) => setTimeout(resolve, 200));
    winBtn.click();
    await tick();
    [...pop.querySelectorAll(".win-view")].find((el) => el.textContent.startsWith("Groups")).click();

    // drag a group row onto another: custom list order, saved by title; a rename keeps the slot
    groups.push({ id: 8, title: "alpha", color: "red", collapsed: false, windowId: 2 });
    await chrome.tabs.onActivated.fire({});
    await new Promise((resolve) => setTimeout(resolve, 200));
    winBtn.click();
    await tick();
    [...pop.querySelectorAll(".win-view")].find((el) => el.textContent.startsWith("Groups")).click();
    const groupTitles = () =>
      [...pop.querySelectorAll(".win-row[data-tab-group-id] .win-title")].map((el) => el.textContent);
    const groupRowOf = (id) => pop.querySelector(`.win-row[data-tab-group-id="${id}"]`);
    assert.deepEqual(groupTitles(), ["alpha", "work"], "ABC until the user reorders");
    assert.equal(groupRowOf(8).draggable, true, "group rows are draggable");
    groupRowOf(8).dispatchEvent(new window.Event("dragstart", { bubbles: true }));
    const over = new window.Event("dragover", { bubbles: true, cancelable: true });
    groupRowOf(7).dispatchEvent(over);
    assert.equal(over.defaultPrevented, true, "another group row is a valid drop target");
    groupRowOf(7).dispatchEvent(new window.Event("drop", { bubbles: true, cancelable: true }));
    await tick();
    assert.deepEqual(groupTitles(), ["work", "alpha"], "dragged down: lands after the target");
    assert.deepEqual((await chrome.storage.local.get("ui")).ui.quickLaunchGroupOrder, ["work", "alpha"],
      "order persisted by title");
    groupRowOf(7).parentElement.querySelector(".win-menu-btn").click();
    [...ctx.querySelectorAll(".ctx-item")].find((el) => el.textContent === "Rename group…").click();
    const slotInput = pop.querySelector(".rename-input");
    slotInput.value = "beta";
    slotInput.dispatchEvent(new window.Event("blur"));
    await tick();
    await tick();
    await chrome.tabs.onActivated.fire({});
    await new Promise((resolve) => setTimeout(resolve, 200));
    winBtn.click();
    await tick();
    [...pop.querySelectorAll(".win-view")].find((el) => el.textContent.startsWith("Groups")).click();
    assert.deepEqual(groupTitles(), ["beta", "alpha"], "renamed group keeps its slot (ABC would flip them)");
    groups.pop(); // restore fixture
    await chrome.tabGroups.update(7, { title: "work" });

    // Groups view stays reachable with no groups at all — the first one is created there
    const savedGroups = groups.splice(0);
    await chrome.tabs.onActivated.fire({});
    await new Promise((resolve) => setTimeout(resolve, 200));
    winBtn.click();
    await tick();
    assert.ok(
      [...pop.querySelectorAll(".win-view")].some((el) => el.textContent === "Groups (0)"),
      "Groups view offered with zero groups",
    );
    groups.push(...savedGroups);
    await chrome.tabs.onActivated.fire({});
    await new Promise((resolve) => setTimeout(resolve, 200));
    winBtn.click();
    await tick();

    // Pins view: pinned tab row activates the tab
    [...pop.querySelectorAll(".win-view")].find((el) => el.textContent.startsWith("Pins")).click();
    await tick();
    const pinRow = pop.querySelector('.win-row[data-tab-id="3"]');
    assert.ok(pinRow, "pinned tab listed");
    assert.match(pinRow.querySelector(".win-title").textContent, /Inbox/);
    calls.length = 0;
    pinRow.click();
    await tick();
    await tick();
    assert.ok(calls.includes("windows.update 2"), "pin click focuses its window");
    assert.ok(calls.some((c) => c.startsWith("tabs.update 3") && c.includes('"active":true')), "…and activates the tab");

    // sidebar list follows: pin window 3 too → its group lifts above window 2
    windowProfiles["w-t3"] = { ...windowProfiles["w-t3"], pinnedWindow: true };
    windowProfiles["w-t2"] = { ...windowProfiles["w-t2"], pinnedWindow: undefined };
    await chrome.storage.local.set({ windowProfiles });
    await chrome.tabs.onActivated.fire({});
    await new Promise((resolve) => setTimeout(resolve, 200)); // refresh debounce
    assert.deepEqual(
      [...document.querySelectorAll(".group-header .group-label")].map((el) => el.textContent),
      ["Research — Current #1", "Alpha", "Window #2"],
      "pinned window's group lifts above unpinned in the sidebar list",
    );
    assert.ok(
      document.querySelector('.group-header[data-window-id="3"] .win-pin'),
      "pinned group header carries the 📌 marker",
    );
    assert.equal(
      document.querySelector('.group-header[data-window-id="2"] .win-pin'),
      null,
      "unpinned header has none",
    );

    // cleanup: profiles away, extra window gone, sort back
    tabs.splice(tabs.findIndex((t) => t.id === 99), 1);
    await chrome.storage.local.set({ windowProfiles: {} });
    await chrome.storage.session.set({ windowSessionMap: {} });
    sort.value = "recent";
    sort.dispatchEvent(new window.Event("change", { bubbles: true }));
    await chrome.tabs.onActivated.fire({});
    await new Promise((resolve) => setTimeout(resolve, 200));
  },
);

test(
  "UI - Sidepanel - Tab groups: move to group / new group / remove from group",
  { skip: !(TEST_FEATURES.TAB_GROUPS?.enabled === true) && "TAB_GROUPS disabled in features.json" },
  async () => {
    const rowOf = (id) => document.querySelector(`.row[data-tab-id="${id}"]`);
    const menu = document.getElementById("ctx-menu");
    const pick = (label) =>
      [...menu.querySelectorAll(".ctx-item")].find((el) => el.textContent.startsWith(label)).click();

    // move tab 1 into the existing "work" group
    calls.length = 0;
    rowOf(1).dispatchEvent(new window.Event("contextmenu", { bubbles: true }));
    pick("work");
    await tick();
    await tick();
    assert.ok(calls.includes("tabs.group 1 7"), "grouped into the picked group");

    // grouped tab now offers Remove from group
    await chrome.tabs.onUpdated.fire(1, { groupId: 7 });
    await new Promise((resolve) => setTimeout(resolve, 200)); // refresh debounce
    calls.length = 0;
    rowOf(1).dispatchEvent(new window.Event("contextmenu", { bubbles: true }));
    pick("Remove from group");
    await tick();
    await tick();
    assert.ok(calls.includes("tabs.ungroup 1"), "ungrouped");

    // New group asks the name first in the in-page dialog; Cancel moves nothing
    await chrome.tabs.onUpdated.fire(1, { groupId: -1 });
    await new Promise((resolve) => setTimeout(resolve, 200));
    calls.length = 0;
    globalThis.prompt = () => assert.fail("native prompt must not be used");
    const ask = document.getElementById("ask-dialog");
    rowOf(1).dispatchEvent(new window.Event("contextmenu", { bubbles: true }));
    pick("New group…");
    assert.equal(ask.open, true, "dialog opens");
    assert.equal(ask.querySelector(".ask-message").textContent, "New group name");
    assert.ok(ask.querySelector(".ask-input"), "with a text input");
    ask.querySelector(".ask-cancel").click();
    await tick();
    await tick();
    assert.equal(ask.open, false, "Cancel closes it");
    assert.ok(!calls.some((c) => c.startsWith("tabs.group")), "cancelled dialog: no group created");

    // …a name + Enter creates the group around the tab, then titles it
    rowOf(1).dispatchEvent(new window.Event("contextmenu", { bubbles: true }));
    pick("New group…");
    assert.equal(ask.querySelector(".ask-input").value, "", "input starts fresh on every open");
    ask.querySelector(".ask-input").value = "reading";
    ask.querySelector(".ask-input").dispatchEvent(new window.KeyboardEvent("keydown", { key: "Enter" }));
    await tick();
    await tick();
    assert.equal(ask.open, false, "Enter confirms and closes");
    assert.ok(calls.includes("tabs.group 1 new"), "new group requested");
    assert.ok(calls.includes('tabGroups.update 900 {"title":"reading"}'), "new group named from the dialog");
    assert.ok(
      calls.indexOf("tabs.group 1 new") < calls.indexOf('tabGroups.update 900 {"title":"reading"}'),
      "group first, title after",
    );
    tabs.find((t) => t.id === 1).groupId = -1; // restore fixture
    await chrome.tabs.onUpdated.fire(1, { groupId: -1 });
    await new Promise((resolve) => setTimeout(resolve, 200));
  },
);
