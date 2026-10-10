// Service-worker tests: no DOM needed, just the chrome stub with capturing
// events so we can fire onInstalled / onAlarm / onMessage like Chrome would.
import assert from "node:assert/strict";
import { test } from "vitest";
import type { Message, MessageError, MessageResponses } from "../../src/app/messages.ts";
import type { KeepAliveTab, ProtectionRule, Removal, Settings } from "../../src/app/types.ts";
import type { ChromeMockOptions } from "../helpers/chrome-mock.ts";
import { makeChrome, tick, TEST_EXPERIMENTAL, TEST_FEATURES } from "../helpers/ui.ts";

// flag-dependent tests skip when the EFFECTIVE flags (experimental resolved
// under TEST_EXPERIMENTAL=1) disable their feature
const NAV_STACK_ON = TEST_FEATURES.NAVIGATION_STACK?.enabled === true;
// Resolved fresh-install mode ("off" | "traditional" | "compact") — several
// tests replay traces that depend on which push semantics the default mode
// uses, so they skip unless the flags produce the mode they were written for.
const { resolveNavMode } = await import("../../src/app/core.ts");
const DEFAULT_MODE = resolveNavMode(TEST_FEATURES, {});
const NAV_ON = DEFAULT_MODE !== "off";
const TRADITIONAL_DEFAULT = DEFAULT_MODE === "traditional";
const COMPACT_AVAILABLE = NAV_STACK_ON && TEST_FEATURES.NAVIGATION_COMPACT_STACK?.enabled === true;
const KEEP_ALIVE_ON = TEST_FEATURES.KEEP_ALIVE?.enabled === true;

const NOW = Date.now();
const HOUR = 3_600_000;
const tabs: NonNullable<ChromeMockOptions["tabs"]> = [
  {
    id: 1,
    windowId: 1,
    active: true,
    discarded: false,
    pinned: false,
    audible: false,
    autoDiscardable: true,
    url: "https://work.example.com/doc",
    title: "Doc",
    lastAccessed: NOW,
  },
  {
    id: 2,
    windowId: 1,
    active: false,
    discarded: false,
    pinned: false,
    audible: false,
    autoDiscardable: true,
    url: "https://old.example.com/a",
    title: "Old A",
    lastAccessed: NOW - 5 * HOUR,
  },
  {
    id: 3,
    windowId: 1,
    active: false,
    discarded: false,
    pinned: false,
    audible: false,
    autoDiscardable: true,
    url: "https://mail.google.com/inbox",
    title: "Mail",
    lastAccessed: NOW - 9 * HOUR,
  },
  {
    id: 4,
    windowId: 2,
    active: true,
    discarded: false,
    pinned: false,
    audible: false,
    autoDiscardable: true,
    url: "https://lone.example.com/",
    title: "Lone",
    lastAccessed: NOW - 9 * HOUR,
  },
];

const calls: string[] = [];
const stored: {
  settings: Settings;
  protectionRules: Omit<ProtectionRule, "createdAt">[];
  keepAlive?: KeepAliveTab[];
  keepAliveTrash?: Removal<KeepAliveTab>[];
  protectionTrash?: Removal<ProtectionRule>[];
  updateAvailable?: string;
} = {
  settings: {
    autoSnoozeEnabled: true,
    inactivityMinutes: 60,
    checkIntervalMinutes: 7,
    excludePinned: true,
    excludeAudible: true,
    minAwakePerWindow: 0,
    keepAliveEnabled: true,
    keepAliveMinutes: 25,
  },
  protectionRules: [{ id: "r1", type: "host", pattern: "mail.google.com" }],
};
const chrome = makeChrome({ tabs, calls, stored });
Object.assign(globalThis, { chrome });
await import("../../src/background/service-worker.ts");

test("Service Worker - Init: alarm uses configured interval, menus created, protection flags applied", async () => {
  await chrome.runtime.onInstalled.fire();
  assert.ok(calls.includes('alarms.create auto-snooze {"periodInMinutes":7}'));
  assert.ok(calls.includes("contextMenus.removeAll"));
  for (const id of ["root", "show-manager", "snooze-this-tab", "protect-this-site", "snooze-all-inactive"]) {
    assert.ok(calls.includes(`contextMenus.create ${id}`), `menu ${id}`);
  }
  // keep-alive item only with the flag on (settings enable it in the fixture); no marks yet → no sweep alarm
  assert.equal(calls.includes("contextMenus.create keep-alive-tab"), KEEP_ALIVE_ON, "keep-alive menu item");
  assert.ok(!calls.some((c) => c.startsWith("alarms.create keep-alive")), "empty list arms nothing");
  // protected mail tab gets autoDiscardable:false; others already true → untouched
  assert.ok(calls.some((c) => c.startsWith("tabs.update 3") && c.includes('"autoDiscardable":false')));
  assert.ok(!calls.some((c) => c.startsWith("tabs.update 2") && c.includes("autoDiscardable")));
});

test("Service Worker - Concurrent onInstalled + onStartup coalesce into one init pass", async () => {
  calls.length = 0;
  // browser launch with a pending update fires both back-to-back
  await Promise.all([chrome.runtime.onInstalled.fire(), chrome.runtime.onStartup.fire()]);
  await tick();
  await tick();
  assert.equal(calls.filter((c) => c === "contextMenus.removeAll").length, 1, "one menu wipe");
  assert.equal(calls.filter((c) => c === "contextMenus.create root").length, 1, "root created once");
  assert.equal(calls.filter((c) => c.startsWith("alarms.create")).length, 1, "alarm ensured once");
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
  assert.equal(tabs.find((t) => t.id === 2)?.discarded, true);
});

