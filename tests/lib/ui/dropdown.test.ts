import assert from "node:assert/strict";
import { Window } from "happy-dom";
import { beforeEach, test } from "vitest";

// the module builds its .dd-pop list and registers dismiss listeners at import time
const win = new Window();
Object.assign(globalThis, {
  window: win,
  document: win.document,
  Event: win.Event,
  KeyboardEvent: win.KeyboardEvent,
  MouseEvent: win.MouseEvent,
});
const { attachDropdown } = await import("../../../src/lib/ui/dropdown.ts");

const pop = document.querySelector(".dd-pop") as HTMLElement; // `as`: built by the import above
const labels = () => [...pop.querySelectorAll(".dd-item")].map((item) => item.textContent);
const press = (el: Element) => el.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true }));
const key = (el: Element, init: KeyboardEventInit) =>
  el.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, cancelable: true, ...init }));

let select: HTMLSelectElement;
let changes: string[];

beforeEach(() => {
  press(document.body); // closes a list left open by the previous test
  document.querySelector("select")?.remove();
  select = document.createElement("select");
  select.innerHTML =
    '<option value="a">Alpha</option><option value="b">Beta</option><option value="c" hidden>Gamma</option>';
  document.body.append(select);
  changes = [];
  select.addEventListener("change", () => changes.push(select.value));
  attachDropdown(select);
});

test("Lib - UI - Dropdown - A press opens the list instead of the native popup; hidden options stay out", () => {
  assert.equal(pop.hidden, true);
  const event = new MouseEvent("mousedown", { bubbles: true, cancelable: true });
  select.dispatchEvent(event);
  assert.equal(event.defaultPrevented, true);
  assert.equal(pop.hidden, false);
  assert.deepEqual(labels(), ["Alpha", "Beta"]);
  assert.equal(pop.querySelector(".dd-item.current")?.textContent, "Alpha");
  assert.equal(document.activeElement, select, "preventDefault swallowed the focus — restored by hand");
});

test("Lib - UI - Dropdown - Picking an item sets the value, fires change once and closes", () => {
  press(select);
  (pop.querySelectorAll(".dd-item")[1] as HTMLElement).click(); // `as`: two items asserted above
  assert.equal(select.value, "b");
  assert.deepEqual(changes, ["b"]);
  assert.equal(pop.hidden, true);
});

test("Lib - UI - Dropdown - Picking the current item closes without a change event", () => {
  press(select);
  (pop.querySelector(".dd-item.current") as HTMLElement).click(); // `as`: the list is open
  assert.deepEqual(changes, []);
  assert.equal(pop.hidden, true);
});

test("Lib - UI - Dropdown - A second press, a press elsewhere and a window blur close the list", () => {
  press(select);
  press(select);
  assert.equal(pop.hidden, true);
  press(select);
  press(document.body);
  assert.equal(pop.hidden, true);
  press(select);
  window.dispatchEvent(new Event("blur"));
  assert.equal(pop.hidden, true);
});

test("Lib - UI - Dropdown - Enter, Space and Alt+Arrow open; plain arrows stay native; Esc closes without bubbling", () => {
  for (const init of [
    { key: "Enter" },
    { key: " " },
    { key: "ArrowDown", altKey: true },
    { key: "ArrowUp", altKey: true },
  ]) {
    key(select, init);
    assert.equal(pop.hidden, false, JSON.stringify(init));
    press(document.body);
  }
  key(select, { key: "ArrowDown" });
  assert.equal(pop.hidden, true);

  let bubbled = 0;
  document.body.addEventListener("keydown", () => bubbled++);
  press(select);
  key(select, { key: "Escape" });
  assert.equal(pop.hidden, true);
  assert.equal(bubbled, 0, "Esc only closes the list");
  key(select, { key: "Escape" });
  assert.equal(bubbled, 1, "with no list open Esc belongs to the page");
});
