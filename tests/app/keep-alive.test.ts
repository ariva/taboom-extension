import assert from "node:assert/strict";
import { test } from "vitest";
import {
  dueKeepAlive,
  formatCountdown,
  isKeptAlive,
  KEEP_ALIVE_MINUTES,
  keepAliveEntry,
  keepAliveKey,
  keepAliveUrlFromInput,
  markKeepAlive,
  matchesKeepAlive,
  nextReloadAt,
  rearmAllKeepAlive,
  recordKeepAliveRemoval,
  restoreKeepAliveRemoval,
  rearmKeepAlive,
  setKeepAliveMinutes,
  setKeepAlivePaused,
  setKeepAliveUrl,
  unmarkKeepAlive,
} from "../../src/app/keep-alive.ts";
import { DEFAULTS } from "../../src/app/core.ts";
import type { KeepAliveRemoval, KeepAliveTab } from "../../src/app/types.ts";

const NOW = 1_700_000_000_000;
const MINUTE = 60_000;

const list: KeepAliveTab[] = [
  { url: "https://dash.example.com/board", title: "Board", minutes: 25, nextReload: NOW - 1 },
  { url: "https://mail.example.com/", title: "Mail", minutes: 5, nextReload: NOW + MINUTE },
  { url: "https://paused.example.com/", title: "Paused", minutes: 1, paused: true, nextReload: NOW - 1 },
];

test("Keep alive - Interval choices match the options dropdown, the default among them", () => {
  assert.deepEqual([...KEEP_ALIVE_MINUTES], [1, 5, 10, 15, 20, 25, 30, 45, 60, 90]);
  assert.ok((KEEP_ALIVE_MINUTES as readonly number[]).includes(DEFAULTS.settings.keepAliveMinutes));
});

test("Keep alive - Key strips the fragment; empty for unsupported or missing urls", () => {
  assert.equal(keepAliveKey("https://dash.example.com/board#tab=2"), "https://dash.example.com/board");
  assert.equal(keepAliveKey("https://dash.example.com/board"), "https://dash.example.com/board");
  assert.equal(keepAliveKey("chrome://extensions/"), "");
  assert.equal(keepAliveKey(undefined), "");
});

test("Keep alive - matchesKeepAlive: a fragment-free mark covers every fragment, a mark with one is exact", () => {
  assert.equal(matchesKeepAlive("https://dash.example.com/board", "https://dash.example.com/board#x"), true);
  assert.equal(matchesKeepAlive("https://dash.example.com/board", "https://dash.example.com/board"), true);
  assert.equal(matchesKeepAlive("https://app.example.com/#/dash", "https://app.example.com/#/dash"), true);
  assert.equal(matchesKeepAlive("https://app.example.com/#/dash", "https://app.example.com/#/mail"), false);
  assert.equal(matchesKeepAlive("https://app.example.com/#/dash", "https://app.example.com/"), false);
  assert.equal(matchesKeepAlive("https://dash.example.com/board", "chrome://extensions/"), false);
  assert.equal(matchesKeepAlive("https://dash.example.com/board", undefined), false);
});

test("Keep alive - isKeptAlive / keepAliveEntry go through matchesKeepAlive, fragment marks included", () => {
  assert.equal(isKeptAlive(list, "https://dash.example.com/board#x"), true);
  assert.equal(isKeptAlive(list, "https://dash.example.com/other"), false);
  const hashed: KeepAliveTab = { url: "https://app.example.com/#/dash", title: "Dash", minutes: 5, nextReload: 1 };
  assert.equal(isKeptAlive([hashed], "https://app.example.com/#/dash"), true);
  assert.equal(isKeptAlive([hashed], "https://app.example.com/#/mail"), false);
  assert.equal(keepAliveEntry([hashed], "https://app.example.com/#/dash"), hashed);
  assert.equal(keepAliveEntry([hashed], "https://app.example.com/"), undefined);
  assert.equal(isKeptAlive(list, undefined), false);
});

