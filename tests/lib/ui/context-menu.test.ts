import assert from "node:assert/strict";
import { Window } from "happy-dom";
import { afterEach, beforeEach, test, vi } from "vitest";

// the module builds #ctx-menu and registers its dismiss listeners at import time
const win = new Window();
Object.assign(globalThis, { window: win, document: win.document, Event: win.Event, MouseEvent: win.MouseEvent });
const {
  clearCtxMenu,
  ctxAppend,
  ctxDivider,
  ctxItem,
  ctxMenuContains,
  ctxSubmenu,
  ctxTitle,
  hideCtxMenu,
  isCtxMenuOpen,
  showCtxMenu,
} = await import("../../../src/lib/ui/context-menu.ts");

const menu = document.getElementById("ctx-menu") as HTMLElement; // `as`: built by the import above
const at = (x: number, y: number) => new MouseEvent("contextmenu", { clientX: x, clientY: y });
const carets = () => [...menu.querySelectorAll(".ctx-caret")].map((caret) => caret.textContent);

beforeEach(() => {
  hideCtxMenu();
  clearCtxMenu();
});
afterEach(() => {
  vi.useRealTimers();
});

test("Lib - UI - Context menu - Starts hidden; show stamps a close button and opens at the pointer", () => {
  assert.equal(isCtxMenuOpen(), false);
  ctxAppend(
    ctxTitle("Window #1"),
    ctxDivider(),
    ctxItem("Close", () => {}),
  );
  showCtxMenu(at(10, 20));
  assert.equal(isCtxMenuOpen(), true);
  assert.deepEqual(
    [...menu.children].map((el) => el.className),
    ["ctx-close", "ctx-title", "ctx-divider", "ctx-item"],
  );
  assert.equal(menu.style.left, "10px");
  assert.equal(menu.style.top, "20px");
  (menu.querySelector(".ctx-close") as HTMLElement).click(); // `as`: asserted present above
  assert.equal(isCtxMenuOpen(), false);
});

test("Lib - UI - Context menu - An item click hides the menu, then runs", () => {
  const openWhenRun: boolean[] = [];
  const item = ctxItem("Snooze", () => openWhenRun.push(isCtxMenuOpen()));
  ctxAppend(item);
  showCtxMenu(at(0, 0));
  item.click();
  assert.deepEqual(openWhenRun, [false]);
});

test("Lib - UI - Context menu - clear empties the menu for the next build; contains() covers its parts only", () => {
  const item = ctxItem("Wake", () => {});
  ctxAppend(item);
  assert.equal(ctxMenuContains(item), true);
  assert.equal(ctxMenuContains(document.body), false);
  assert.equal(ctxMenuContains(null), false);
  clearCtxMenu();
  assert.equal(menu.children.length, 0);
});

test("Lib - UI - Context menu - A click elsewhere and a window blur dismiss the menu", () => {
  showCtxMenu(at(0, 0));
  document.body.click();
  assert.equal(isCtxMenuOpen(), false);
  showCtxMenu(at(0, 0));
  window.dispatchEvent(new Event("blur"));
  assert.equal(isCtxMenuOpen(), false);
});

test("Lib - UI - Context menu - Submenu: click toggles, the menu stays open, the caret mirrors the state", () => {
  const move = ctxSubmenu("Move to");
  ctxAppend(move.btn, move.submenu);
  showCtxMenu(at(0, 0));
  assert.equal(move.submenu.hidden, true);
  move.btn.click();
  assert.equal(move.submenu.hidden, false);
  assert.deepEqual(carets(), ["▾"]);
  assert.equal(isCtxMenuOpen(), true, "the toggle click is not a click-away");
  move.btn.click();
  assert.equal(move.submenu.hidden, true);
  assert.deepEqual(carets(), ["▸"]);
});

test("Lib - UI - Context menu - Submenu accordion: opening one folds the others", () => {
  const move = ctxSubmenu("Move to");
  const color = ctxSubmenu("Color");
  ctxAppend(move.btn, move.submenu, color.btn, color.submenu);
  showCtxMenu(at(0, 0));
  move.btn.click();
  color.btn.click();
  assert.equal(move.submenu.hidden, true);
  assert.equal(color.submenu.hidden, false);
  assert.deepEqual(carets(), ["▸", "▾"]);
});

test("Lib - UI - Context menu - Submenu hover intent: opens after the cursor settles, not when it passes", () => {
  vi.useFakeTimers();
  const move = ctxSubmenu("Move to");
  ctxAppend(move.btn, move.submenu);
  showCtxMenu(at(0, 0));

  move.btn.dispatchEvent(new MouseEvent("mouseenter"));
  vi.advanceTimersByTime(499);
  move.btn.dispatchEvent(new MouseEvent("mouseleave"));
  vi.advanceTimersByTime(1000);
  assert.equal(move.submenu.hidden, true, "passing over does not open");

  move.btn.dispatchEvent(new MouseEvent("mouseenter"));
  vi.advanceTimersByTime(500);
  assert.equal(move.submenu.hidden, false);

  // a pending hover-open must not undo a click-fold
  move.btn.click();
  move.btn.dispatchEvent(new MouseEvent("mouseenter"));
  move.btn.click();
  move.btn.click();
  vi.advanceTimersByTime(1000);
  assert.equal(move.submenu.hidden, true);
});
