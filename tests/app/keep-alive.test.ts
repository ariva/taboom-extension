import assert from "node:assert/strict";
import { test } from "vitest";
import {
  dueKeepAlive,
  formatCountdown,
  isKeptAlive,
  KEEP_ALIVE_MINUTES,
  keepAliveEntry,
  keepAliveKey,
  markKeepAlive,
  nextReloadAt,
  rearmAllKeepAlive,
  rearmKeepAlive,
  setKeepAliveMinutes,
  setKeepAlivePaused,
  unmarkKeepAlive,
} from "../../src/app/keep-alive.ts";
import { DEFAULTS } from "../../src/app/core.ts";
import type { KeepAliveTab } from "../../src/app/types.ts";

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

test("Keep alive - isKeptAlive matches by key, so a fragment change is still the same page", () => {
  assert.equal(isKeptAlive(list, "https://dash.example.com/board#x"), true);
  assert.equal(isKeptAlive(list, "https://dash.example.com/other"), false);
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
  const next = markKeepAlive(
    list,
    [
      { url: "https://new.example.com/#top", title: "New" },
      { url: "https://new.example.com/#bottom", title: "New again" },
      { url: "https://dash.example.com/board", title: "Board" },
      { url: "chrome://settings/", title: "Settings" },
    ],
    5,
    NOW + 5 * MINUTE,
  );
  assert.ok(next);
  assert.deepEqual(next.slice(3), [
    { url: "https://new.example.com/", title: "New", minutes: 5, nextReload: NOW + 5 * MINUTE },
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
  assert.equal(unmarkKeepAlive(list, ["https://nope.example.com/"]), undefined);
});

test("Keep alive - dueKeepAlive returns the entries whose time has come, paused ones never", () => {
  assert.deepEqual(
    dueKeepAlive(list, NOW).map((entry) => entry.url),
    ["https://dash.example.com/board"],
  );
  assert.deepEqual(dueKeepAlive(list, NOW + 2 * MINUTE).length, 2);
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
