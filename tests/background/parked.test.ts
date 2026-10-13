// Parked windows in the service worker: park (snapshot + close), restore (new window or
// into one), move parked tabs out. Own chrome stub — the fixture tabs die when parked.
import assert from "node:assert/strict";
import { test } from "vitest";
import type { Message, MessageError, MessageResponses } from "../../src/app/messages.ts";
import type { LocalStorageSchema } from "../../src/app/types.ts";
import type { ChromeMockOptions } from "../helpers/chrome-mock.ts";
import { makeChrome, tick } from "../helpers/ui.ts";

const NOW = Date.now();
const tabs: NonNullable<ChromeMockOptions["tabs"]> = [
  {
    id: 1,
    windowId: 1,
    index: 0,
    active: true,
    pinned: false,
    url: "https://home.example.com/",
    title: "Home",
    lastAccessed: NOW,
  },
  {
    id: 2,
    windowId: 2,
    index: 1,
    active: true,
    pinned: false,
    groupId: 7,
    url: "https://b.example.com/",
    title: "B",
    lastAccessed: NOW,
  },
  {
    id: 3,
    windowId: 2,
    index: 0,
    active: false,
    pinned: true,
    groupId: -1,
    url: "https://a.example.com/",
    title: "A",
    lastAccessed: NOW,
  },
  {
    id: 4,
    windowId: 2,
    index: 2,
    active: false,
    pinned: false,
    groupId: 7,
    url: "https://c.example.com/",
    title: "C",
    lastAccessed: NOW,
  },
];
const groups: Partial<chrome.tabGroups.TabGroup>[] = [
  { id: 7, title: "work", color: "blue", collapsed: true, windowId: 2 },
  { id: 8, title: "other", color: "red", collapsed: false, windowId: 1 },
];
const calls: string[] = [];
const stored: Partial<LocalStorageSchema> = {};
const chrome = makeChrome({ tabs, calls, stored, groups });
Object.assign(globalThis, { chrome });
await chrome.storage.session.set({ windowSessionMap: { 1: "w-1", 2: "w-2" } });
stored.windowProfiles = {
  "w-1": { chromeWindowId: 1 },
  "w-2": { chromeWindowId: 2, name: "Research", color: "#123456", pinnedWindow: true },
};
await import("../../src/background/service-worker.ts");

type Reply<T extends Message> = MessageResponses[T["type"]] | MessageError;
const send = <T extends Message>(msg: T) =>
  new Promise<Reply<T>>((resolve) => chrome.runtime.onMessage.fire(msg, {}, resolve));

test("Service Worker - Parked: park-window snapshots the window (order, pins, groups, identity) and closes it", async () => {
  calls.length = 0;
  const response = await send({ type: "park-window", windowId: 2 });
  assert.deepEqual(response, { ok: true });
  const [parked] = stored.parkedWindows ?? [];
  assert.ok(parked);
  assert.match(parked.id, /^p-/);
  assert.equal(parked.name, "Research");
  assert.equal(parked.color, "#123456");
  assert.equal(parked.pinnedWindow, true);
  assert.deepEqual(parked.tabs, [
    { url: "https://a.example.com/", title: "A", pinned: true },
    { url: "https://b.example.com/", title: "B", active: true, group: 0 },
    { url: "https://c.example.com/", title: "C", group: 0 },
  ]);
  assert.deepEqual(parked.groups, [{ title: "work", color: "blue", collapsed: true }]);
  const parkedAt = calls.findIndex((c) => c.startsWith("storage.set") && c.includes("parkedWindows"));
  const closedAt = calls.indexOf("windows.remove 2");
  assert.ok(parkedAt !== -1 && closedAt > parkedAt, "snapshot is written BEFORE the window closes");
  assert.deepEqual(
    tabs.map((tab) => tab.id),
    [1],
    "window 2's tabs are gone",
  );
});

test("Service Worker - Parked: park-window on an unknown window parks nothing", async () => {
  calls.length = 0;
  await send({ type: "park-window", windowId: 99 });
  assert.equal(stored.parkedWindows?.length, 1);
  assert.ok(!calls.some((c) => c.startsWith("windows.remove")));
});

