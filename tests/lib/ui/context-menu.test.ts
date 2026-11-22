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
  focusCtxMenu,
  hideCtxMenu,
  hideCtxMenuForRender,
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

test("Lib - UI - Context menu - A host re-render closes a menu unless its staysWhile still holds", () => {
  showCtxMenu(at(0, 0));
  hideCtxMenuForRender();
  assert.equal(isCtxMenuOpen(), false, "a menu shown without staysWhile goes: its ids may be stale");
  clearCtxMenu();
  let rowsThere = true;
  showCtxMenu(at(0, 0), undefined, { staysWhile: () => rowsThere });
  hideCtxMenuForRender();
  assert.equal(isCtxMenuOpen(), true, "its rows survived: the menu stays");
  rowsThere = false;
  hideCtxMenuForRender();
  assert.equal(isCtxMenuOpen(), false, "a row gone: the menu goes");
  clearCtxMenu();
  showCtxMenu(at(0, 0), "Close", { staysWhile: () => true });
  hideCtxMenuForRender();
  assert.equal(isCtxMenuOpen(), true, "a menu that depends on nothing in the list stays");
  hideCtxMenu();
  assert.equal(isCtxMenuOpen(), false, "the ordinary hide still works on it");
  clearCtxMenu();
  showCtxMenu(at(0, 0));
  hideCtxMenuForRender();
  assert.equal(isCtxMenuOpen(), false, "clear resets the flag for the next build");
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

// ---------- keyboard ----------

const press = (key: string, target: EventTarget = document.activeElement ?? document) => {
  const event = new win.KeyboardEvent("keydown", { key, bubbles: true, cancelable: true });
  target.dispatchEvent(event as unknown as Event); // happy-dom's event class, the DOM's dispatch signature
  return event;
};
const focusedLabel = () => document.activeElement?.textContent;

function buildKeyboardMenu(ran: string[]): void {
  const move = ctxSubmenu("Move to");
  move.submenu.append(
    ctxItem("Window #1", () => ran.push("w1")),
    ctxItem("Window #2", () => ran.push("w2")),
  );
  const disabled = ctxItem("Disabled", () => ran.push("disabled"));
  disabled.disabled = true;
  ctxAppend(
    ctxTitle("Tab"),
    ctxItem("Copy URL", () => ran.push("copy")),
    disabled,
    move.btn,
    move.submenu,
    ctxItem("Close tab", () => ran.push("close")),
  );
  showCtxMenu(at(0, 0));
}

test("Lib - UI - Context menu - focusCtxMenu puts focus on the first item; closing gives it back", () => {
  const search = document.createElement("input");
  document.body.append(search);
  search.focus();
  buildKeyboardMenu([]);
  focusCtxMenu();
  assert.equal(focusedLabel(), "Copy URL");
  hideCtxMenu();
  assert.ok(document.activeElement === search, "focus back where it was");
  search.remove();
});

test("Lib - UI - Context menu - Arrows walk the enabled items of one level and wrap", () => {
  buildKeyboardMenu([]);
  focusCtxMenu();
  press("ArrowDown");
  assert.equal(focusedLabel(), "Move to ▸", "the disabled item and the title are skipped");
  press("ArrowDown");
  assert.equal(focusedLabel(), "Close tab", "the folded submenu's items are not on this level");
  press("ArrowDown");
  assert.equal(focusedLabel(), "Copy URL", "wraps to the top");
  press("ArrowUp");
  assert.equal(focusedLabel(), "Close tab", "wraps to the bottom");
  press("Home");
  assert.equal(focusedLabel(), "Copy URL");
  press("End");
  assert.equal(focusedLabel(), "Close tab");
});

test("Lib - UI - Context menu - A first arrow enters a menu opened by the mouse", () => {
  buildKeyboardMenu([]);
  const event = press("ArrowDown", document);
  assert.equal(focusedLabel(), "Copy URL");
  assert.equal(event.defaultPrevented, true);
});

test("Lib - UI - Context menu - Right enters a submenu, Left leaves it", () => {
  buildKeyboardMenu([]);
  focusCtxMenu();
  press("ArrowDown");
  press("ArrowRight");
  assert.equal(focusedLabel(), "Window #1");
  assert.deepEqual(carets(), ["▾"]);
  press("ArrowDown");
  assert.equal(focusedLabel(), "Window #2");
  press("ArrowDown");
  assert.equal(focusedLabel(), "Window #1", "wraps inside the submenu");
  press("ArrowLeft");
  assert.equal(focusedLabel(), "Move to ▸");
  assert.deepEqual(carets(), ["▸"]);
});

test("Lib - UI - Context menu - Enter on a plain submenu toggle enters it; on one with its own action it is left to the click", () => {
  buildKeyboardMenu([]);
  focusCtxMenu();
  press("ArrowDown");
  const entered = press("Enter");
  assert.equal(focusedLabel(), "Window #1");
  assert.equal(entered.defaultPrevented, true, "no click on top that would fold it again");
  hideCtxMenu();
  clearCtxMenu();
  const protect = ctxSubmenu("Protect", () => {});
  protect.submenu.append(ctxItem("1 hour", () => {}));
  ctxAppend(protect.btn, protect.submenu);
  showCtxMenu(at(0, 0));
  focusCtxMenu();
  const left = press("Enter");
  assert.equal(left.defaultPrevented, false, "the button's own click runs the action");
  assert.equal(focusedLabel(), "Protect ▸");
});

test("Lib - UI - Context menu - Keys on a focused item stay in the menu; keys do nothing while it is closed", () => {
  const seen: string[] = [];
  const listener = (event: Event) => seen.push((event as unknown as KeyboardEvent).key); // happy-dom's event
  document.addEventListener("keydown", listener);
  buildKeyboardMenu([]);
  focusCtxMenu();
  press("ArrowDown");
  press("Enter");
  press(" ");
  assert.deepEqual(seen, [], "the host's arrow / Enter handlers never see them");
  hideCtxMenu();
  const closed = press("ArrowDown", document);
  assert.deepEqual(seen, ["ArrowDown"]);
  assert.equal(closed.defaultPrevented, false);
  document.removeEventListener("keydown", listener);
});

test("Lib - UI - Context menu - Menu roles for assistive technology", () => {
  buildKeyboardMenu([]);
  assert.equal(menu.getAttribute("role"), "menu");
  const toggle = menu.querySelector(".ctx-move") as HTMLElement; // `as`: built above
  assert.equal(toggle.getAttribute("aria-haspopup"), "menu");
  assert.equal(toggle.getAttribute("aria-expanded"), "false");
  assert.deepEqual(
    [...menu.querySelectorAll(".ctx-item")].map((item) => item.getAttribute("role")),
    ["menuitem", "menuitem", "menuitem", "menuitem", "menuitem", "menuitem"],
  );
  focusCtxMenu();
  press("ArrowDown");
  press("ArrowRight");
  assert.equal(toggle.getAttribute("aria-expanded"), "true");
});
