import assert from "node:assert/strict";
import { Window } from "happy-dom";
import { afterEach, test, vi } from "vitest";

const win = new Window();
Object.assign(globalThis, { window: win, document: win.document });
win.document.body.innerHTML = '<div id="toast" hidden></div>';
const { toast } = await import("../../../src/lib/ui/toast.ts");

const el = document.getElementById("toast") as HTMLElement; // `as`: markup set above

afterEach(() => {
  vi.useRealTimers();
});

test("Lib - UI - Toast - Shows the message in #toast and hides it after 5 s", () => {
  vi.useFakeTimers();
  toast("2 tabs snoozed");
  assert.equal(el.hidden, false);
  assert.equal(el.textContent, "2 tabs snoozed");
  vi.advanceTimersByTime(4999);
  assert.equal(el.hidden, false);
  vi.advanceTimersByTime(1);
  assert.equal(el.hidden, true);
});

test("Lib - UI - Toast - A newer message restarts the timer", () => {
  vi.useFakeTimers();
  toast("first");
  vi.advanceTimersByTime(4000);
  toast("second");
  vi.advanceTimersByTime(4000);
  assert.equal(el.hidden, false, "the first message's timer was cancelled");
  assert.equal(el.textContent, "second");
  vi.advanceTimersByTime(1000);
  assert.equal(el.hidden, true);
});