test("Service Worker - Parked: restore-parked rebuilds a new window — tabs in order, pins, group, active tab, name", async () => {
  calls.length = 0;
  const id = stored.parkedWindows?.[0]?.id ?? "";
  await send({ type: "restore-parked", id });
  await tick();
  assert.equal(stored.parkedWindows?.length, 0, "restored = no longer parked"); // deepEqual([]) narrows to never[]
  const created = calls.filter((c) => c.startsWith("windows.create") || c.startsWith("tabs.create"));
  assert.deepEqual(created, [
    'windows.create {"url":"https://a.example.com/","focused":true}',
    'tabs.create {"windowId":900,"url":"https://b.example.com/","active":false,"pinned":false}',
    'tabs.create {"windowId":900,"url":"https://c.example.com/","active":false,"pinned":false}',
  ]);
  const restored = tabs.filter((tab) => tab.windowId === 900);
  assert.deepEqual(
    restored.map((tab) => tab.url),
    ["https://a.example.com/", "https://b.example.com/", "https://c.example.com/"],
  );
  assert.equal(restored[0]?.pinned, true, "first tab pinned after the fact (windows.create cannot pin)");
  assert.equal(restored[1]?.groupId, restored[2]?.groupId, "B and C share the recreated group");
  assert.notEqual(restored[1]?.groupId, -1);
  assert.ok(
    calls.some(
      (c) => c.startsWith("tabGroups.update") && c.includes('"title":"work"') && c.includes('"collapsed":true'),
    ),
  );
  assert.ok(calls.includes(`tabs.update ${restored[1]?.id} {"active":true}`), "the parked active tab is active again");
  // identity re-applied to the new window through its profile
  const profile = Object.values(stored.windowProfiles ?? {}).find((entry) => entry.chromeWindowId === 900);
  assert.equal(profile?.name, "Research");
  assert.equal(profile?.color, "#123456");
  assert.equal(profile?.pinnedWindow, true);
});

test("Service Worker - Parked: restore-parked into an existing window appends there; move-parked-tabs opens picked tabs", async () => {
  // park window 900 again, then restore it INTO window 1. The mock never lists a group
  // tabs.group created (only real Chrome does), so register the recreated one by hand.
  const recreated = tabs.find((tab) => tab.windowId === 900 && (tab.groupId ?? -1) !== -1)?.groupId ?? -1;
  groups.push({ id: recreated, title: "work", color: "blue", collapsed: true, windowId: 900 });
  await send({ type: "park-window", windowId: 900 });
  const id = stored.parkedWindows?.[0]?.id ?? "";
  calls.length = 0;
  await send({ type: "restore-parked", id, intoWindowId: 1 });
  assert.equal(stored.parkedWindows?.length, 0);
  assert.ok(!calls.some((c) => c.startsWith("windows.create")), "no new window");
  assert.equal(calls.filter((c) => c.startsWith("tabs.create") && c.includes('"windowId":1')).length, 3);
  assert.ok(
    calls.some((c) => c.startsWith("tabs.group")),
    "group recreated in the target window",
  );

  // move: park window 1 (everything), then move one tab to a new window keeping it, one into a group dropping it
  await send({ type: "park-window", windowId: 1 });
  const parkedId = stored.parkedWindows?.[0]?.id ?? "";
  const before = stored.parkedWindows?.[0]?.tabs.length ?? 0;
  calls.length = 0;
  await send({ type: "move-parked-tabs", id: parkedId, indexes: [1], target: { windowId: null }, keep: true });
  assert.ok(calls.some((c) => c.startsWith("windows.create") && c.includes("https://a.example.com/")));
  assert.equal(stored.parkedWindows?.[0]?.tabs.length, before, "keep = still parked");
  calls.length = 0;
  await send({ type: "move-parked-tabs", id: parkedId, indexes: [0], target: { groupId: 8 }, keep: false });
  assert.ok(
    calls.some((c) => c.startsWith("tabs.create") && c.includes('"windowId":1') && c.includes("home.example.com")),
  );
  assert.ok(
    calls.some((c) => c.startsWith("tabs.group") && c.endsWith(" 8")),
    "joined the chosen group",
  );
  assert.equal(stored.parkedWindows?.[0]?.tabs.length, before - 1, "moved tab left the snapshot");
});

test("Service Worker - Parked: move-parked-tabs asGroup recreates the parked group around the opened tabs", async () => {
  stored.parkedWindows = [
    {
      id: "pg",
      parkedAt: NOW,
      tabs: [
        { url: "https://g1.example.com/", title: "G1", group: 0 },
        { url: "https://g2.example.com/", title: "G2", group: 0 },
        { url: "https://solo.example.com/", title: "Solo" },
      ],
      groups: [{ title: "reading", color: "green", collapsed: true }],
    },
  ];
  calls.length = 0;
  await send({
    type: "move-parked-tabs",
    id: "pg",
    indexes: [0, 1],
    target: { windowId: 1 },
    keep: false,
    asGroup: true,
  });
  const opened = tabs.filter((tab) => /g[12]\.example/.test(tab.url ?? ""));
  assert.equal(opened.length, 2);
  assert.ok(opened.every((tab) => tab.windowId === 1 && tab.groupId === opened[0]?.groupId && tab.groupId !== -1));
  assert.ok(
    calls.some(
      (c) => c.startsWith("tabGroups.update") && c.includes('"title":"reading"') && c.includes('"color":"green"'),
    ),
  );
  assert.deepEqual(
    stored.parkedWindows?.[0]?.tabs.map((tab) => tab.title),
    ["Solo"],
    "the group's tabs left the snapshot",
  );
});