test("Keep alive - nextReloadAt jitters ±55 s around the interval, never under 30 s", () => {
  assert.equal(
    nextReloadAt(25, NOW, () => 0.5),
    NOW + 25 * MINUTE,
    "random 0.5 = no jitter",
  );
  assert.equal(
    nextReloadAt(25, NOW, () => 0),
    NOW + 25 * MINUTE - 55_000,
    "random 0 = -55 s",
  );
  assert.equal(
    nextReloadAt(25, NOW, () => 1),
    NOW + 25 * MINUTE + 55_000,
    "random 1 = +55 s",
  );
  assert.equal(
    nextReloadAt(1, NOW, () => 0),
    NOW + 30_000,
    "1 min - 55 s would be 5 s: floored to the alarm minimum",
  );
});

test("Keep alive - markKeepAlive adds unknown pages once with the default interval snapshotted; undefined when nothing new", () => {
  // callers hand in keys (keepAliveKey for tabs, keepAliveUrlFromInput for typed): "" = unsupported
  const next = markKeepAlive(
    list,
    [
      { url: "https://new.example.com/", title: "New" },
      { url: "https://new.example.com/", title: "New again" },
      { url: "https://app.example.com/#/dash", title: "Dash" },
      { url: "https://dash.example.com/board", title: "Board" },
      { url: "", title: "Settings" },
    ],
    5,
    NOW + 5 * MINUTE,
  );
  assert.ok(next);
  assert.deepEqual(next.slice(3), [
    { url: "https://new.example.com/", title: "New", minutes: 5, nextReload: NOW + 5 * MINUTE },
    { url: "https://app.example.com/#/dash", title: "Dash", minutes: 5, nextReload: NOW + 5 * MINUTE },
  ]);
  assert.equal(markKeepAlive(list, [{ url: "https://dash.example.com/board", title: "Board" }], 5, NOW), undefined);
});

test("Keep alive - unmarkKeepAlive drops the pages; undefined when none listed", () => {
  const next = unmarkKeepAlive(list, ["https://dash.example.com/board#x"]);
  assert.ok(next);
  assert.deepEqual(
    next.map((entry) => entry.url),
    ["https://mail.example.com/", "https://paused.example.com/"],
  );
  const hashed: KeepAliveTab = { url: "https://app.example.com/#/dash", title: "Dash", minutes: 5, nextReload: 1 };
  const bare: KeepAliveTab = { url: "https://app.example.com/", title: "App", minutes: 5, nextReload: 1 };
  assert.deepEqual(
    unmarkKeepAlive([hashed, bare], ["https://app.example.com/#/dash"]),
    [bare],
    "its own url: the hash mark only",
  );
  assert.deepEqual(
    unmarkKeepAlive([hashed, bare], ["https://app.example.com/"]),
    [hashed],
    "bare url: the bare mark only",
  );
  assert.deepEqual(
    unmarkKeepAlive([hashed, bare], ["https://app.example.com/#/mail"]),
    [hashed],
    "a tab on another hash: the bare mark covers it",
  );
  assert.equal(unmarkKeepAlive(list, ["https://nope.example.com/"]), undefined);
});

test("Keep alive - dueKeepAlive returns the entries whose time has come, paused ones never", () => {
  assert.deepEqual(
    dueKeepAlive(list, NOW).map((entry) => entry.url),
    ["https://dash.example.com/board"],
  );
  assert.deepEqual(dueKeepAlive(list, NOW + 2 * MINUTE).length, 2);
});

test("Keep alive - rearmKeepAlive takes the open tab's title along, so a mark's name catches up with the page", () => {
  const next = rearmKeepAlive(list, "https://dash.example.com/board", NOW + MINUTE, "Board — 3 new");
  assert.deepEqual(next[0], { ...list[0], nextReload: NOW + MINUTE, title: "Board — 3 new" });
  assert.deepEqual(next.slice(1), list.slice(1));
  assert.equal(rearmKeepAlive(list, "https://dash.example.com/board", NOW, "")[0]?.title, "Board", "empty title: kept");
  assert.equal(rearmKeepAlive(list, "https://dash.example.com/board", NOW)[0]?.title, "Board", "no title: kept");
});

test("Keep alive - rearmKeepAlive replaces one entry's next time, others untouched", () => {
  const next = rearmKeepAlive(list, "https://dash.example.com/board", NOW + 9);
  assert.equal(next[0]?.nextReload, NOW + 9);
  assert.equal(next[1], list[1], "untouched entry keeps its identity");
});

