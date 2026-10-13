import assert from "node:assert/strict";
import { test } from "vitest";
import {
  parkedGroupRef,
  parkedPanelTabs,
  parkedRef,
  renameParkedGroup,
  parkedWindowLabel,
  removedParkedSlice,
  removeParkedTabs,
  removeParkedWindow,
  renameParkedWindow,
  restoreParkedRemoval,
  restorePlan,
  snapshotWindow,
} from "../../src/app/parked.ts";
import { recordRemoval } from "../../src/app/removal-trash.ts";
import type { ParkedWindow } from "../../src/app/types.ts";

const NOW = 1_700_000_000_000;

const liveTabs = [
  { index: 2, url: "https://c.example.com/", title: "C", pinned: false, active: false, groupId: 7 },
  { index: 0, url: "https://a.example.com/", title: "A", pinned: true, active: false, groupId: -1 },
  { index: 1, url: "https://b.example.com/", title: "B", pinned: false, active: true, groupId: 7 },
  {
    index: 3,
    url: undefined,
    pendingUrl: "https://d.example.com/",
    title: "",
    pinned: false,
    active: false,
    groupId: 9,
  },
  { index: 4, url: "", title: "nothing", pinned: false, active: false, groupId: -1 },
];
const liveGroups = [
  { id: 9, title: "later", color: "red", collapsed: true },
  { id: 7, title: "work", color: "blue", collapsed: false },
  { id: 8, title: "unused", color: "grey", collapsed: false },
];

test("Parked - snapshot: strip order, url or pendingUrl, flags absent when false, groups referenced in first-seen order", () => {
  const parked = snapshotWindow(
    liveTabs,
    liveGroups,
    { name: "Research", color: "#123456", pinnedWindow: true },
    NOW,
    "p1",
  );
  assert.deepEqual(parked, {
    id: "p1",
    parkedAt: NOW,
    name: "Research",
    color: "#123456",
    pinnedWindow: true,
    tabs: [
      { url: "https://a.example.com/", title: "A", pinned: true },
      { url: "https://b.example.com/", title: "B", active: true, group: 0 },
      { url: "https://c.example.com/", title: "C", group: 0 },
      { url: "https://d.example.com/", title: "https://d.example.com/", group: 1 },
    ],
    groups: [
      { title: "work", color: "blue" },
      { title: "later", color: "red", collapsed: true },
    ],
  });
  const plain = snapshotWindow(liveTabs.slice(0, 1), [], {}, NOW, "p2");
  assert.deepEqual(
    Object.keys(plain),
    ["id", "parkedAt", "tabs", "groups"],
    "no identity keys when the window had none",
  );
  assert.deepEqual(
    plain.tabs,
    [{ url: "https://c.example.com/", title: "C" }],
    "a group id without a group = ungrouped",
  );
});

const parked: ParkedWindow = {
  id: "p1",
  parkedAt: NOW,
  name: "Research",
  tabs: [
    { url: "https://a.example.com/", title: "A", pinned: true },
    { url: "https://b.example.com/", title: "B", active: true, group: 0 },
    { url: "https://c.example.com/", title: "C", group: 0 },
    { url: "https://d.example.com/", title: "D", group: 1 },
  ],
  groups: [
    { title: "work", color: "blue" },
    { title: "later", color: "red", collapsed: true },
  ],
};
const other: ParkedWindow = {
  id: "p2",
  parkedAt: NOW - 1000,
  tabs: [{ url: "https://e.example.com/", title: "E" }],
  groups: [],
};

test("Parked - restore plan: urls in order, pinned and active indexes, groups with member indexes (empty groups dropped)", () => {
  assert.deepEqual(restorePlan(parked), {
    urls: ["https://a.example.com/", "https://b.example.com/", "https://c.example.com/", "https://d.example.com/"],
    pinned: [0],
    active: 1,
    groups: [
      { title: "work", color: "blue", collapsed: false, indexes: [1, 2] },
      { title: "later", color: "red", collapsed: true, indexes: [3] },
    ],
  });
  assert.equal(restorePlan(other).active, 0, "no active flag: the first tab");
  const orphanGroup: ParkedWindow = { ...other, groups: [{ title: "x", color: "blue" }] };
  assert.deepEqual(restorePlan(orphanGroup).groups, [], "a group nobody is in is not recreated");
});

test("Parked - label: the custom name, else 'Parked' + date", () => {
  assert.equal(parkedWindowLabel(parked), "Research");
  assert.match(parkedWindowLabel(other), /^Parked \d/);
});

test("Parked - remove tabs: by index, window gone with its last tab, undefined when nothing matched", () => {
  const list = [parked, other];
  const next = removeParkedTabs(list, "p1", [0, 2, 99]);
  assert.deepEqual(next?.[0]?.tabs, [parked.tabs[1], parked.tabs[3]]);
  assert.equal(next?.[1], other, "untouched entries keep identity");
  assert.equal(removeParkedTabs(list, "p1", [99]), undefined);
  assert.equal(removeParkedTabs(list, "nope", [0]), undefined);
  assert.deepEqual(removeParkedTabs(list, "p2", [0]), [parked], "last tab out = window out");
});

