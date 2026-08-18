// Service-worker tests: no DOM needed, just the chrome stub with capturing
// events so we can fire onInstalled / onAlarm / onMessage like Chrome would.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { makeChrome, tick } from "./helpers/ui.js";

// flag-dependent tests skip when features.json disables their feature
const FEATURES = JSON.parse(readFileSync(new URL("../features.json", import.meta.url), "utf8"));
const NAV_STACK_ON = FEATURES.NAVIGATION_STACK?.enabled === true;

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

test("Service Worker - Pending update stored for the panel, cleared once new version runs", async () => {
  await chrome.runtime.onUpdateAvailable.fire({ version: "9.9.9" });
  await tick();
  assert.equal(stored.updateAvailable, "9.9.9");

  await chrome.runtime.onInstalled.fire(); // new version booted
  assert.equal(stored.updateAvailable, undefined);
});

test("Service Worker - Navigation to a protected url flips autoDiscardable off", async () => {
  calls.length = 0;
  await chrome.tabs.onUpdated.fire(1, { url: "https://mail.google.com/new" });
  assert.ok(calls.some((c) => c.startsWith("tabs.update 1") && c.includes('"autoDiscardable":false')));
});

test(
  "Service Worker - Tab history: back jumps without pushing, manual pick truncates forward",
  { skip: !NAV_STACK_ON && "NAVIGATION_STACK disabled in features.json" },
  async () => {
  // stack so far from earlier tests: [3, 2] (protect-title test activations)
  await chrome.tabs.onActivated.fire({ tabId: 1 });
  await chrome.tabs.onActivated.fire({ tabId: 4 });
  await tick();

  calls.length = 0;
  await send({ type: "history-back" });
  await tick();
  assert.ok(calls.some((c) => c.startsWith("tabs.update 1") && c.includes('"active":true')), "back activates previous tab");

  await chrome.tabs.onActivated.fire({ tabId: 1 }); // Chrome reporting our own jump
  await chrome.tabs.onActivated.fire({ tabId: 2 }); // user picks a different tab from the past
  await tick();
  const { tabHistory } = await chrome.storage.local.get();
  assert.deepEqual(tabHistory, { stack: [3, 1, 2], cursor: 2 }, "forward entry 4 truncated, 2 moved to top");
  },
);

test(
  "Service Worker - Window focus switch records the newly-current tab in history",
  { skip: !NAV_STACK_ON && "NAVIGATION_STACK disabled in features.json" },
  async () => {
    await chrome.windows.onFocusChanged.fire(chrome.windows.WINDOW_ID_NONE); // devtools etc — ignored
    await chrome.windows.onFocusChanged.fire(2); // window 2's active tab: 1000 (created by snooze test)
    await tick();
    const { tabHistory } = await chrome.storage.local.get();
    assert.equal(tabHistory.stack.at(-1), 1000, "focused window's active tab pushed");
    assert.equal(tabHistory.cursor, tabHistory.stack.length - 1);
  },
);

test(
  "Service Worker - NAVIGATION_STACK off: tab switches write no history at all",
  { skip: NAV_STACK_ON && "NAVIGATION_STACK enabled in features.json" },
  async () => {
    calls.length = 0;
    await chrome.tabs.onActivated.fire({ tabId: 1 });
    await chrome.windows.onFocusChanged.fire(2);
    await tick();
    assert.ok(
      !calls.some((c) => c.startsWith("storage.set") && c.includes("tabHistory")),
      "no tabHistory writes while the feature is off",
    );
  },
);

test(
  "Service Worker - History submenu rebuilt on init: newest first, radio marks current",
  { skip: !NAV_STACK_ON && "NAVIGATION_STACK disabled in features.json" },
  async () => {
    // history at this point: [3, 1, 2] cursor 2, plus 1000 pushed by the focus test
    calls.length = 0;
    await chrome.runtime.onInstalled.fire();
    await tick();
    assert.ok(calls.includes("contextMenus.remove history"));
    assert.ok(calls.includes("contextMenus.create history"));
    for (const index of [0, 1, 2, 3]) {
      assert.ok(calls.includes(`contextMenus.create hist-${index}`), `hist-${index}`);
    }
  },
);

test(
  "Service Worker - NAVIGATION_STACK off: history menu removed and never created",
  { skip: NAV_STACK_ON && "NAVIGATION_STACK enabled in features.json" },
  async () => {
    calls.length = 0;
    await chrome.runtime.onInstalled.fire();
    await tick();
    assert.ok(calls.includes("contextMenus.remove history"));
    assert.ok(!calls.some((c) => c.startsWith("contextMenus.create history")), "no History menu");
    assert.ok(!calls.some((c) => c.startsWith("contextMenus.create hist-")), "no entries");
  },
);

test(
  "Service Worker - History submenu click jumps to that entry",
  { skip: !NAV_STACK_ON && "NAVIGATION_STACK disabled in features.json" },
  async () => {
    calls.length = 0;
    await chrome.contextMenus.onClicked.fire({ menuItemId: "hist-0" }, { id: 1, windowId: 1 });
    await tick();
    assert.ok(calls.some((c) => c.startsWith("tabs.update 3") && c.includes('"active":true')), "stack[0]=3 activated");
  },
);

