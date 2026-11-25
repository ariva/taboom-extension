import assert from "node:assert/strict";
import { test } from "vitest";
import type { ChromeMockOptions } from "../../helpers/chrome-mock.ts";
import { byId, q } from "../../helpers/dom.ts";
import { loadPage, makeChrome, TEST_FEATURES, tick } from "../../helpers/ui.ts";

const KEY_NAV_ON = TEST_FEATURES.SIDEBAR_KEYBOARD_NAVIGATION?.enabled === true;
const keyNavSkip = { skip: !KEY_NAV_ON }; // SIDEBAR_KEYBOARD_NAVIGATION disabled in features.json

const NOW = Date.now();
const tabs: ChromeMockOptions["tabs"] = [
  { id: 1, windowId: 1, active: true, discarded: false, url: "https://a.com/", title: "Alpha", lastAccessed: NOW },
  {
    id: 2,
    windowId: 1,
    active: false,
    discarded: false,
    url: "https://b.com/",
    title: "Beta",
    lastAccessed: NOW - 1000,
  },
  {
    id: 3,
    windowId: 1,
    active: false,
    discarded: false,
    url: "https://c.com/",
    title: "Gamma",
    lastAccessed: NOW - 2000,
  },
];

const calls: string[] = [];
const mock = makeChrome({ tabs, calls, stored: {} });
loadPage("src/pages/sidepanel/index.html", mock);
await import("../../../src/pages/sidepanel/main.ts");
await tick();
await tick();

const key = (k: string) => document.dispatchEvent(new window.KeyboardEvent("keydown", { key: k, bubbles: true }));
const cursorTitle = () => document.querySelector(".row.cursor .title")?.textContent;

test("UI - Sidepanel Keyboard - No window dots when all tabs share one window", () => {
  assert.equal(document.querySelectorAll(".win-dot").length, 0);
});

test("UI - Sidepanel Keyboard - Slash focuses search", () => {
  byId("search").blur();
  key("/");
  assert.ok(document.activeElement === document.getElementById("search"));
});

test("UI - Sidepanel Keyboard - Arrows do nothing while flag off", { skip: KEY_NAV_ON }, () => {
  key("ArrowDown");
  assert.ok(document.querySelector(".row.cursor") === null, "no cursor appears");
});

function setSort(value: string): void {
  const sel = byId<HTMLSelectElement>("sort");
  sel.value = value;
  sel.dispatchEvent(new window.Event("change", { bubbles: true }));
}

// the row tests below run on a flat list: the default grouping's header is a cursor stop of its
// own (tested at the end of this file)
test("UI - Sidepanel Keyboard - (setup) a flat sort for the row tests", () => {
  setSort("recent");
});

test("UI - Sidepanel Keyboard - Arrow keys move the cursor and clamp at both ends", keyNavSkip, () => {
  assert.ok(document.querySelector(".row.cursor") === null, "no cursor initially");
  key("ArrowDown");
  assert.equal(cursorTitle(), "Alpha");
  key("ArrowDown");
  assert.equal(cursorTitle(), "Beta");
  key("ArrowDown");
  key("ArrowDown");
  assert.equal(cursorTitle(), "Gamma", "clamped at last row");
  key("ArrowUp");
  key("ArrowUp");
  assert.equal(cursorTitle(), "Alpha", "back on the first row");
});

test("UI - Sidepanel Keyboard - Enter activates the cursor tab", keyNavSkip, async () => {
  key("ArrowDown"); // Alpha → Beta
  assert.equal(cursorTitle(), "Beta");
  calls.length = 0;
  key("Enter");
  await tick();
  assert.ok(calls.includes("windows.update 1"), "window focused");
  assert.ok(
    calls.some((c) => c.startsWith("tabs.update 2") && c.includes('"active":true')),
    "tab 2 activated",
  );
});

test("UI - Sidepanel Keyboard - Focus leaving the panel drops the cursor", keyNavSkip, () => {
  key("ArrowDown");
  key("ArrowDown");
  assert.ok(document.querySelector(".row.cursor") !== null, "cursor shown while the panel has focus");
  window.dispatchEvent(new window.Event("blur"));
  assert.ok(document.querySelector(".row.cursor") === null, "no outline left behind");
  key("ArrowDown");
  assert.equal(cursorTitle(), q(document, ".row .title").textContent, "the next arrow starts from the first row");
});

// ---------- list mode: the arrows take the keys away from the search ----------

const search = () => byId<HTMLInputElement>("search");
const cursorBox = () => q<HTMLInputElement>(document, '.row.cursor input[type="checkbox"]');
const ticked = () => document.querySelectorAll('.row input[type="checkbox"]:checked').length;

