import assert from "node:assert/strict";
import { test } from "node:test";
import { makeChrome, loadPage, tick } from "./helpers/ui.js";

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
  const search = document.getElementById("search");
  search.value = "inbox";
  search.dispatchEvent(new window.Event("input", { bubbles: true }));
  assert.equal(document.querySelectorAll(".row").length, 1);

  search.value = "zzz-nothing";
  search.dispatchEvent(new window.Event("input", { bubbles: true }));
  assert.equal(document.querySelectorAll(".row").length, 0);
  assert.match(document.querySelector(".empty").textContent, /No tabs match/);

  document.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  assert.equal(document.querySelectorAll(".row").length, 3);
});

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
