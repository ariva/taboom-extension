import assert from "node:assert/strict";
import { Window } from "happy-dom";
import { test } from "vitest";

const win = new Window();
Object.assign(globalThis, { window: win, document: win.document, Event: win.Event });
const { onBusyClick } = await import("../../../src/lib/ui/busy-button.ts");

test("Lib - UI - Busy button - A click runs once; a second click before the work settles is ignored", async () => {
  const button = document.createElement("button");
  document.body.append(button);
  let runs = 0;
  let release: () => void = () => {};
  onBusyClick(button, () => {
    runs++;
    return new Promise<void>((resolve) => {
      release = resolve;
    });
  });
  button.click();
  button.click();
  assert.equal(runs, 1, "the second click found the button busy");
  assert.equal(button.disabled, true, "busy = disabled, so the browser drops the clicks too");
  release();
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(button.disabled, false, "settled: clickable again");
  button.click();
  assert.equal(runs, 2);
});
