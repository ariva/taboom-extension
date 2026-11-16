import assert from "node:assert/strict";
import { Window } from "happy-dom";
import { test } from "vitest";

const win = new Window();
Object.assign(globalThis, { window: win, document: win.document, Event: win.Event, DOMParser: win.DOMParser });
const { dragGrip, initRowReorder } = await import("../../../src/lib/ui/row-reorder.ts");

function table(keys: string[]): { body: HTMLElement; rows: () => HTMLTableRowElement[] } {
  const body = document.createElement("tbody");
  for (const key of keys) {
    const row = document.createElement("tr");
    row.dataset.key = key;
    row.draggable = true;
    row.append(document.createElement("td"));
    body.append(row);
  }
  document.body.append(body);
  return { body, rows: () => [...body.querySelectorAll("tr")] };
}

const fire = (target: Element, type: string) =>
  target.dispatchEvent(new window.Event(type, { bubbles: true, cancelable: true }));
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

test("Lib - UI - Row reorder - dragstart dims the row, dragover marks the target, drop reports both keys", async () => {
  const { body, rows } = table(["a", "b", "c"]);
  const drops: [string, string][] = [];
  initRowReorder(body, async (dragged, target) => {
    drops.push([dragged, target]);
    return true;
  });
  const [first, , third] = rows();
  fire(first!, "dragstart");
  assert.ok(first!.classList.contains("dragging"));
  const over = new window.Event("dragover", { bubbles: true, cancelable: true });
  third!.dispatchEvent(over);
  assert.ok(over.defaultPrevented, "a row is a drop target");
  assert.ok(third!.classList.contains("drop-target"));
  fire(third!, "drop");
  await settle();
  assert.deepEqual(drops, [["a", "c"]]);
  assert.ok(!third!.classList.contains("drop-target"), "cleared on drop");
  fire(first!, "dragend");
  assert.ok(!first!.classList.contains("dragging"));
});

test("Lib - UI - Row reorder - the dragged row is no target of its own, and nothing is reported without a drag", async () => {
  const { body, rows } = table(["a", "b"]);
  const drops: string[] = [];
  initRowReorder(body, async (dragged, target) => {
    drops.push(`${dragged}>${target}`);
    return true;
  });
  const [first, second] = rows();
  fire(second!, "drop"); // no dragstart before it
  await settle();
  assert.deepEqual(drops, []);
  fire(first!, "dragstart");
  const over = new window.Event("dragover", { bubbles: true, cancelable: true });
  first!.dispatchEvent(over);
  assert.ok(!over.defaultPrevented, "onto itself: the no-drop cursor");
  assert.ok(!first!.classList.contains("drop-target"));
});

test("Lib - UI - Row reorder - dragGrip is a titled six-dot handle", () => {
  const grip = dragGrip();
  assert.equal(grip.className, "drag-grip");
  assert.equal(grip.title, "Drag to reorder");
  assert.equal(grip.querySelectorAll("circle").length, 6);
});