test("UI - Sidepanel Keyboard - An arrow out of the search leaves the field", keyNavSkip, () => {
  window.dispatchEvent(new window.Event("blur")); // no cursor
  search().focus();
  key("ArrowDown");
  assert.ok(document.querySelector(".row.cursor") !== null, "cursor on a row");
  assert.ok(document.activeElement !== search(), "the search is no longer typed into");
});

test("UI - Sidepanel Keyboard - Space ticks and unticks the cursor row, the cursor stays", keyNavSkip, () => {
  const title = cursorTitle();
  assert.equal(cursorBox().checked, false);
  const space = new window.KeyboardEvent("keydown", { key: " ", bubbles: true, cancelable: true });
  document.dispatchEvent(space);
  assert.equal(space.defaultPrevented, true, "the list does not scroll by a page");
  assert.equal(cursorBox().checked, true);
  assert.equal(cursorTitle(), title);
  assert.equal(ticked(), 1);
  key(" ");
  assert.equal(cursorBox().checked, false);
  assert.equal(ticked(), 0);
});

test("UI - Sidepanel Keyboard - Space on a focused control keeps its own job", keyNavSkip, () => {
  const button = byId("bulk-clear");
  const space = new window.KeyboardEvent("keydown", { key: " ", bubbles: true, cancelable: true });
  button.dispatchEvent(space);
  assert.equal(space.defaultPrevented, false);
  assert.equal(ticked(), 0);
});

test("UI - Sidepanel Keyboard - Up on the first row goes back to the search", keyNavSkip, () => {
  assert.equal(cursorTitle(), q(document, ".row .title").textContent, "on the first row");
  key("ArrowUp");
  assert.ok(document.activeElement === search(), "search focused");
  assert.ok(document.querySelector(".row.cursor") === null, "empty query: no cursor");
});

test("UI - Sidepanel Keyboard - Space in the search is a character", keyNavSkip, () => {
  search().value = "a"; // every title has one: the typing puts the cursor on the first row
  search().dispatchEvent(new window.Event("input", { bubbles: true }));
  assert.ok(document.querySelector(".row.cursor") !== null);
  const space = new window.KeyboardEvent("keydown", { key: " ", bubbles: true, cancelable: true });
  search().dispatchEvent(space);
  assert.equal(space.defaultPrevented, false);
  assert.equal(ticked(), 0);
  key("ArrowDown");
  key("ArrowUp");
  key("ArrowUp");
  assert.ok(document.activeElement === search(), "back in the search");
  assert.equal(cursorTitle(), q(document, ".row .title").textContent, "a query keeps the first row for Enter");
  key("Escape");
  search().blur();
  window.dispatchEvent(new window.Event("blur"));
});

const pressedFilter = () => q<HTMLElement>(document, '#filters button[aria-pressed="true"]').dataset.filter;

test("UI - Sidepanel Keyboard - Left and Right step through the filter chips, stopping at the ends", keyNavSkip, () => {
  assert.equal(pressedFilter(), "all");
  key("ArrowRight");
  assert.equal(pressedFilter(), "awake");
  key("ArrowRight");
  assert.equal(pressedFilter(), "snoozed");
  key("ArrowLeft");
  key("ArrowLeft");
  assert.equal(pressedFilter(), "all");
  key("ArrowLeft");
  assert.equal(pressedFilter(), "all", "no wrap at the first chip");
  const last = [...document.querySelectorAll<HTMLElement>("#filters button[data-filter]")].filter(
    (chip) => !chip.hidden,
  );
  for (const _ of last) {
    key("ArrowRight");
  }
  assert.equal(pressedFilter(), last.at(-1)?.dataset.filter, "no wrap at the last chip");
  assert.equal(byId("tags-pop").matches(":popover-open"), false, "the Tags chip reached by key opens no picker");
  for (const _ of last) {
    key("ArrowLeft");
  }
  assert.equal(pressedFilter(), "all");
});

test("UI - Sidepanel Keyboard - Left and Right in the search move the caret, not the filter", keyNavSkip, () => {
  const arrow = new window.KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true, cancelable: true });
  search().dispatchEvent(arrow);
  assert.equal(arrow.defaultPrevented, false);
  assert.equal(pressedFilter(), "all");
});

test("UI - Sidepanel Keyboard - Left and Right do nothing while flag off", { skip: KEY_NAV_ON }, () => {
  key("ArrowRight");
  assert.equal(pressedFilter(), "all");
});

test("UI - Sidepanel Keyboard - Space does nothing while flag off", { skip: KEY_NAV_ON }, () => {
  key(" ");
  assert.equal(ticked(), 0);
});

// ---------- the row menu from the keyboard ----------

