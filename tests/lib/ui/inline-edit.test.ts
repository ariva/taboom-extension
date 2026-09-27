import assert from "node:assert/strict";
import { Window } from "happy-dom";
import { beforeEach, test } from "vitest";

// the module registers its document listeners at import time — DOM globals first
const win = new Window();
Object.assign(globalThis, {
  window: win,
  document: win.document,
  Event: win.Event,
  KeyboardEvent: win.KeyboardEvent,
  MouseEvent: win.MouseEvent,
});
const { inlineEdit } = await import("../../../src/lib/ui/inline-edit.ts");

const tick = () => new Promise((resolve) => setTimeout(resolve, 0)); // the blur handler awaits commit()

interface Edit {
  input: HTMLInputElement;
  committed: string[];
  finished: () => number;
}

function startEdit(): Edit {
  const label = document.createElement("span");
  label.className = "label";
  document.body.append(label);
  const committed: string[] = [];
  let finishes = 0;
  inlineEdit(label, {
    initial: "Old",
    placeholder: "Name",
    commit: async (value) => {
      committed.push(value);
    },
    finish: () => finishes++,
  });
  // `as`: inlineEdit just swapped the label for this input
  return { input: document.querySelector(".rename-input") as HTMLInputElement, committed, finished: () => finishes };
}

const key = (el: Element, name: string) => el.dispatchEvent(new KeyboardEvent("keydown", { key: name, bubbles: true }));
const mouse = (el: Element, type: string) =>
  el.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true }));

beforeEach(() => {
  document.body.replaceChildren();
  mouse(document.body, "mousedown"); // a fresh press drops any armed swallow
  mouse(document.body, "mouseup");
});

test("Lib - UI - Inline edit - The label becomes a focused input carrying initial and placeholder", () => {
  const { input } = startEdit();
  assert.equal(document.querySelector(".label"), null);
  assert.equal(input.value, "Old");
  assert.equal(input.placeholder, "Name");
  assert.equal(document.activeElement, input);
});

test("Lib - UI - Inline edit - Enter commits the value, then finishes", async () => {
  const edit = startEdit();
  edit.input.value = "New";
  key(edit.input, "Enter");
  await tick();
  assert.deepEqual(edit.committed, ["New"]);
  assert.equal(edit.finished(), 1);
});

test("Lib - UI - Inline edit - Esc cancels: no commit, still finishes", async () => {
  const edit = startEdit();
  edit.input.value = "New";
  key(edit.input, "Escape");
  await tick();
  assert.deepEqual(edit.committed, []);
  assert.equal(edit.finished(), 1);
});

test("Lib - UI - Inline edit - Blur commits, an empty value included", async () => {
  const edit = startEdit();
  edit.input.value = "";
  edit.input.blur();
  await tick();
  assert.deepEqual(edit.committed, [""]);
  assert.equal(edit.finished(), 1);
});

test("Lib - UI - Inline edit - Keys and clicks inside the input do not reach the host", () => {
  const host = document.createElement("div");
  document.body.append(host);
  const label = document.createElement("span");
  host.append(label);
  const seen: string[] = [];
  host.addEventListener("keydown", () => seen.push("keydown"));
  host.addEventListener("click", () => seen.push("click"));
  inlineEdit(label, { initial: "", placeholder: "", commit: () => {}, finish: () => {} });
  const input = host.querySelector(".rename-input") as HTMLInputElement; // `as`: just inserted
  key(input, "a");
  mouse(input, "click");
  assert.deepEqual(seen, []);
});

test("Lib - UI - Inline edit - A blur during a press swallows exactly the next click", async () => {
  const button = document.createElement("button");
  document.body.append(button);
  let clicks = 0;
  button.addEventListener("click", () => clicks++);
  const edit = startEdit();

  mouse(button, "mousedown"); // the press that takes the focus away
  edit.input.blur();
  mouse(button, "mouseup");
  const swallowed = new MouseEvent("click", { bubbles: true, cancelable: true });
  button.dispatchEvent(swallowed);
  await tick();
  assert.equal(clicks, 0, "the press only ended the edit");
  assert.equal(swallowed.defaultPrevented, true);
  assert.deepEqual(edit.committed, ["Old"]);

  mouse(button, "click");
  assert.equal(clicks, 1, "the click after it acts normally");
});

test("Lib - UI - Inline edit - A blur without a press (Enter, focus move) swallows nothing", async () => {
  const button = document.createElement("button");
  document.body.append(button);
  let clicks = 0;
  button.addEventListener("click", () => clicks++);
  const edit = startEdit();
  key(edit.input, "Enter");
  await tick();
  mouse(button, "click");
  assert.equal(clicks, 1);
});

test("Lib - UI - Inline edit - An armed swallow is dropped by the next press when no click came", async () => {
  const button = document.createElement("button");
  document.body.append(button);
  let clicks = 0;
  button.addEventListener("click", () => clicks++);
  const edit = startEdit();
  mouse(button, "mousedown");
  edit.input.blur(); // armed — but the pressed node gets detached, so no click follows
  mouse(button, "mouseup");
  await tick();

  mouse(button, "mousedown");
  mouse(button, "mouseup");
  mouse(button, "click");
  assert.equal(clicks, 1);
});