test("Service Worker - Manual wake (tabs-woken) protects a tab from the next pass", async () => {
  // tab 2 was discarded by the previous pass — wake it and mark the wake
  const tab = tabs.find((t) => t.id === 2);
  assert.ok(tab);
  tab.discarded = false; // reloaded by the panel
  await send({ type: "tabs-woken", tabIds: [2] });
  calls.length = 0;
  await chrome.alarms.onAlarm.fire({ name: "auto-snooze" });
  await tick();
  await tick();
  assert.equal(
    calls.filter((c) => c.startsWith("tabs.discard")).length,
    0,
    "stale lastAccessed no longer re-snoozes the woken tab",
  );
  await chrome.storage.session.set({ wakeTimes: {} }); // reset for later tests
  tab.discarded = true; // restore the state the earlier pass left
});

test("Service Worker - Alarm with different name does nothing", async () => {
  calls.length = 0;
  await chrome.alarms.onAlarm.fire({ name: "unrelated" });
  await tick();
  await tick();
  assert.equal(calls.filter((c) => c.startsWith("tabs.discard")).length, 0);
});

// what the worker answers: the handler's response, or { error } when it threw / the type is unknown
type Sent = Message | { type: "nonsense" };
type Reply<T extends Sent> = (T extends Message ? MessageResponses[T["type"]] : never) | MessageError;
const send = <T extends Sent>(msg: T) =>
  new Promise<Reply<T>>((resolve) => chrome.runtime.onMessage.fire(msg, {}, resolve));

test("Service Worker - Snooze-tab on active lone tab creates a focus-taker first", async () => {
  calls.length = 0;
  const response = await send({ type: "snooze-tab", tabId: 4 });
  assert.ok(
    calls.some((c) => c.startsWith("tabs.create") && c.includes('"windowId":2')),
    "new tab takes focus",
  );
  assert.ok(calls.includes("tabs.discard 4"));
  assert.deepEqual(response, { ok: true });
  assert.equal(tabs.find((t) => t.id === 4)?.discarded, true);
});

test("Service Worker - Snooze-tab reports refusal as error response", async () => {
  const original = chrome.tabs.discard;
  chrome.tabs.discard = async (id) => ({ id, discarded: false }); // Chrome refused
  const response = await send({ type: "snooze-tab", tabId: 1 });
  chrome.tabs.discard = original;
  assert.ok("error" in response);
  assert.match(response.error, /refused to discard/);
});

test("Service Worker - Toggle-site-protection adds then removes a rule and reapplies flags", async () => {
  calls.length = 0;
  let response = await send({ type: "toggle-site-protection", tabId: 1 });
  assert.deepEqual(response, { protected: true });
  assert.ok(stored.protectionRules.some((r) => r.pattern === "work.example.com"));
  assert.ok(calls.some((c) => c.startsWith("tabs.update 1") && c.includes('"autoDiscardable":false')));

  stored.protectionTrash = [];
  response = await send({ type: "toggle-site-protection", tabId: 1 });
  assert.deepEqual(response, { protected: false });
  assert.ok(!stored.protectionRules.some((r) => r.pattern === "work.example.com"));
  assert.deepEqual(
    stored.protectionTrash.map((action) => action.items.map((rule) => rule.pattern)),
    [["work.example.com"]],
    "menu unprotect kept for Settings → Restore",
  );
});

test("Service Worker - Protect-hosts skips hosts already covered by a rule", async () => {
  await send({ type: "protect-hosts", hosts: ["mail.google.com", "new.example.net", ""] });
  const patterns = stored.protectionRules.map((r) => r.pattern);
  assert.ok(patterns.includes("new.example.net"));
  assert.equal(patterns.filter((p) => p === "mail.google.com").length, 1, "no duplicate rule");
});

test("Service Worker - Protect-urls adds exact rules, unprotect-urls removes them and covering host rules", async () => {
  await send({ type: "protect-urls", urls: ["https://mail.google.com/inbox", "https://app.example.net/board", ""] });
  let patterns = stored.protectionRules.map((r) => r.pattern);
  assert.ok(patterns.includes("https://app.example.net/board"), "url rule added");
  assert.ok(patterns.includes("https://mail.google.com/inbox"), "url rule added even though the host is protected");
  stored.protectionTrash = [];
  await send({ type: "unprotect-urls", urls: ["https://app.example.net/board", "https://mail.google.com/x"] });
  patterns = stored.protectionRules.map((r) => r.pattern);
  assert.ok(!patterns.includes("https://app.example.net/board"), "url rule removed");
  assert.ok(!patterns.includes("mail.google.com"), "host rule covering the url removed");
  assert.deepEqual(
    stored.protectionTrash
      .at(-1)
      ?.items.map((rule) => rule.pattern)
      .sort(),
    ["https://app.example.net/board", "mail.google.com"],
    "both dropped rules in one restorable action",
  );
  stored.protectionRules.push({ id: "r1", type: "host", pattern: "mail.google.com" }); // restore fixture
});

