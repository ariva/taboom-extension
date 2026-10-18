import assert from "node:assert/strict";
import { test } from "vitest";
import { makeChrome, TEST_EXPERIMENTAL } from "../helpers/ui.ts";
import { DEFAULTS } from "../../src/app/core.ts";
import type { LocalStorageSchema } from "../../src/app/types.ts";

test("Core - Storage - LoadState merges defaults with partial stored state", async () => {
  const stored = { settings: { inactivityMinutes: 15 }, ui: { theme: "dark" } };
  Object.assign(globalThis, { chrome: makeChrome({ stored, calls: [] }) });
  const { loadState } = await import("../../src/app/storage.ts");

  const state = await loadState();
  assert.equal(state.settings.inactivityMinutes, 15, "stored value wins");
  assert.equal(
    state.settings.checkIntervalMinutes,
    DEFAULTS.settings.checkIntervalMinutes,
    "missing setting from defaults",
  );
  assert.equal(state.ui.theme, "dark");
  assert.equal(state.ui.density, DEFAULTS.ui.density, "missing ui pref from defaults");
  assert.deepEqual(state.protectionRules, [], "no rules stored → empty list");
  assert.equal(state.schemaVersion, 1);
});

test("Core - Storage - LoadState on empty storage returns full defaults; saveState patches", async () => {
  const stored: Partial<LocalStorageSchema> = {};
  const calls: string[] = [];
  Object.assign(globalThis, { chrome: makeChrome({ stored, calls }) });
  const { loadState, saveState } = await import("../../src/app/storage.ts");

  const state = await loadState();
  assert.deepEqual(state.settings, DEFAULTS.settings);
  // scenario 2 injects ui.showExperimental into stored state (helpers/ui.ts)
  assert.deepEqual(state.ui, { ...DEFAULTS.ui, ...(TEST_EXPERIMENTAL ? { showExperimental: true } : {}) });

  await saveState({ ui: { ...state.ui, fontSize: 1.3 } });
  assert.equal(stored.ui?.fontSize, 1.3);
  const reloaded = await loadState();
  assert.equal(reloaded.ui.fontSize, 1.3);
  assert.equal(reloaded.ui.theme, DEFAULTS.ui.theme, "untouched prefs keep defaults");
});

test("Core - Storage - Parked windows: add, rename, drop tabs, take, forget to trash, restore last removal", async () => {
  const stored: Partial<LocalStorageSchema> = {};
  const calls: string[] = [];
  Object.assign(globalThis, { chrome: makeChrome({ stored, calls }) });
  const {
    addParkedWindow,
    dropParkedTabs,
    forgetParkedWindow,
    renameParked,
    renameParkedGroupTitle,
    removeParkedTabsToTrash,
    restoreParkedWindows,
    takeParkedWindow,
  } = await import("../../src/app/storage.ts");
  const one = {
    id: "p1",
    parkedAt: 1,
    tabs: [
      { url: "https://a.example.com/", title: "A" },
      { url: "https://b.example.com/", title: "B" },
    ],
    groups: [],
  };
  const two = {
    id: "p2",
    parkedAt: 2,
    tabs: [{ url: "https://c.example.com/", title: "C", group: 0 }],
    groups: [{ title: "g", color: "blue" }],
  };
  await addParkedWindow(one);
  await addParkedWindow(two);
  assert.deepEqual(
    stored.parkedWindows?.map((parked) => parked.id),
    ["p1", "p2"],
  );

  assert.equal(await renameParked("p1", "Work"), true);
  assert.equal(stored.parkedWindows?.[0]?.name, "Work");
  assert.equal(await renameParked("p1", "Work"), false, "same name = no write");
  assert.equal(await renameParkedGroupTitle("p2", 0, "later"), true);
  assert.equal(stored.parkedWindows?.[1]?.groups[0]?.title, "later");
  assert.equal(await renameParkedGroupTitle("p2", 3, "x"), false);

  assert.equal(await removeParkedTabsToTrash("p1", [1]), true);
  assert.deepEqual(
    stored.parkedWindows?.[0]?.tabs.map((tab) => tab.title),
    ["A"],
  );
  assert.deepEqual(
    stored.parkedTrash?.at(-1)?.items[0]?.tabs.map((tab) => tab.title),
    ["B"],
    "removed tab kept",
  );
  assert.equal(await removeParkedTabsToTrash("p1", [9]), false);
  assert.equal(await restoreParkedWindows(), true);
  assert.deepEqual(
    stored.parkedWindows?.[0]?.tabs.map((tab) => tab.title),
    ["A", "B"],
    "…and back in its window",
  );
  assert.equal(await dropParkedTabs("p1", [1]), true);
  assert.deepEqual(
    stored.parkedWindows?.[0]?.tabs.map((tab) => tab.title),
    ["A"],
  );
  assert.equal(await dropParkedTabs("p1", [7]), false);
  assert.equal(await dropParkedTabs("p2", [0]), true, "last tab out = window out");
  assert.deepEqual(
    stored.parkedWindows?.map((parked) => parked.id),
    ["p1"],
  );
  assert.deepEqual(stored.parkedTrash ?? [], [], "moving tabs out is not a removal");

  assert.equal(await forgetParkedWindow("p1"), true);
  assert.equal(stored.parkedWindows?.length, 0); // not deepEqual([]): that narrows the fixture to never[]
  assert.equal(stored.parkedTrash?.length, 1);
  assert.equal(await forgetParkedWindow("p1"), false);
  assert.equal(await restoreParkedWindows(), true);
  assert.deepEqual(
    stored.parkedWindows?.map((parked) => parked.id),
    ["p1"],
  );
  assert.deepEqual(stored.parkedTrash, []);
  assert.equal(await restoreParkedWindows(), false, "empty trash");

  assert.equal((await takeParkedWindow("p1"))?.name, "Work", "take = remove without trash (restore)");
  assert.equal(stored.parkedWindows?.length, 0);
  assert.equal(await takeParkedWindow("p1"), undefined);
});