test("Keep alive - setKeepAliveMinutes changes the interval and re-arms from now; undefined when unchanged or unknown", () => {
  const next = setKeepAliveMinutes(list, "https://dash.example.com/board", 10, NOW + 10 * MINUTE);
  assert.ok(next);
  assert.deepEqual(next[0], {
    url: "https://dash.example.com/board",
    title: "Board",
    minutes: 10,
    nextReload: NOW + 10 * MINUTE,
  });
  assert.equal(next[1], list[1], "others untouched");
  assert.equal(setKeepAliveMinutes(list, "https://mail.example.com/", 5, NOW), undefined, "same value = no write");
  assert.equal(setKeepAliveMinutes(list, "https://nope.example.com/", 5, NOW), undefined, "unknown url = no write");
});

test("Keep alive - setKeepAlivePaused: either way restarts the schedule; pause keeps the mark, key absent when running", () => {
  const paused = setKeepAlivePaused(list, "https://dash.example.com/board", true, NOW);
  assert.ok(paused);
  assert.equal(paused[0]?.paused, true);
  assert.equal(paused[0]?.nextReload, NOW, "pausing restarts the schedule too");
  const resumed = setKeepAlivePaused(list, "https://paused.example.com/", false, NOW + MINUTE);
  assert.ok(resumed);
  assert.ok(!("paused" in (resumed[2] ?? {})), "key absent, not false-valued");
  assert.equal(resumed[2]?.nextReload, NOW + MINUTE, "resuming re-arms: a stale due time would reload at once");
  assert.equal(
    setKeepAlivePaused(list, "https://paused.example.com/", true, NOW),
    undefined,
    "already paused = no write",
  );
  assert.equal(
    setKeepAlivePaused(list, "https://mail.example.com/", false, NOW),
    undefined,
    "already running = no write",
  );
});

test("Keep alive - rearmAllKeepAlive restarts every mark from now at its own interval, paused ones included", () => {
  const next = rearmAllKeepAlive(list, NOW, () => 0.5);
  assert.deepEqual(
    next.map((entry) => entry.nextReload),
    [NOW + 25 * MINUTE, NOW + 5 * MINUTE, NOW + MINUTE],
  );
  assert.equal(next[2]?.paused, true, "pause state untouched");
});

test("Keep alive - keepAliveEntry finds the mark behind a url (fragment ignored), undefined otherwise", () => {
  assert.equal(keepAliveEntry(list, "https://paused.example.com/#x"), list[2]);
  assert.equal(keepAliveEntry(list, "https://nope.example.com/"), undefined);
  assert.equal(keepAliveEntry(list, undefined), undefined);
});

test("Keep alive - formatCountdown shows m:ss until the next reload, 'now' once it is due", () => {
  assert.equal(formatCountdown(NOW + 25 * MINUTE, NOW), "25:00");
  assert.equal(formatCountdown(NOW + 5 * MINUTE + 7_000, NOW), "5:07");
  assert.equal(formatCountdown(NOW + 90 * MINUTE, NOW), "90:00");
  assert.equal(formatCountdown(NOW + 999, NOW), "0:01", "rounded up: never shows 0:00 while still pending");
  assert.equal(formatCountdown(NOW, NOW), "now");
  assert.equal(formatCountdown(NOW - 1, NOW), "now");
});

test("Keep alive - keepAliveUrlFromInput: typed address normalized like a tab url; https assumed; junk is empty", () => {
  assert.equal(
    keepAliveUrlFromInput(" https://Dash.Example.com/board#tab=2 "),
    "https://dash.example.com/board#tab=2",
    "fragment kept: hash-routed apps",
  );
  assert.equal(keepAliveUrlFromInput("https://app.example.com/#/dash"), "https://app.example.com/#/dash");
  assert.equal(keepAliveUrlFromInput("https://example.com/#"), "https://example.com/", "a lone # is no fragment");
  assert.equal(
    keepAliveUrlFromInput("https://example.com"),
    "https://example.com/",
    "trailing slash as Chrome reports it",
  );
  assert.equal(keepAliveUrlFromInput("app.example.com/board?id=1"), "https://app.example.com/board?id=1");
  assert.equal(keepAliveUrlFromInput("file:///home/me/report.html"), "file:///home/me/report.html");
  assert.equal(keepAliveUrlFromInput(""), "");
  assert.equal(keepAliveUrlFromInput("   "), "");
  assert.equal(keepAliveUrlFromInput("chrome://extensions"), "", "unsupported scheme");
  assert.equal(keepAliveUrlFromInput("http://"), "", "not an address");
});

