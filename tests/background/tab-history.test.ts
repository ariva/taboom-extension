// tab-history.ts through the worker entry, against a Chrome-faithful stub: tabs.update
// fires onActivated (only when the tab was not active) and windows.update fires
// onFocusChanged — the events a jump provokes, delivered before the call resolves.
import assert from "node:assert/strict";
import { test } from "vitest";
import type { ChromeMockOptions } from "../helpers/chrome-mock.ts";
import { makeChrome, tick, TEST_FEATURES } from "../helpers/ui.ts";

const { resolveNavMode } = await import("../../src/app/core.ts");
const TRADITIONAL_DEFAULT = resolveNavMode(TEST_FEATURES, {}) === "traditional";
const skip = { skip: !TRADITIONAL_DEFAULT }; // traces assume traditional push semantics

const tab = (id: number, windowId: number, active: boolean): NonNullable<ChromeMockOptions["tabs"]>[number] => ({
  id,
  windowId,
  active,
  discarded: false,
  pinned: false,
  audible: false,
  autoDiscardable: true,
  url: `https://t${id}.example.com/`,
  title: `T${id}`,
  lastAccessed: Date.now(),
});
// window 1: tabs 1-3 (1 active); window 2: tabs 4-5 (4 active)
const tabs: ChromeMockOptions["tabs"] = [
  tab(1, 1, true),
  tab(2, 1, false),
  tab(3, 1, false),
  tab(4, 2, true),
  tab(5, 2, false),
];
const calls: string[] = [];
const chrome = makeChrome({ tabs, calls, stored: {} });

// Chrome behaviour the generic stub leaves out. The events are kicked off, not awaited:
// Chrome dispatches them before the update call resolves, and the listeners queue
// behind the jump that is in flight (awaiting them here would deadlock on that queue).
chrome.tabs.update = async (id: number, props: chrome.tabs.UpdateProperties = {}) => {
  calls.push(`tabs.update ${id} ${JSON.stringify(props)}`);
  const target = tabs.find((t) => t.id === id);
  if (!target) {
    throw new Error(`no tab ${id}`);
  }
  if (props.active && !target.active) {
    for (const other of tabs.filter((t) => t.windowId === target.windowId)) {
      other.active = false;
    }
    target.active = true;
    void chrome.tabs.onActivated.fire({ tabId: id, windowId: target.windowId });
  }
  return target as chrome.tabs.Tab;
};
let focusedWindow = 1;
chrome.windows.update = async (id: number) => {
  if (id !== focusedWindow) {
    focusedWindow = id;
    void chrome.windows.onFocusChanged.fire(id);
  }
  return calls.push(`windows.update ${id}`); // the stub's own signature: nothing reads the result
};
Object.assign(globalThis, { chrome });
await import("../../src/background/service-worker.ts");

// the user switches tabs / windows: the same events Chrome sends
async function userActivates(tabId: number): Promise<void> {
  await chrome.tabs.update(tabId, { active: true });
  await tick();
}
async function userFocusesWindow(windowId: number): Promise<void> {
  await chrome.windows.update(windowId);
  await tick();
}
const history = async () => (await chrome.storage.local.get()).tabHistory;
const activeIn = (windowId: number) => tabs.find((t) => t.windowId === windowId && t.active)?.id;

test("Tab history - Trail built from user activations across two windows", skip, async () => {
  await userActivates(2);
  await userActivates(3);
  await userFocusesWindow(2); // window 2's active tab (4) enters the trail
  await userActivates(5);
  assert.deepEqual(await history(), { stack: [2, 3, 4, 5], cursor: 3 });
});

test("Tab history - Back to a tab in another window does not record that window's old active tab", skip, async () => {
  // user is in window 2 on tab 5; two steps back = tab 3 in window 1 (whose active tab is 3 — fine),
  // then one more back = tab 4 in window 2, where tab 5 is still the active tab
  await chrome.commands.onCommand.fire("history-back");
  await tick();
  assert.equal(activeIn(1), 3);
  await chrome.commands.onCommand.fire("history-back");
  await tick();
  assert.equal(activeIn(2), 4);
  assert.deepEqual(
    await history(),
    { stack: [2, 3, 4, 5], cursor: 1 },
    "the trail is untouched; only the cursor moved",
  );
});

test("Tab history - Two quick back presses step twice (key auto-repeat)", skip, async () => {
  // cursor 1 (tab 3) → 0 (tab 2) → below range: the second press is a no-op at the start,
  // so rebuild a longer trail first: forward twice, then two presses at once
  await chrome.commands.onCommand.fire("history-forward");
  await chrome.commands.onCommand.fire("history-forward");
  await tick();
  assert.deepEqual(await history(), { stack: [2, 3, 4, 5], cursor: 3 });
  await Promise.all([chrome.commands.onCommand.fire("history-back"), chrome.commands.onCommand.fire("history-back")]);
  await tick();
  assert.deepEqual(await history(), { stack: [2, 3, 4, 5], cursor: 1 }, "each press is one step");
  assert.equal(activeIn(1), 3);
});

test("Tab history - Manual switches after the jumps are all recorded", skip, async () => {
  // user is in window 1 on tab 3 (cursor 1): focusing window 2 records its active tab 4
  // and truncates the forward part; picking tab 5 appends; back to window 1 records tab 3
  await userFocusesWindow(2);
  await userActivates(5);
  await userFocusesWindow(1);
  assert.deepEqual(await history(), { stack: [2, 3, 4, 5, 3], cursor: 4 }, "no activation swallowed");
});