test("Parked - rename / remove window: absent key for an empty name, undefined when unchanged", () => {
  const renamed = renameParkedWindow([parked, other], "p2", "Later");
  assert.equal(renamed?.[1]?.name, "Later");
  const cleared = renameParkedWindow([parked], "p1", "  ");
  assert.deepEqual(Object.keys(cleared?.[0] ?? {}), ["id", "parkedAt", "tabs", "groups"]);
  assert.equal(renameParkedWindow([parked], "p1", "Research"), undefined);
  assert.equal(renameParkedWindow([parked], "nope", "X"), undefined);
  assert.deepEqual(removeParkedWindow([parked, other], "p1"), [other]);
  assert.equal(removeParkedWindow([parked], "nope"), undefined);
});

test("Parked - rename group: by index, undefined when unknown or unchanged", () => {
  const renamed = renameParkedGroup([parked, other], "p1", 1, " soon ");
  assert.deepEqual(renamed?.[0]?.groups[1], { title: "soon", color: "red", collapsed: true });
  assert.equal(renamed?.[0]?.groups[0], parked.groups[0], "other groups keep identity");
  assert.equal(renameParkedGroup([parked], "p1", 0, "work"), undefined);
  assert.equal(renameParkedGroup([parked], "p1", 5, "x"), undefined);
});

test("Parked - removed slice: the picked tabs with only their groups, re-indexed; undefined when nothing picked", () => {
  const slice = removedParkedSlice(parked, [3, 1]);
  assert.deepEqual(slice, {
    ...parked,
    tabs: [
      { url: "https://b.example.com/", title: "B", active: true, group: 0 },
      { url: "https://d.example.com/", title: "D", group: 1 },
    ],
    groups: parked.groups,
  });
  assert.deepEqual(removedParkedSlice(parked, [3])?.groups, [parked.groups[1]], "unused group dropped");
  assert.equal(removedParkedSlice(parked, [3])?.tabs[0]?.group, 0, "…and the index follows");
  assert.equal(removedParkedSlice(parked, [9]), undefined);
});

test("Parked - restore last removed: a whole window comes back; a slice merges into its window (groups appended) or stands alone", () => {
  const trash = recordRemoval(recordRemoval([], [parked], NOW - 10), [other], NOW);
  const restored = restoreParkedRemoval([], trash);
  assert.deepEqual(restored?.parkedWindows, [other]);
  assert.equal(restored?.parkedTrash.length, 1);
  assert.equal(restoreParkedRemoval([], []), undefined);
  // the removed group "later" (tab D) goes back into Research, whose groups now start with "work"
  const slice = removedParkedSlice(parked, [3]);
  assert.ok(slice);
  const remaining = removeParkedTabs([parked, other], "p1", [3]);
  assert.ok(remaining);
  const merged = restoreParkedRemoval(remaining, recordRemoval([], [slice], NOW));
  const research = merged?.parkedWindows.find((entry) => entry.id === "p1");
  assert.deepEqual(research?.groups, [parked.groups[0], parked.groups[1]]);
  assert.deepEqual(
    research?.tabs.at(-1),
    { url: "https://d.example.com/", title: "D", group: 1 },
    "index shifted past the existing groups",
  );
  assert.equal(research?.tabs.length, 4);
  // window gone in between: the slice is a parked window of its own
  const alone = restoreParkedRemoval([other], recordRemoval([], [slice], NOW));
  assert.deepEqual(
    alone?.parkedWindows.map((entry) => entry.id),
    ["p2", "p1"],
  );
  assert.deepEqual(alone?.parkedWindows[1]?.tabs, slice.tabs);
});

test("Parked - panel tabs: synthetic negative ids per window / tab / group, round-trip through parkedRef", () => {
  const { tabs, groups, meta } = parkedPanelTabs([parked, other]);
  assert.equal(tabs.length, 5);
  const [a, b, , , e] = tabs;
  assert.ok(a && b && e);
  assert.ok(a.id < 0 && a.windowId < 0 && a.windowId === b.windowId && e.windowId !== a.windowId);
  assert.deepEqual(parkedRef(a.id), { window: 0, tab: 0 });
  assert.deepEqual(parkedRef(b.id), { window: 0, tab: 1 });
  assert.deepEqual(parkedRef(e.id), { window: 1, tab: 0 });
  assert.equal(parkedRef(12), undefined, "live ids are not parked refs");
  assert.equal(a.pinned, true);
  assert.equal(b.active, true);
  assert.equal(a.groupId, -1);
  assert.equal(b.groupId, tabs[2]?.groupId, "same parked group = same synthetic group id");
  assert.notEqual(b.groupId, -1);
  assert.equal(groups.get(b.groupId)?.title, "work");
  assert.deepEqual(parkedGroupRef(b.groupId), { window: 0, group: 0 });
  assert.deepEqual(parkedGroupRef(tabs[3]?.groupId ?? -1), { window: 0, group: 1 });
  assert.equal(parkedGroupRef(-1), undefined, "Chrome's no-group id is not a parked group");
  assert.equal(parkedGroupRef(7), undefined);
  assert.equal(groups.get(tabs[3]?.groupId ?? -1)?.collapsed, true);
  assert.equal(a.lastAccessed, NOW, "parked time stands in for last access (recent sort, age)");
  assert.deepEqual(meta.get(a.windowId), { name: "Research" });
  assert.match(meta.get(e.windowId)?.name ?? "", /^Parked /);
  assert.equal(a.index, 0);
  assert.equal(b.index, 1);
});