test("Service Worker - Unknown message type returns an error", async () => {
  const response = await send({ type: "nonsense" });
  assert.match(response.error, /unknown message/);
});

test("Service Worker - Show-manager menu click opens the side panel", async () => {
  calls.length = 0;
  await chrome.contextMenus.onClicked.fire({ menuItemId: "show-manager" }, { id: 1, windowId: 1 });
  await tick();
  assert.ok(calls.some((c) => c.startsWith("sidePanel.open")));
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
  assert.ok(
    stored.protectionRules.some((r) => r.pattern === "old.example.com"),
    "protects",
  );

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

test("Service Worker - Tab history: back jumps without pushing, manual pick truncates forward", {
  skip: !TRADITIONAL_DEFAULT, // trace assumes traditional as the default mode
}, async () => {
  // stack so far from earlier tests: [3, 2] (protect-title test activations)
  await chrome.tabs.onActivated.fire({ tabId: 1 });
  await chrome.tabs.onActivated.fire({ tabId: 4 });
  await tick();

  calls.length = 0;
  await send({ type: "history-back" });
  await tick();
  assert.ok(
    calls.some((c) => c.startsWith("tabs.update 1") && c.includes('"active":true')),
    "back activates previous tab",
  );

  await chrome.tabs.onActivated.fire({ tabId: 1 }); // Chrome reporting our own jump
  await chrome.tabs.onActivated.fire({ tabId: 2 }); // user picks a tab that's in the trail
  await tick();
  const { tabHistory } = await chrome.storage.local.get();
  assert.deepEqual(
    tabHistory,
    { stack: [3, 2, 1, 2], cursor: 3 },
    "traditional (default): forward truncated, duplicate appended",
  );
});

test("Service Worker - Keyboard commands history-back / history-forward step along the trail", {
  skip: !TRADITIONAL_DEFAULT, // continues the trail of the previous test: [3, 2, 1, 2], cursor 3
}, async () => {
  calls.length = 0;
  await chrome.commands.onCommand.fire("history-back");
  await tick();
  assert.ok(
    calls.some((c) => c.startsWith("tabs.update 1") && c.includes('"active":true')),
    "back from a page shortcut activates the previous tab",
  );
  await chrome.tabs.onActivated.fire({ tabId: 1 }); // Chrome reporting our own jump

  calls.length = 0;
  await chrome.commands.onCommand.fire("history-forward");
  await tick();
  assert.ok(
    calls.some((c) => c.startsWith("tabs.update 2") && c.includes('"active":true')),
    "forward returns to the tab the back step left",
  );
  await chrome.tabs.onActivated.fire({ tabId: 2 });
  await tick();
  const { tabHistory } = await chrome.storage.local.get();
  assert.deepEqual(tabHistory, { stack: [3, 2, 1, 2], cursor: 3 }, "jumps move the cursor, never push");
});

test("Service Worker - Window focus switch records the newly-current tab in history", {
  skip: !NAV_ON, // navigation resolves to off in features.json
}, async () => {
  await chrome.windows.onFocusChanged.fire(chrome.windows.WINDOW_ID_NONE); // devtools etc — ignored
  await chrome.windows.onFocusChanged.fire(2); // window 2's active tab: 1000 (created by snooze test)
  await tick();
  const { tabHistory } = await chrome.storage.local.get();
  assert.equal(tabHistory.stack.at(-1), 1000, "focused window's active tab pushed");
  assert.equal(tabHistory.cursor, tabHistory.stack.length - 1);
});

test("Service Worker - NAVIGATION_STACK off: tab switches write no history at all", {
  skip: NAV_ON, // navigation enabled in features.json
}, async () => {
  calls.length = 0;
  await chrome.tabs.onActivated.fire({ tabId: 1 });
  await chrome.windows.onFocusChanged.fire(2);
  await tick();
  assert.ok(
    !calls.some((c) => c.startsWith("storage.set") && c.includes("tabHistory")),
    "no tabHistory writes while the feature is off",
  );
});

test("Service Worker - History submenu rebuilt on init: newest first, radio marks current", {
  skip: !TRADITIONAL_DEFAULT, // trace assumes traditional as the default mode
}, async () => {
  // history at this point (traditional): [3, 2, 1, 2, 1000] — duplicates
  // stay, focus test appended 1000 at the cursor's end
  calls.length = 0;
  await chrome.runtime.onInstalled.fire();
  await tick();
  assert.ok(calls.includes("contextMenus.remove history"));
  assert.ok(calls.includes("contextMenus.create history"));
  for (const index of [0, 1, 2, 3, 4]) {
    assert.ok(calls.includes(`contextMenus.create hist-${index}`), `hist-${index}`);
  }
  assert.ok(!calls.includes("contextMenus.create hist-5"), "exactly 5 entries");
});

test("Service Worker - Overlapping history-menu rebuilds are serialized (no duplicate-id creates)", {
  skip: !NAV_ON, // navigation disabled in features.json
}, async () => {
  calls.length = 0;
  // two storage echoes back-to-back — rapid tab switching does exactly this
  await Promise.all([
    chrome.storage.onChanged.fire({ tabHistory: {} }, "local"),
    chrome.storage.onChanged.fire({ tabHistory: {} }, "local"),
    chrome.storage.onChanged.fire({ ui: {} }, "local"),
  ]);
  await tick();
  await tick();
  const menuOps = calls.filter((c) => /^contextMenus\.(create|remove) history$/.test(c));
  assert.ok(menuOps.includes("contextMenus.create history"), "menu rebuilt");
  for (let i = 1; i < menuOps.length; i++) {
    assert.ok(
      !(menuOps[i] === "contextMenus.create history" && menuOps[i - 1] === "contextMenus.create history"),
      `create without a remove in between at op ${i}: ${menuOps.join(" → ")}`,
    );
  }
  assert.ok(menuOps.length <= 4, `coalesced into at most two passes, got: ${menuOps.join(" → ")}`);
});

test("Service Worker - NAVIGATION_STACK off: history menu removed and never created", {
  skip: NAV_ON, // navigation enabled in features.json
}, async () => {
  calls.length = 0;
  await chrome.runtime.onInstalled.fire();
  await tick();
  assert.ok(calls.includes("contextMenus.remove history"));
  assert.ok(!calls.some((c) => c.startsWith("contextMenus.create history")), "no History menu");
  assert.ok(!calls.some((c) => c.startsWith("contextMenus.create hist-")), "no entries");
});

test("Service Worker - History submenu click jumps to that entry", {
  skip: !TRADITIONAL_DEFAULT, // trace assumes traditional as the default mode
}, async () => {
  calls.length = 0;
  await chrome.contextMenus.onClicked.fire({ menuItemId: "hist-0" }, { id: 1, windowId: 1 });
  await tick();
  assert.ok(
    calls.some((c) => c.startsWith("tabs.update 3") && c.includes('"active":true')),
    "stack[0]=3 activated",
  );
});

test("Service Worker - Closing the active tab: concurrent activation + removal stay consistent", {
  skip: !NAV_ON, // navigation resolves to off in features.json
}, async () => {
  // tab 4 (current) closes; Chrome auto-activates neighbor 1000 — both events
  // land at once and must serialize instead of last-writer-wins
  await chrome.storage.local.set({ tabHistory: { stack: [3, 2, 1000, 4], cursor: 3 } });
  await Promise.all([chrome.tabs.onActivated.fire({ tabId: 1000 }), chrome.tabs.onRemoved.fire(4)]);
  await tick();
  await tick();
  const { tabHistory } = await chrome.storage.local.get();
  assert.ok(!tabHistory.stack.includes(4), "closed id not resurrected by the activation write");
  assert.equal(tabHistory.stack[tabHistory.cursor], 1000, "cursor on the auto-activated tab");
});

test("Service Worker - Switching to compact dedupes the stack; compact re-pick moves the cursor", {
  skip: !COMPACT_AVAILABLE, // compact mode disabled in features.json
}, async () => {
  await chrome.storage.local.set({ tabHistory: { stack: [1, 2, 1, 3], cursor: 3 } });
  await chrome.storage.local.set({ ui: { historyNav: "compact" } });
  await chrome.storage.onChanged.fire({ ui: { newValue: { historyNav: "compact" } } }, "local");
  await tick();
  let { tabHistory } = await chrome.storage.local.get();
  assert.deepEqual(tabHistory, { stack: [2, 1, 3], cursor: 2 }, "deduped, newest occurrence kept");

  await chrome.tabs.onActivated.fire({ tabId: 2 }); // in trail → cursor moves, nothing appended
  await tick();
  ({ tabHistory } = await chrome.storage.local.get());
  assert.deepEqual(tabHistory, { stack: [2, 1, 3], cursor: 0 }, "compact: cursor-move, no dupe");

  // back to default (traditional) for the remaining tests
  // back to the fixture's ui — including the experimental opt-in makeChrome injected
  await chrome.storage.local.set({ ui: TEST_EXPERIMENTAL ? { showExperimental: true } : {} });
  await chrome.storage.onChanged.fire({ ui: { newValue: {} } }, "local");
  await tick();
});

// Discarding (snooze) swaps a tab's id via onReplaced with NO onRemoved — the
// trail must follow the new id or the entry reads "(closed tab)" while open.
test("Service Worker - Tab id replacement (snooze/prerender) is followed in the history stack", async () => {
  await chrome.storage.local.set({ tabHistory: { stack: [3, 2, 1], cursor: 2 } });
  await chrome.tabs.onReplaced.fire(2222, 2);
  await tick();
  const { tabHistory } = await chrome.storage.local.get();
  assert.deepEqual(tabHistory, { stack: [3, 2222, 1], cursor: 2 }, "id swapped in place");

  calls.length = 0;
  await chrome.tabs.onReplaced.fire(4444, 999); // old id not in the stack
  await tick();
  assert.ok(!calls.some((c) => c.startsWith("storage.set")), "no write when id absent");
});

// not flag-dependent: pruning must work even with NAVIGATION_STACK off, so a
// stack recorded while the feature was on can't keep dead tab ids.
// Runs last — it overwrites tabHistory the flag-on submenu tests rely on.
test("Service Worker - Closing a tab sweeps every closed id from the history stack", async () => {
  // 777 = residue from a lost-update race (activation write landed after a prune)
  await chrome.storage.local.set({ tabHistory: { stack: [1, 777, 2, 3], cursor: 3 } });
  await chrome.tabs.onRemoved.fire(2);
  await tick();
  const { tabHistory } = await chrome.storage.local.get();
  assert.deepEqual(tabHistory, { stack: [1, 3], cursor: 1 }, "closed id AND stale ids swept");

  calls.length = 0;
  await chrome.tabs.onRemoved.fire(888); // nothing in the stack is closed
  await tick();
  assert.ok(!calls.some((c) => c.startsWith("storage.set")), "no write when nothing to prune");
});

test("Service Worker - history-remove message drops one entry by index", async () => {
  await chrome.storage.local.set({ tabHistory: { stack: [3, 2, 3], cursor: 2 } });
  await send({ type: "history-remove", index: 0 });
  await tick();
  const { tabHistory } = await chrome.storage.local.get();
  assert.deepEqual(tabHistory, { stack: [2, 3], cursor: 1 }, "indexed entry gone, duplicate kept");
});

test("Service Worker - Window identity: profiles follow tab changes under stable logical ids", async () => {
  await new Promise((resolve) => setTimeout(resolve, 600)); // initial debounce flush
  let { windowProfiles } = await chrome.storage.local.get("windowProfiles");
  assert.ok(windowProfiles && Object.keys(windowProfiles).length >= 2, "one profile per window");
  const before = structuredClone(windowProfiles);
  const logical1 = Object.entries(before).find(([, p]) => p.chromeWindowId === 1)?.[0];
  assert.ok(logical1?.startsWith("w-"), "logical id minted");
  assert.ok(logical1);

  // rearrangement refreshes the profile (fingerprint set itself is order-blind)
  await chrome.tabs.onMoved.fire(1, { windowId: 1, fromIndex: 0, toIndex: 2 });
  await new Promise((resolve) => setTimeout(resolve, 600));
  ({ windowProfiles } = await chrome.storage.local.get("windowProfiles"));
  assert.deepEqual(Object.keys(windowProfiles).sort(), Object.keys(before).sort(), "ids stable across refreshes");
  // NaN keeps a missing profile / timestamp failing, as the untyped `undefined >= undefined` did
  assert.ok(
    (windowProfiles[logical1]?.updatedAt ?? Number.NaN) >= (before[logical1]?.updatedAt ?? Number.NaN),
    "refreshed on move",
  );

  // closing a tab shrinks the same logical window's fingerprint
  const removedIndex = tabs.findIndex((t) => t.windowId === 1);
  const removed = tabs.splice(removedIndex, 1)[0];
  assert.ok(removed);
  await chrome.tabs.onRemoved.fire(removed.id, { windowId: 1, isWindowClosing: false });
  await new Promise((resolve) => setTimeout(resolve, 600));
  ({ windowProfiles } = await chrome.storage.local.get("windowProfiles"));
  assert.equal(
    windowProfiles[logical1]?.tabCount,
    (before[logical1]?.tabCount ?? Number.NaN) - 1, // `undefined - 1` was NaN too
    "close captured",
  );
  assert.equal(windowProfiles[logical1]?.chromeWindowId, 1, "still bound to the live chrome id");

  tabs.splice(removedIndex, 0, removed); // restore fixture
  await chrome.tabs.onCreated.fire(removed);
  await new Promise((resolve) => setTimeout(resolve, 600));
});

test("Service Worker - Panel tracking: connect marks panelOpen, disconnect clears, restore list built", async () => {
  const disconnectFns: (() => void)[] = [];
  const port = { name: "sidepanel:1", onDisconnect: { addListener: (fn: () => void) => disconnectFns.push(fn) } };
  await chrome.runtime.onConnect.fire(port);
  await tick();
  await tick();
  let { windowProfiles } = await chrome.storage.local.get("windowProfiles");
  const logical1 = Object.entries(windowProfiles).find(([, p]) => p.chromeWindowId === 1)?.[0];
  assert.ok(logical1);
  assert.equal(windowProfiles[logical1]?.panelOpen, true, "connect marks the window's panel open");

  // live port: the same window is never offered back for restore
  let response = await send({ type: "panels-to-restore", excludeWindowId: 2 });
  assert.ok("windows" in response);
  assert.deepEqual(response.windows, [], "connected window not offered");

  // deliberate close clears the flag
  for (const fn of disconnectFns) {
    fn();
  }
  await tick();
  await tick();
  ({ windowProfiles } = await chrome.storage.local.get("windowProfiles"));
  assert.equal(windowProfiles[logical1]?.panelOpen, false, "disconnect clears panelOpen");

  // extension teardown persists the flag but leaves no live port → offered
  windowProfiles[logical1] = { ...windowProfiles[logical1], panelOpen: true };
  await chrome.storage.local.set({ windowProfiles });
  response = await send({ type: "panels-to-restore", excludeWindowId: 2 });
  assert.ok("windows" in response);
  assert.deepEqual(response.windows, [1], "stale panelOpen without a port is restorable");
  response = await send({ type: "panels-to-restore", excludeWindowId: 1 });
  assert.ok("windows" in response);
  assert.deepEqual(response.windows, [], "the asking panel's own window is excluded");

  // dismissing the banner forgets ALL offered windows in one write — per-window
  // concurrent writes used to clobber each other and leave some flags set
  const logical2 = Object.entries(windowProfiles).find(([, p]) => p.chromeWindowId === 2)?.[0];
  assert.ok(logical2);
  windowProfiles[logical2] = { ...windowProfiles[logical2], panelOpen: true };
  await chrome.storage.local.set({ windowProfiles });
  await send({ type: "panels-restore-dismiss", windowIds: [1, 2] });
  ({ windowProfiles } = await chrome.storage.local.get("windowProfiles"));
  assert.equal(windowProfiles[logical1]?.panelOpen, false, "dismiss clears panelOpen (1)");
  assert.equal(windowProfiles[logical2]?.panelOpen, false, "dismiss clears panelOpen (2)");
  response = await send({ type: "panels-to-restore", excludeWindowId: 3 });
  assert.ok("windows" in response);
  assert.deepEqual(response.windows, [], "dismissed windows no longer offered");
});

test("Service Worker - Profile patches are serialized: concurrent writes never clobber", async () => {
  let { windowProfiles } = await chrome.storage.local.get("windowProfiles");
  const logicalOf = (chromeId: number) =>
    Object.entries(windowProfiles).find(([, p]) => p.chromeWindowId === chromeId)?.[0];
  const logical1 = logicalOf(1);
  const logical2 = logicalOf(2);
  assert.ok(logical1 && logical2);
  windowProfiles[logical1] = { ...windowProfiles[logical1], panelOpen: true };
  windowProfiles[logical2] = { ...windowProfiles[logical2], panelOpen: true };
  await chrome.storage.local.set({ windowProfiles });

  // restore click forgets [1,2] while window 2's freshly opened panel connects
  const port = { name: "sidepanel:2", onDisconnect: { addListener: () => {} } };
  await Promise.all([send({ type: "panels-restore-dismiss", windowIds: [1, 2] }), chrome.runtime.onConnect.fire(port)]);
  await tick();
  await tick();
  ({ windowProfiles } = await chrome.storage.local.get("windowProfiles"));
  assert.equal(windowProfiles[logical1]?.panelOpen, false, "forgotten window stays forgotten");
  assert.equal(windowProfiles[logical2]?.panelOpen, true, "connected window ends up open");
  const response = await send({ type: "panels-to-restore", excludeWindowId: 3 });
  assert.ok("windows" in response);
  assert.deepEqual(response.windows, [], "nothing left to offer");
});

test("Service Worker - Window rename/color write to the logical profile; empty clears", async () => {
  let { windowProfiles } = await chrome.storage.local.get("windowProfiles");
  const logical1 = Object.entries(windowProfiles).find(([, p]) => p.chromeWindowId === 1)?.[0];
  assert.ok(logical1);

  await send({ type: "window-rename", windowId: 1, name: "  Research  " });
  ({ windowProfiles } = await chrome.storage.local.get("windowProfiles"));
  assert.equal(windowProfiles[logical1]?.name, "Research", "trimmed name stored");

  await send({ type: "window-set-color", windowId: 1, color: "#123456" });
  ({ windowProfiles } = await chrome.storage.local.get("windowProfiles"));
  assert.equal(windowProfiles[logical1]?.color, "#123456", "color stored");

  await send({ type: "window-pin", windowId: 1, pinned: true });
  ({ windowProfiles } = await chrome.storage.local.get("windowProfiles"));
  assert.equal(windowProfiles[logical1]?.pinnedWindow, true, "pin stored");

  await send({ type: "window-rename", windowId: 1, name: "" });
  await send({ type: "window-set-color", windowId: 1, color: null });
  await send({ type: "window-pin", windowId: 1, pinned: false });
  ({ windowProfiles } = await chrome.storage.local.get("windowProfiles"));
  assert.ok(windowProfiles[logical1]); // a vanished profile must not read as "cleared"
  assert.equal(windowProfiles[logical1].name, undefined, "empty rename clears");
  assert.equal(windowProfiles[logical1].color, undefined, "null color clears");
  assert.equal(windowProfiles[logical1].pinnedWindow, undefined, "unpin clears");
});

test("Service Worker - TTL sweep keeps customized profiles, drops stale plain ones", async () => {
  const { windowProfiles } = await chrome.storage.local.get("windowProfiles");
  const stale = Date.now() - 15 * 24 * 3_600_000; // past the 14d TTL
  windowProfiles["w-stale-named"] = { chromeWindowId: 999, name: "Keep me", updatedAt: stale };
  windowProfiles["w-stale-colored"] = { chromeWindowId: 998, color: "#123456", updatedAt: stale };
  windowProfiles["w-stale-pinned"] = { chromeWindowId: 996, pinnedWindow: true, updatedAt: stale };
  windowProfiles["w-stale-plain"] = { chromeWindowId: 997, updatedAt: stale };
  await chrome.storage.local.set({ windowProfiles });

  await chrome.tabs.onMoved.fire(1, { windowId: 1, fromIndex: 0, toIndex: 1 });
  await new Promise((resolve) => setTimeout(resolve, 600)); // profile-refresh debounce

  const { windowProfiles: after } = await chrome.storage.local.get("windowProfiles");
  assert.ok(after["w-stale-named"], "named profile survives the sweep");
  assert.ok(after["w-stale-colored"], "colored profile survives the sweep");
  assert.ok(after["w-stale-pinned"], "pinned profile survives the sweep");
  assert.equal(after["w-stale-plain"], undefined, "plain stale profile swept");

  delete after["w-stale-named"];
  delete after["w-stale-colored"];
  delete after["w-stale-pinned"];
  await chrome.storage.local.set({ windowProfiles: after }); // restore fixture
});

// ---------- keep-it-alive (T-0002) ----------

const MINUTE = 60_000;

test("Service Worker - Keep alive: sweep reloads due, unpaused pages only and re-arms them around their own interval", {
  skip: !KEEP_ALIVE_ON,
}, async () => {
  const before = Date.now();
  stored.keepAlive = [
    { url: "https://old.example.com/a", title: "stale name", minutes: 25, nextReload: before - 1 },
    { url: "https://work.example.com/doc", title: "Doc", minutes: 5, nextReload: before + HOUR },
    { url: "https://work.example.com/doc#paused", title: "Paused", minutes: 1, paused: true, nextReload: 0 },
  ];
  calls.length = 0;
  await chrome.alarms.onAlarm.fire({ name: "keep-alive" });
  await tick();
  await tick();
  await tick();
  assert.deepEqual(
    calls.filter((c) => c.startsWith("tabs.reload")),
    ["tabs.reload 2"],
  );
  const due = stored.keepAlive.find((entry) => entry.url === "https://old.example.com/a");
  assert.ok(due, "entry kept");
  assert.equal(due.title, "Old A", "title refreshed from the reloaded tab");
  assert.ok(due.nextReload >= before + 25 * MINUTE - 55_000, "re-armed no earlier than 25 min - 55 s");
  assert.ok(due.nextReload <= Date.now() + 25 * MINUTE + 55_000, "re-armed no later than 25 min + 55 s");
  assert.equal(stored.keepAlive[1]?.nextReload, before + HOUR, "not-due entry untouched");
  assert.equal(stored.keepAlive[2]?.nextReload, 0, "paused entry neither reloaded nor re-armed");
});

test("Service Worker - Keep alive: a mark typed with a fragment reloads that exact address only", {
  skip: !KEEP_ALIVE_ON,
}, async () => {
  const tab = tabs.find((t) => t.id === 2);
  assert.ok(tab);
  const original = tab.url;
  tab.url = "https://old.example.com/a#/dash";
  stored.keepAlive = [
    { url: "https://old.example.com/a#/dash", title: "Dash", minutes: 25, nextReload: 0 },
    { url: "https://old.example.com/a#/mail", title: "Mail", minutes: 25, nextReload: 0 },
  ];
  calls.length = 0;
  await chrome.alarms.onAlarm.fire({ name: "keep-alive" });
  await tick();
  await tick();
  await tick();
  assert.deepEqual(
    calls.filter((c) => c.startsWith("tabs.reload")),
    ["tabs.reload 2"],
    "the #/dash mark hits the tab, the #/mail one does not",
  );
  tab.url = original;
});

test("Service Worker - Keep alive: sweep does nothing while the setting is off", { skip: !KEEP_ALIVE_ON }, async () => {
  stored.keepAlive = [{ url: "https://old.example.com/a", title: "Old A", minutes: 25, nextReload: 0 }];
  stored.settings.keepAliveEnabled = false;
  calls.length = 0;
  await chrome.alarms.onAlarm.fire({ name: "keep-alive" });
  await tick();
  await tick();
  assert.equal(calls.filter((c) => c.startsWith("tabs.reload")).length, 0);
  stored.settings.keepAliveEnabled = true;
});

test("Service Worker - Keep alive: auto-snooze pass skips kept pages", { skip: !KEEP_ALIVE_ON }, async () => {
  stored.keepAlive = [{ url: "https://old.example.com/a", title: "Old A", minutes: 25, nextReload: Date.now() + HOUR }];
  const tab = tabs.find((t) => t.id === 2);
  assert.ok(tab);
  tab.discarded = false;
  tab.active = false;
  await chrome.storage.session.set({ wakeTimes: {} });
  calls.length = 0;
  await chrome.alarms.onAlarm.fire({ name: "auto-snooze" });
  await tick();
  await tick();
  assert.ok(!calls.includes("tabs.discard 2"), "old but kept alive: not snoozed");
  stored.keepAlive = [];
  calls.length = 0;
  await chrome.alarms.onAlarm.fire({ name: "auto-snooze" });
  await tick();
  await tick();
  assert.ok(calls.includes("tabs.discard 2"), "mark removed: snoozed as before");
});

test("Service Worker - Keep alive: menu click marks the page and arms the sweep; second click unmarks and clears it", {
  skip: !KEEP_ALIVE_ON,
}, async () => {
  stored.keepAlive = [];
  calls.length = 0;
  await chrome.contextMenus.onClicked.fire(
    { menuItemId: "keep-alive-tab" },
    tabs.find((t) => t.id === 2),
  );
  await tick();
  await tick();
  assert.deepEqual(
    stored.keepAlive.map((entry) => entry.url),
    ["https://old.example.com/a"],
  );
  assert.ok(calls.includes('alarms.create keep-alive {"periodInMinutes":0.5}'), "sweep armed");

  calls.length = 0;
  await chrome.contextMenus.onClicked.fire(
    { menuItemId: "keep-alive-tab" },
    tabs.find((t) => t.id === 2),
  );
  await tick();
  await tick();
  assert.deepEqual(stored.keepAlive, []);
  assert.ok(calls.includes("alarms.clear keep-alive"), "empty list: sweep cleared");
  assert.deepEqual(
    stored.keepAliveTrash?.at(-1)?.items.map((entry) => entry.url),
    ["https://old.example.com/a"],
    "menu unmark recorded for Restore too",
  );
});

test("Service Worker - Keep alive: keep-alive-set message marks and unmarks tabs by id", {
  skip: !KEEP_ALIVE_ON,
}, async () => {
  stored.keepAlive = [];
  let response = await send({ type: "keep-alive-set", tabIds: [1, 2, 999], kept: true });
  assert.deepEqual(response, { ok: true });
  assert.deepEqual(
    stored.keepAlive.map((entry) => entry.url),
    ["https://work.example.com/doc", "https://old.example.com/a"],
    "closed tab 999 ignored",
  );
  assert.deepEqual(
    stored.keepAlive.map((entry) => entry.minutes),
    [25, 25],
    "the default interval at mark time is copied onto each mark",
  );
  stored.keepAliveTrash = [];
  response = await send({ type: "keep-alive-set", tabIds: [2], kept: false });
  assert.deepEqual(response, { ok: true });
  assert.deepEqual(
    stored.keepAlive.map((entry) => entry.url),
    ["https://work.example.com/doc"],
  );
  assert.deepEqual(
    stored.keepAliveTrash.map((action) => action.items.map((entry) => entry.url)),
    [["https://old.example.com/a"]],
    "the removed mark is kept for Settings → Restore",
  );
});

test("Service Worker - Keep alive: menu checkbox follows the active tab's mark", { skip: !KEEP_ALIVE_ON }, async () => {
  stored.keepAlive = [
    { url: "https://work.example.com/doc", title: "Doc", minutes: 25, nextReload: Date.now() + HOUR },
  ];
  calls.length = 0;
  await chrome.tabs.onActivated.fire({ tabId: 1 });
  await tick();
  assert.ok(calls.includes('contextMenus.update keep-alive-tab {"checked":true}'), "marked page: checked");
  calls.length = 0;
  await chrome.tabs.onActivated.fire({ tabId: 2 });
  await tick();
  assert.ok(calls.includes('contextMenus.update keep-alive-tab {"checked":false}'), "other page: unchecked");
  // navigating the active tab to a marked page re-syncs too
  calls.length = 0;
  await chrome.tabs.onUpdated.fire(
    2,
    { url: "https://work.example.com/doc" },
    { id: 2, active: true, url: "https://work.example.com/doc" },
  );
  await tick();
  assert.ok(calls.includes('contextMenus.update keep-alive-tab {"checked":true}'), "navigation: checked");
});

test("Service Worker - Keep alive: turning the setting off rebuilds the menu without the item and clears the sweep", {
  skip: !KEEP_ALIVE_ON,
}, async () => {
  stored.keepAlive = [{ url: "https://work.example.com/doc", title: "Doc", minutes: 25, nextReload: 1 }];
  const oldValue = { ...stored.settings };
  stored.settings.keepAliveEnabled = false;
  calls.length = 0;
  await chrome.storage.onChanged.fire({ settings: { oldValue, newValue: { ...stored.settings } } }, "local");
  await tick();
  await tick();
  assert.ok(calls.includes("contextMenus.removeAll"), "menu rebuilt");
  assert.ok(!calls.includes("contextMenus.create keep-alive-tab"), "item gone");
  assert.ok(calls.includes("alarms.clear keep-alive"), "sweep cleared");

  stored.settings.keepAliveEnabled = true;
  calls.length = 0;
  await chrome.storage.onChanged.fire(
    { settings: { oldValue: { ...stored.settings, keepAliveEnabled: false }, newValue: { ...stored.settings } } },
    "local",
  );
  await tick();
  await tick();
  assert.ok(calls.includes("contextMenus.create keep-alive-tab"), "item back");
  assert.ok(
    (stored.keepAlive[0]?.nextReload ?? 0) >= Date.now() + 25 * MINUTE - 55_000,
    "re-enabling restarts every mark: a stale due time must not reload everything at once",
  );
  assert.ok(calls.includes('alarms.create keep-alive {"periodInMinutes":0.5}'), "sweep re-armed");
  stored.keepAlive = [];
});

test("Service Worker - Keep alive: options-page list edits re-arm the sweep through storage.onChanged", {
  skip: !KEEP_ALIVE_ON,
}, async () => {
  stored.keepAlive = [
    { url: "https://work.example.com/doc", title: "Doc", minutes: 25, nextReload: Date.now() + HOUR },
  ];
  calls.length = 0;
  await chrome.storage.onChanged.fire({ keepAlive: { oldValue: [], newValue: stored.keepAlive } }, "local");
  await tick();
  await tick();
  assert.ok(calls.includes('alarms.create keep-alive {"periodInMinutes":0.5}'));
  stored.keepAlive = [];
});

test("Service Worker - KEEP_ALIVE off: sweep alarm and menu click are inert", { skip: KEEP_ALIVE_ON }, async () => {
  stored.keepAlive = [{ url: "https://old.example.com/a", title: "Old A", minutes: 25, nextReload: 0 }];
  calls.length = 0;
  await chrome.alarms.onAlarm.fire({ name: "keep-alive" });
  await chrome.contextMenus.onClicked.fire(
    { menuItemId: "keep-alive-tab" },
    tabs.find((t) => t.id === 2),
  );
  await tick();
  await tick();
  assert.equal(calls.filter((c) => c.startsWith("tabs.reload")).length, 0);
  assert.equal(stored.keepAlive.length, 1, "list untouched");
  stored.keepAlive = [];
});
