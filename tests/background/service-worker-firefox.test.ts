// The worker on Firefox (T-0152): an event page without tabs.onReplaced, sidePanel or a cached
// favicon store. Registration must not stop at the first API Firefox lacks, and the toolbar
// button must reach the sidebar. Its own file: the worker module registers at import time.
import assert from "node:assert/strict";
import { test } from "vitest";
import { makeChrome as makeChromeMock } from "../helpers/chrome-mock.ts";

// always the Firefox shape, whatever project runs this file
const calls: string[] = [];
const chrome = makeChromeMock({
  browser: "firefox",
  calls,
  tabs: [{ id: 1, windowId: 1, active: true, url: "https://a.test/", title: "A" }],
});
Object.assign(globalThis, { chrome, browser: chrome });
await import("../../src/background/service-worker.ts");

test("Service Worker - Firefox: starts without tabs.onReplaced and still registers everything after it", async () => {
  assert.equal("onReplaced" in chrome.tabs, false, "the Firefox-shaped mock has no onReplaced");
  await chrome.commands.onCommand.fire("open-tab-manager");
  assert.ok(calls.includes("sidebarAction.open"), `the command listener (registered after onReplaced) ran: ${calls}`);
});

test("Service Worker - Firefox: the toolbar button toggles the sidebar", async () => {
  calls.length = 0;
  await chrome.action.onClicked.fire();
  assert.deepEqual(calls, ["sidebarAction.toggle"]);
});

test("Service Worker - Firefox: init skips the Chrome-only panel behaviour and finishes", async () => {
  calls.length = 0;
  await chrome.runtime.onInstalled.fire();
  assert.ok(calls.includes("contextMenus.create root"), "menus created");
  assert.ok(!calls.some((call) => call.startsWith("sidePanel.")), "no sidePanel call on Firefox");
});