const menu = () => byId("ctx-menu");
const menuTitle = () => q(menu(), ".ctx-title").textContent;
// a key as Chrome delivers it: to the focused element, bubbling up (the menu's keys stop on the way)
const keyOn = (target: EventTarget, k: string, init: KeyboardEventInit = {}) =>
  target.dispatchEvent(new window.KeyboardEvent("keydown", { key: k, bubbles: true, cancelable: true, ...init }));
const closeMenu = () => keyOn(document, "Escape");

test("UI - Sidepanel Keyboard - Period opens the cursor row's menu with its first item focused", keyNavSkip, () => {
  key("ArrowDown");
  const title = cursorTitle();
  assert.equal(menu().hidden, true);
  key(".");
  assert.equal(menu().hidden, false);
  assert.equal(menuTitle(), title);
  const focused = document.activeElement;
  assert.ok(focused?.classList.contains("ctx-item"), "focus is on a menu item");
  // the arrows now belong to the menu: the row cursor behind it stays put
  keyOn(focused ?? document, "ArrowDown");
  assert.equal(cursorTitle(), title);
  assert.ok(document.activeElement !== focused, "the menu's own focus moved");
  closeMenu();
  assert.equal(menu().hidden, true);
});

test("UI - Sidepanel Keyboard - No cursor: Period opens the menu of this window's active tab", keyNavSkip, () => {
  window.dispatchEvent(new window.Event("blur")); // drops the cursor
  key(".");
  assert.equal(menu().hidden, false);
  assert.equal(menuTitle(), q(document, ".row.active-tab.current .title").textContent);
  closeMenu();
});

test(
  "UI - Sidepanel Keyboard - Period is a character in the search; the Menu key and Shift+F10 open the menu from there",
  keyNavSkip,
  () => {
    const search = byId("search");
    keyOn(search, ".");
    assert.equal(menu().hidden, true, "typing a dot opens nothing");
    keyOn(search, "ContextMenu");
    assert.equal(menu().hidden, false);
    closeMenu();
    keyOn(search, "F10");
    assert.equal(menu().hidden, true, "plain F10 is not the menu key");
    keyOn(search, "F10", { shiftKey: true });
    assert.equal(menu().hidden, false);
    // the browser's own menu for that key press never shows on top of ours
    const native = new window.MouseEvent("contextmenu", { bubbles: true, cancelable: true });
    search.dispatchEvent(native);
    assert.equal(native.defaultPrevented, true);
    closeMenu();
  },
);

test("UI - Sidepanel Keyboard - Row menu keys do nothing while flag off", { skip: KEY_NAV_ON }, () => {
  key(".");
  keyOn(byId("search"), "ContextMenu");
  assert.equal(menu().hidden, true);
});

test(
  "UI - Sidepanel Keyboard - The Chrome command opens the menu in the panel of the window it names",
  keyNavSkip,
  async () => {
    await mock.runtime.onMessage.fire({ type: "open-row-menu", windowId: 2 });
    assert.equal(menu().hidden, true, "another window's panel: not this one");
    await mock.runtime.onMessage.fire({ type: "open-row-menu", windowId: 1 });
    assert.equal(menu().hidden, false);
    closeMenu();
  },
);

test("UI - Sidepanel Keyboard - Single visible window: header not collapsible", () => {
  const sel = byId<HTMLSelectElement>("sort");
  sel.value = "window";
  sel.dispatchEvent(new window.Event("change", { bubbles: true }));
  const header = q(document, ".group-header");
  assert.ok(header.classList.contains("static"));
  assert.ok(!header.textContent.includes("▾"), "no collapse arrow");
  assert.equal(header.getAttribute("role"), null, "not a button");
  assert.equal(byId("collapse-all").hidden, true, "fold-all hidden for lone window");
  header.click();
  assert.equal(document.querySelectorAll(".row").length, 3, "click does nothing");
  sel.value = "recent";
  sel.dispatchEvent(new window.Event("change", { bubbles: true }));
});

// ---------- group headers as cursor stops (three one-tab groups: a.com, b.com, c.com) ----------
const cursorHeader = () => document.querySelector(".group-header.cursor");
const leaveList = () => {
  window.dispatchEvent(new window.Event("blur"));
  setSort("recent");
};

test("UI - Sidepanel Keyboard - A group header is a cursor stop between the rows", keyNavSkip, () => {
  setSort("group-domain");
  const headers = [...document.querySelectorAll(".group-header")];
  assert.equal(headers.length, 3);
  key("ArrowDown");
  assert.ok(cursorHeader() === headers[0], "first stop: the first header");
  assert.ok(document.querySelector(".row.cursor") === null, "one cursor only");
  key("ArrowDown");
  assert.ok(cursorHeader() === null);
  assert.ok(document.querySelector(".row.cursor") === document.querySelector(".row"), "then its row");
  key("ArrowDown");
  assert.ok(cursorHeader() === headers[1], "then the next header");
  key("ArrowUp");
  key("ArrowUp");
  key("ArrowUp");
  assert.ok(document.activeElement === search(), "Up from the first header: the search");
  assert.ok(cursorHeader() === null);
  leaveList();
});

