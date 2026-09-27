import assert from "node:assert/strict";
import { test } from "vitest";
import type { AppState } from "../../../../src/app/types.ts";
import { refresh, registerPanel, render } from "../../../../src/pages/sidepanel/foundation/scheduler.ts";

// first: nothing is registered yet in this file's module instance
test("Sidepanel - Scheduler - Calling before registerPanel throws instead of silently doing nothing", () => {
  assert.throws(() => render(), /registerPanel/);
  assert.throws(() => refresh(), /registerPanel/);
});

test("Sidepanel - Scheduler - Forwards arguments untouched, omitted ones stay omitted", async () => {
  const calls: unknown[][] = [];
  const done = Promise.resolve();
  registerPanel({
    render: (...args) => void calls.push(["render", ...args]),
    refresh: (...args) => {
      calls.push(["refresh", ...args]);
      return done;
    },
  });
  const preloaded = { ui: {} } as AppState; // `as`: only identity matters here
  render();
  render(false);
  assert.equal(refresh(true, preloaded), done, "the implementation's promise comes back as is");
  await refresh();
  assert.deepEqual(calls, [
    ["render", undefined], // undefined triggers the implementation's own default
    ["render", false],
    ["refresh", true, preloaded],
    ["refresh", undefined, undefined],
  ]);
});
