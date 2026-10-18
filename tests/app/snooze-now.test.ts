import assert from "node:assert/strict";
import { test } from "vitest";
import { makeChrome } from "../helpers/ui.ts";

// the Settings button and the ☰ quick action show the same status line
test("Core - Snooze now - Asks the worker for one pass and words the count", async () => {
  const calls: string[] = [];
  const chrome = makeChrome({ calls, stored: {} });
  let reply: object = { snoozed: 3 };
  chrome.runtime.sendMessage = async (msg: { type: string }) => {
    calls.push(`sendMessage ${msg.type}`);
    return reply;
  };
  Object.assign(globalThis, { chrome });
  const { snoozeInactiveNow } = await import("../../src/app/snooze-now.ts");

  assert.equal(await snoozeInactiveNow(), "Snoozed 3 tabs");
  assert.deepEqual(calls, ["sendMessage snooze-all-inactive"]);
  reply = { snoozed: 1 };
  assert.equal(await snoozeInactiveNow(), "Snoozed 1 tab");
  reply = { snoozed: 0 };
  assert.equal(await snoozeInactiveNow(), "Snoozed 0 tabs");
  reply = { error: "boom" };
  assert.equal(await snoozeInactiveNow(), "Snooze failed");
  reply = undefined as unknown as object; // no listener answered
  assert.equal(await snoozeInactiveNow(), "Snooze failed");
});