test("UI - Sidepanel Keyboard - Left folds the cursor header, Right unfolds, the chips stay", keyNavSkip, () => {
  setSort("group-domain");
  key("ArrowDown");
  const filter = pressedFilter();
  key("ArrowRight");
  assert.equal(document.querySelectorAll(".row").length, 3, "already open: Right does nothing");
  key("ArrowLeft");
  assert.equal(document.querySelectorAll(".row").length, 2, "folded");
  assert.ok(cursorHeader() === document.querySelector(".group-header"), "the cursor stays on the header");
  key("ArrowLeft");
  assert.equal(document.querySelectorAll(".row").length, 2, "already folded: Left does nothing");
  key("ArrowDown");
  assert.ok(cursorHeader() === document.querySelectorAll(".group-header")[1], "a folded group's rows are skipped");
  key("ArrowUp");
  key("ArrowRight");
  assert.equal(document.querySelectorAll(".row").length, 3, "unfolded");
  assert.equal(pressedFilter(), filter, "on a header the arrows are not the chips'");
  leaveList();
});

test("UI - Sidepanel Keyboard - Space on the cursor header ticks its tabs, again unticks", keyNavSkip, () => {
  setSort("group-domain");
  key("ArrowDown");
  const space = new window.KeyboardEvent("keydown", { key: " ", bubbles: true, cancelable: true });
  document.dispatchEvent(space);
  assert.equal(space.defaultPrevented, true);
  assert.equal(ticked(), 1, "the group's one tab");
  assert.ok(cursorHeader() !== null, "the cursor stays");
  key(" ");
  assert.equal(ticked(), 0);
  leaveList();
});

test(
  "UI - Sidepanel Keyboard - A lone group's header is a stop too: Space ticks all, nothing folds",
  keyNavSkip,
  () => {
    setSort("window");
    key("ArrowDown");
    assert.ok(cursorHeader() !== null, "first stop: the lone header");
    key(" ");
    assert.equal(ticked(), 3);
    key(" ");
    assert.equal(ticked(), 0);
    key("ArrowLeft");
    key("Enter");
    assert.equal(document.querySelectorAll(".row").length, 3, "a lone group does not fold");
    key("ArrowDown");
    assert.equal(cursorTitle(), q(document, ".row .title").textContent, "then the first row");
    leaveList();
  },
);

test("UI - Sidepanel Keyboard - Period on a window header opens the window's menu, not a row's", keyNavSkip, () => {
  setSort("window");
  key("ArrowDown");
  assert.ok(cursorHeader() !== null);
  key(".");
  const windowMenu = menu().hidden === false;
  // what a right-click on the same header opens is the reference: the shortcut must match it
  closeMenu();
  q(document, ".group-header").dispatchEvent(new window.MouseEvent("contextmenu", { bubbles: true, cancelable: true }));
  const byMouse = menu().hidden === false;
  const mouseTitle = byMouse ? menuTitle() : "";
  closeMenu();
  assert.equal(windowMenu, byMouse, "the shortcut opens a menu exactly when the right-click does");
  if (byMouse) {
    key("ArrowDown");
    key("ArrowUp");
    key(".");
    assert.equal(menuTitle(), mouseTitle, "the same menu");
    assert.ok(document.activeElement?.matches("#ctx-menu > .ctx-item"), "its first item in focus");
    closeMenu();
  }
  leaveList();
});

test("UI - Sidepanel Keyboard - Period on a header without a menu opens none", keyNavSkip, () => {
  setSort("group-domain");
  key("ArrowDown");
  key(".");
  assert.equal(menu().hidden, true, "a domain group has no menu — and no row's menu opens in its place");
  leaveList();
});

test("UI - Sidepanel Keyboard - Typing in the search and leaving the panel drop the header cursor", keyNavSkip, () => {
  setSort("group-domain");
  key("ArrowDown");
  window.dispatchEvent(new window.Event("blur"));
  assert.ok(cursorHeader() === null, "panel left");
  key("ArrowDown");
  assert.ok(cursorHeader() !== null);
  search().value = "a";
  search().dispatchEvent(new window.Event("input", { bubbles: true }));
  assert.ok(cursorHeader() === null, "typing: the cursor is the first result's");
  key("Escape");
  leaveList();
});
