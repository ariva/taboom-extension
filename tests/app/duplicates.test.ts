import assert from "node:assert/strict";
import { test } from "vitest";
import {
  closingWindows,
  duplicateKey,
  duplicateSets,
  duplicatesToClose,
  NEW_TAB_KEY,
  rankKeepers,
} from "../../src/app/duplicates.ts";

const NOW = 1_700_000_000_000;

const tab = (
  id: number,
  windowId: number,
  url: string,
  extra: Partial<{ title: string; pinned: boolean; active: boolean; discarded: boolean; lastAccessed: number }> = {},
) => ({ id, windowId, url, title: `T${id}`, lastAccessed: NOW, ...extra });

const noContext = { currentWindowId: 1, keepAlive: [] };

test("Duplicates - key drops the fragment, keeps the query; every New Tab flavour is one key; empty for no url", () => {
  assert.equal(duplicateKey("https://a.example.com/x?y=1#top"), "https://a.example.com/x?y=1");
  assert.equal(duplicateKey("chrome://newtab/"), NEW_TAB_KEY);
  assert.equal(duplicateKey("chrome://new-tab-page/"), NEW_TAB_KEY);
  assert.equal(duplicateKey("chrome://new-tab-page-third-party/"), NEW_TAB_KEY);
  assert.equal(duplicateKey("about:blank"), NEW_TAB_KEY);
  assert.equal(duplicateKey("chrome://extensions/"), "chrome://extensions/");
  assert.equal(duplicateKey(undefined), "");
  assert.equal(duplicateKey(""), "");
});

test("Duplicates - sets: pages open more than once, first-seen order, windows counted, New Tab titled", () => {
  const tabs = [
    tab(1, 1, "https://a.example.com/", { title: "A" }),
    tab(2, 1, "https://b.example.com/"),
    tab(3, 2, "https://a.example.com/#frag", { title: "A again" }),
    tab(4, 1, "chrome://newtab/"),
    tab(5, 2, "about:blank"),
    tab(6, 1, "https://a.example.com/"),
  ];
  const sets = duplicateSets(tabs);
  assert.deepEqual(
    sets.map((set) => [set.key, set.title, set.tabs.map((t) => t.id), set.windowIds]),
    [
      ["https://a.example.com/", "A", [1, 3, 6], [1, 2]],
      [NEW_TAB_KEY, "New Tab", [4, 5], [1, 2]],
    ],
  );
  assert.equal(sets[0]?.url, "https://a.example.com/");
  assert.equal(sets[1]?.url, "");
  assert.equal(duplicateSets([tab(1, 1, "https://a.example.com/"), tab(2, 1, "https://b.example.com/")]).length, 0);
});

test("Duplicates - keeper order: pinned, kept alive, active here, active anywhere, awake, most recent, first found", () => {
  const url = "https://a.example.com/";
  const plain = tab(1, 2, url, { lastAccessed: NOW - 10 });
  const recent = tab(2, 2, url, { lastAccessed: NOW });
  const awake = tab(3, 2, url, { lastAccessed: NOW - 100 });
  const snoozed = tab(4, 2, url, { discarded: true, lastAccessed: NOW + 100 });
  const activeElsewhere = tab(5, 2, url, { active: true, discarded: true });
  const activeHere = tab(6, 1, url, { active: true, discarded: true, lastAccessed: 0 });
  const kept = tab(7, 3, url, { discarded: true, lastAccessed: 0 });
  const pinned = tab(8, 3, url, { pinned: true, discarded: true, lastAccessed: 0 });
  const context = { currentWindowId: 1, keepAlive: [{ url, title: "A", minutes: 5, nextReload: 0 }] };
  // kept-alive matches by url: every copy here is "kept" — the mark decides nothing between them
  const everyone = rankKeepers([plain, recent, awake, snoozed, activeElsewhere, activeHere, pinned], context);
  assert.deepEqual(
    everyone.map((t) => t.id),
    [8, 6, 5, 2, 1, 3, 4],
  );
  // a mark on a different page: kept-alive beats active
  const other = tab(9, 3, "https://a.example.com/#x", { discarded: true, lastAccessed: 0 });
  const ranked = rankKeepers([activeHere, kept, other], { currentWindowId: 1, keepAlive: [] });
  assert.deepEqual(
    ranked.map((t) => t.id),
    [6, 7, 9],
    "no mark: active wins, then first found",
  );
  const marked = rankKeepers([activeHere, awake, kept], {
    currentWindowId: 1,
    keepAlive: [{ url: "https://a.example.com/", title: "A", minutes: 5, nextReload: 0 }],
  });
  assert.equal(marked[0]?.id, 6, "mark covers every copy: falls through to active");
  assert.deepEqual(
    rankKeepers([plain, awake], noContext).map((t) => t.id),
    [1, 3],
    "same everything: most recent first",
  );
});

test("Duplicates - 'one': a single keeper across windows; pinned copies are never closed", () => {
  const url = "https://a.example.com/";
  const set = duplicateSets([
    tab(1, 1, url, { active: true }),
    tab(2, 1, url),
    tab(3, 2, url, { pinned: true }),
    tab(4, 2, url, { pinned: true }),
    tab(5, 3, url),
  ])[0];
  assert.ok(set);
  assert.deepEqual(
    duplicatesToClose(set, "one", noContext).map((t) => t.id),
    [1, 2, 5],
    "a pinned copy is the keeper; the other pinned one stays too; everything unpinned goes",
  );
  const unpinned = duplicateSets([tab(1, 1, url, { active: true }), tab(2, 1, url), tab(5, 3, url)])[0];
  assert.ok(unpinned);
  assert.deepEqual(
    duplicatesToClose(unpinned, "one", noContext).map((t) => t.id),
    [2, 5],
  );
});

test("Duplicates - 'per-window': one keeper in each window; a window with a single copy is untouched", () => {
  const url = "https://a.example.com/";
  const set = duplicateSets([
    tab(1, 1, url, { lastAccessed: NOW - 5 }),
    tab(2, 1, url, { lastAccessed: NOW }),
    tab(3, 2, url),
    tab(4, 3, url, { discarded: true }),
    tab(5, 3, url),
  ])[0];
  assert.ok(set);
  assert.deepEqual(
    duplicatesToClose(set, "per-window", noContext).map((t) => t.id),
    [1, 4],
  );
});

test("Duplicates - New Tab keeps one per window even under 'one'", () => {
  const set = duplicateSets([
    tab(1, 1, "chrome://newtab/"),
    tab(2, 1, "chrome://newtab/"),
    tab(3, 2, "about:blank"),
    tab(4, 2, "chrome://newtab/"),
  ])[0];
  assert.ok(set);
  assert.deepEqual(
    duplicatesToClose(set, "one", noContext).map((t) => t.id),
    [2, 4],
  );
  assert.deepEqual(
    duplicatesToClose(set, "per-window", noContext).map((t) => t.id),
    [2, 4],
  );
});

test("Duplicates - closingWindows names the windows whose every tab is about to go", () => {
  const tabs = [
    tab(1, 1, "https://a.example.com/"),
    tab(2, 1, "https://b.example.com/"),
    tab(3, 2, "https://a.example.com/"),
    tab(4, 3, "https://a.example.com/"),
    tab(5, 3, "https://a.example.com/"),
  ];
  assert.deepEqual(closingWindows(tabs, [1, 3, 4, 5]), [2, 3]);
  assert.deepEqual(closingWindows(tabs, [1]), []);
  assert.deepEqual(closingWindows(tabs, []), []);
});
