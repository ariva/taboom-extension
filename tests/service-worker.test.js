// Service-worker tests: no DOM needed, just the chrome stub with capturing
// events so we can fire onInstalled / onAlarm / onMessage like Chrome would.
import assert from "node:assert/strict";
import { test } from "node:test";
import { makeChrome, tick } from "./helpers/ui.js";

const NOW = Date.now();
const HOUR = 3_600_000;
const tabs = [
  { id: 1, windowId: 1, active: true, discarded: false, pinned: false, audible: false,
    autoDiscardable: true, url: "https://work.example.com/doc", title: "Doc", lastAccessed: NOW },
  { id: 2, windowId: 1, active: false, discarded: false, pinned: false, audible: false,
    autoDiscardable: true, url: "https://old.example.com/a", title: "Old A", lastAccessed: NOW - 5 * HOUR },
  { id: 3, windowId: 1, active: false, discarded: false, pinned: false, audible: false,
    autoDiscardable: true, url: "https://mail.google.com/inbox", title: "Mail", lastAccessed: NOW - 9 * HOUR },
  { id: 4, windowId: 2, active: true, discarded: false, pinned: false, audible: false,
    autoDiscardable: true, url: "https://lone.example.com/", title: "Lone", lastAccessed: NOW - 9 * HOUR },
];

const calls = [];
const stored = {
  settings: { autoSnoozeEnabled: true, inactivityMinutes: 60, checkIntervalMinutes: 7,
    excludePinned: true, excludeAudible: true, minAwakePerWindow: 0 },
  protectionRules: [{ id: "r1", type: "host", pattern: "mail.google.com" }],
};
const chrome = makeChrome({ tabs, calls, stored });
globalThis.chrome = chrome;
await import("../background/service-worker.js");

test("Service Worker - Init: alarm uses configured interval, menus created, protection flags applied", async () => {
  await chrome.runtime.onInstalled.fire();
  assert.ok(calls.includes('alarms.create auto-snooze {"periodInMinutes":7}'));
  assert.ok(calls.includes("contextMenus.removeAll"));
  for (const id of ["root", "show-manager", "snooze-this-tab", "protect-this-site", "snooze-all-inactive"]) {
    assert.ok(calls.includes(`contextMenus.create ${id}`), `menu ${id}`);
  }
  // protected mail tab gets autoDiscardable:false; others already true → untouched
  assert.ok(calls.some((c) => c.startsWith("tabs.update 3") && c.includes('"autoDiscardable":false')));
  assert.ok(!calls.some((c) => c.startsWith("tabs.update 2") && c.includes("autoDiscardable")));
});

test("Service Worker - Alarm pass discards inactive unprotected tabs only", async () => {
  calls.length = 0;
  // the onAlarm listener kicks off autoSnoozePass without awaiting it
  await chrome.alarms.onAlarm.fire({ name: "auto-snooze" });
  await tick();
  await tick();
  const discards = calls.filter((c) => c.startsWith("tabs.discard"));
  // tab 2 old+eligible; tab 3 protected; tab 1 fresh+active; tab 4 active
  assert.deepEqual(discards, ["tabs.discard 2"]);
  assert.equal(tabs.find((t) => t.id === 2).discarded, true);
});

test("Service Worker - Alarm with different name does nothing", async () => {
  calls.length = 0;
  await chrome.alarms.onAlarm.fire({ name: "unrelated" });
  await tick();
  await tick();
  assert.equal(calls.filter((c) => c.startsWith("tabs.discard")).length, 0);
});

const send = (msg) => new Promise((resolve) => chrome.runtime.onMessage.fire(msg, {}, resolve));

test("Service Worker - Snooze-tab on active lone tab creates a focus-taker first", async () => {
  calls.length = 0;
  const response = await send({ type: "snooze-tab", tabId: 4 });
  assert.ok(calls.some((c) => c.startsWith("tabs.create") && c.includes('"windowId":2')), "new tab takes focus");
  assert.ok(calls.includes("tabs.discard 4"));
  assert.deepEqual(response, { ok: true });
  assert.equal(tabs.find((t) => t.id === 4).discarded, true);
});

test("Service Worker - Snooze-tab reports refusal as error response", async () => {
  const original = chrome.tabs.discard;
  chrome.tabs.discard = async (id) => ({ id, discarded: false }); // Chrome refused
  const response = await send({ type: "snooze-tab", tabId: 1 });
  chrome.tabs.discard = original;
  assert.match(response.error, /refused to discard/);
});

test("Service Worker - Toggle-site-protection adds then removes a rule and reapplies flags", async () => {
  calls.length = 0;
  let response = await send({ type: "toggle-site-protection", tabId: 1 });
  assert.deepEqual(response, { protected: true });
  assert.ok(stored.protectionRules.some((r) => r.pattern === "work.example.com"));
  assert.ok(calls.some((c) => c.startsWith("tabs.update 1") && c.includes('"autoDiscardable":false')));

  response = await send({ type: "toggle-site-protection", tabId: 1 });
  assert.deepEqual(response, { protected: false });
  assert.ok(!stored.protectionRules.some((r) => r.pattern === "work.example.com"));
});

test("Service Worker - Protect-hosts skips hosts already covered by a rule", async () => {
  await send({ type: "protect-hosts", hosts: ["mail.google.com", "new.example.net", ""] });
  const patterns = stored.protectionRules.map((r) => r.pattern);
  assert.ok(patterns.includes("new.example.net"));
  assert.equal(patterns.filter((p) => p === "mail.google.com").length, 1, "no duplicate rule");
});

test("Service Worker - Unknown message type returns an error", async () => {
  const response = await send({ type: "nonsense" });
  assert.match(response.error, /unknown message/);
});

test("Service Worker - Show-manager menu click opens the side panel", async () => {
  calls.length = 0;
  await chrome.contextMenus.onClicked.fire({ menuItemId: "show-manager" }, { id: 1, windowId: 1 });
  await tick();
  assert.ok(calls.includes("sidePanel.open"));
});

test("Service Worker - Protect menu title follows active tab's protection state", async () => {
  calls.length = 0;
  await chrome.tabs.onActivated.fire({ tabId: 3 }); // mail.google.com — protected
  await tick();
  assert.ok(calls.includes('contextMenus.update protect-this-site {"title":"Remove site protection"}'));

  calls.length = 0;
  await chrome.tabs.onActivated.fire({ tabId: 2 }); // old.example.com — not protected
  await tick();
  assert.ok(calls.includes('contextMenus.update protect-this-site {"title":"Protect site"}'));
});

test("Service Worker - Protect menu click toggles protection for the tab's site", async () => {
  await chrome.contextMenus.onClicked.fire(
    { menuItemId: "protect-this-site" },
    tabs.find((t) => t.id === 2),
  );
  await tick();
  assert.ok(stored.protectionRules.some((r) => r.pattern === "old.example.com"), "protects");

  await chrome.contextMenus.onClicked.fire(
    { menuItemId: "protect-this-site" },
    tabs.find((t) => t.id === 2),
  );
  await tick();
  assert.ok(!stored.protectionRules.some((r) => r.pattern === "old.example.com"), "unprotects");
});

test("Service Worker - Navigation to a protected url flips autoDiscardable off", async () => {
  calls.length = 0;
  await chrome.tabs.onUpdated.fire(1, { url: "https://mail.google.com/new" });
  assert.ok(calls.some((c) => c.startsWith("tabs.update 1") && c.includes('"autoDiscardable":false')));
});