test("Core - Storage - Tags: add, edit, page tags, remove to trash, clear, restore last removal", async () => {
  const stored: Partial<LocalStorageSchema> = {};
  const calls: string[] = [];
  Object.assign(globalThis, { chrome: makeChrome({ stored, calls }) });
  const {
    addTag,
    clearTags,
    editTag,
    removeTagPagesToTrash,
    removeTagsToTrash,
    restoreTags,
    setPageTagIds,
    toggleTagOnPages,
  } = await import("../../src/app/storage.ts");
  const work = await addTag("work", "blue");
  const bills = await addTag("bills", "yellow");
  assert.ok(work && bills);
  assert.equal(await addTag("WORK", "red"), undefined, "duplicate name writes nothing");
  assert.deepEqual(
    stored.tags?.map((tag) => tag.name),
    ["work", "bills"],
  );
  assert.equal(await editTag(work.id, { name: "Work", color: "red" }), true);
  assert.deepEqual(stored.tags?.[0], { id: work.id, name: "Work", color: "red" });
  assert.equal(await editTag(work.id, { color: "red" }), false, "no change, no write");

  assert.equal(await toggleTagOnPages(["https://a.test/", "https://b.test/#x"], work.id, true), true);
  assert.deepEqual(stored.tagPages, [
    { url: "https://a.test/", tagIds: [work.id] },
    { url: "https://b.test/", tagIds: [work.id] },
  ]);
  assert.equal(await setPageTagIds("https://a.test/", [work.id, bills.id]), true);
  assert.deepEqual(stored.tagPages?.[0]?.tagIds, [work.id, bills.id]);

  assert.equal(await removeTagPagesToTrash(["https://b.test/"]), true);
  assert.deepEqual(
    stored.tagPages?.map((page) => page.url),
    ["https://a.test/"],
  );
  assert.equal(stored.tagTrash?.length, 1);
  assert.equal(await removeTagsToTrash([bills.id]), true);
  assert.deepEqual(
    stored.tags?.map((tag) => tag.id),
    [work.id],
  );
  assert.deepEqual(stored.tagPages?.[0]?.tagIds, [work.id]);
  assert.equal(stored.tagTrash?.length, 2);
  assert.equal(await removeTagsToTrash(["nope"]), false);

  assert.equal(await restoreTags(), true, "bills comes back with its page id");
  assert.deepEqual(
    stored.tags?.map((tag) => tag.id),
    [work.id, bills.id],
  );
  assert.deepEqual(stored.tagPages?.[0]?.tagIds, [work.id, bills.id]);
  assert.equal(await restoreTags(), true, "then the removed page");
  assert.deepEqual(
    stored.tagPages?.map((page) => page.url),
    ["https://a.test/", "https://b.test/"],
  );
  assert.equal(await restoreTags(), false);

  assert.equal(await clearTags(), true);
  assert.deepEqual(stored.tags, []);
  assert.deepEqual(stored.tagPages, []);
  assert.equal(await restoreTags(), true, "Remove all is one undoable action");
  assert.equal(stored.tags?.length, 2);
  assert.equal(stored.tagPages?.length, 2);
  assert.equal(await clearTags(), true, "clearing a filled list is a change");
});