test("Keep alive - trash: a removal is recorded newest last, kept until restored, capped at 50 actions", () => {
  const first = recordKeepAliveRemoval([], [list[0]!], NOW - 400 * 24 * 60 * MINUTE);
  const second = recordKeepAliveRemoval(first, [list[1]!, list[2]!], NOW);
  assert.deepEqual(second, [...first, { at: NOW, marks: [list[1], list[2]] }], "a year-old action is still there");
  assert.deepEqual(recordKeepAliveRemoval(first, [], NOW), first, "nothing removed: nothing recorded");
  let many: KeepAliveRemoval[] = [];
  for (let index = 0; index < 60; index += 1) {
    many = recordKeepAliveRemoval(many, [{ ...list[0]!, url: `https://n${index}.example.com/` }], NOW + index);
  }
  assert.equal(many.length, 50);
  assert.equal(many[0]?.at, NOW + 10, "oldest actions dropped first");
});

test("Keep alive - restoreKeepAliveRemoval: newest action back, re-armed from now, pages marked meanwhile skipped; undefined when nothing to restore", () => {
  const trash = recordKeepAliveRemoval(recordKeepAliveRemoval([], [list[0]!], NOW - MINUTE), [list[1]!, list[2]!], NOW);
  const restored = restoreKeepAliveRemoval([list[1]!], trash, NOW, () => 0.5);
  assert.ok(restored);
  assert.deepEqual(
    restored.keepAlive,
    [list[1], { ...list[2], nextReload: NOW + MINUTE }],
    "Mail already marked again: kept once; Paused back with its flag, timer from now",
  );
  assert.deepEqual(
    restored.keepAliveTrash,
    [{ at: NOW - MINUTE, marks: [list[0]] }],
    "only the newest action consumed",
  );
  const again = restoreKeepAliveRemoval(restored.keepAlive, restored.keepAliveTrash, NOW, () => 0.5);
  assert.deepEqual(
    again?.keepAlive.map((entry) => entry.url),
    [list[1]!.url, list[2]!.url, list[0]!.url],
  );
  assert.deepEqual(again?.keepAliveTrash, []);
  assert.equal(restoreKeepAliveRemoval(list, [], NOW), undefined, "empty trash");
});

test("Keep alive - setKeepAliveUrl re-keys one mark, rest untouched; undefined when unknown, empty, same or taken", () => {
  const next = setKeepAliveUrl(list, "https://dash.example.com/board", "https://dash.example.com/board#/dash");
  assert.ok(next);
  assert.deepEqual(
    next[0],
    { ...list[0], url: "https://dash.example.com/board#/dash" },
    "title, timer and interval kept",
  );
  assert.deepEqual(next.slice(1), list.slice(1));
  // a title that was only the hostname (Add row, no tab seen yet) follows the new address
  const auto: KeepAliveTab = { url: "https://old.example.com/a", title: "old.example.com", minutes: 5, nextReload: 1 };
  assert.equal(setKeepAliveUrl([auto], auto.url, "https://new.example.com/b#/x")?.[0]?.title, "new.example.com");
  assert.equal(setKeepAliveUrl([auto], auto.url, "https://old.example.com/b")?.[0]?.title, "old.example.com");
  assert.equal(setKeepAliveUrl(list, "https://nope.example.com/", "https://x.example.com/"), undefined, "unknown mark");
  assert.equal(setKeepAliveUrl(list, "https://dash.example.com/board", ""), undefined, "nothing typed");
  assert.equal(
    setKeepAliveUrl(list, "https://dash.example.com/board", "https://dash.example.com/board"),
    undefined,
    "same",
  );
  assert.equal(
    setKeepAliveUrl(list, "https://dash.example.com/board", "https://mail.example.com/"),
    undefined,
    "another mark's url",
  );
});
