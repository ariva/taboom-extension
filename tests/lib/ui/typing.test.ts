import assert from "node:assert/strict";
import { Window } from "happy-dom";
import { test } from "vitest";

// the module registers its document listeners at import time — DOM globals first
const win = new Window();
Object.assign(globalThis, { window: win, document: win.document, Event: win.Event });
const { isBeingTyped } = await import("../../../src/lib/ui/typing.ts");

function field(): HTMLInputElement {
  const input = document.createElement("input");
  document.body.append(input);
  return input;
}

test("Lib - UI - Typing - A field is being typed between its first input event and its change", () => {
  const input = field();
  assert.equal(isBeingTyped(input), false);
  input.dispatchEvent(new Event("input", { bubbles: true }));
  assert.equal(isBeingTyped(input), true);
  input.dispatchEvent(new Event("change", { bubbles: true }));
  assert.equal(isBeingTyped(input), false, "committed: the store's value may show again");
});

test("Lib - UI - Typing - A blur without a change settles the field too", () => {
  const input = field();
  input.dispatchEvent(new Event("input", { bubbles: true }));
  input.dispatchEvent(new Event("blur")); // blur does not bubble; the listener is capture-phase
  assert.equal(isBeingTyped(input), false);
});
