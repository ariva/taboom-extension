import assert from "node:assert/strict";
import { test } from "vitest";
import {
  dueKeepAlive,
  setKeepAliveExpiry,
  formatCountdown,
  isKeptAlive,
  KEEP_ALIVE_MINUTES,
  keepAliveEntries,
  keepAliveEntry,
  keepAliveKey,
  keepAliveTargets,
  keepAliveKindLabel,
  keepAliveOpenUrl,
  keepAliveTitle,
  keepAliveUrlFromInput,
  markKeepAlive,
  matchesKeepAlive,
  nextReloadAt,
  rearmAllKeepAlive,
  restoreKeepAliveRemoval,
  rearmKeepAlive,
  setKeepAliveMinutes,
  setKeepAlivePaused,
  setKeepAliveReloadAll,
  setKeepAliveUrl,
  staggerKeepAlive,
  unmarkKeepAlive,
} from "../../src/app/keep-alive.ts";
import { DEFAULTS } from "../../src/app/core.ts";
import { recordRemoval } from "../../src/app/removal-trash.ts";
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

test("Keep alive - Targets: one tab per mark (pinned first, else first in query order) unless reloadAll", () => {
  const tabs = [
    { id: 1, pinned: false, url: "https://dash.example.com/board#a" },
    { id: 2, pinned: false, url: "https://other.example.com/" },
    { id: 3, pinned: true, url: "https://dash.example.com/board" },
    { id: 4, pinned: false, url: "https://dash.example.com/board#b" },
    { id: undefined, pinned: true, url: "https://dash.example.com/board" },
  ];
  const mark = "https://dash.example.com/board";
  assert.deepEqual(
    keepAliveTargets(tabs, mark, false).map((tab) => tab.id),
    [3],
    "pinned match wins over an earlier one",
  );
  assert.deepEqual(
    keepAliveTargets(
      tabs.filter((tab) => !tab.pinned),
      mark,
      false,
    ).map((tab) => tab.id),
    [1],
    "no pinned match: first in query order",
  );
  assert.deepEqual(
    keepAliveTargets(tabs, mark, true).map((tab) => tab.id),
    [1, 3, 4],
    "reloadAll: every match, query order",
  );
  assert.equal(keepAliveTargets(tabs, "https://none.example.com/", false).length, 0);
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
  // a mark's own url finds that mark — a domain or glob is no page address, so matching alone
  // never found it, and Pause / Resume on such a mark did nothing (T-0156 bug report)
  const domain: KeepAliveTab = { url: "github.com", title: "github.com", minutes: 5, nextReload: 1 };
  const page: KeepAliveTab = { url: "https://github.com/pr/1", title: "PR", minutes: 5, nextReload: 1 };
  assert.equal(keepAliveEntry([page, domain], "github.com"), domain, "the mark itself, not the first covering one");
  assert.equal(keepAliveEntry([page, domain], "https://github.com/pr/1"), page);
  // every mark covering a tab, list order: the badge is live while any of them runs
  assert.deepEqual(keepAliveEntries([page, domain], "https://github.com/pr/1"), [page, domain]);
  assert.deepEqual(keepAliveEntries([page, domain], "https://github.com/pr/2"), [domain]);
  assert.deepEqual(keepAliveEntries([page, domain], "chrome://extensions/"), []);
  // a temporary mark counts until its time; expired (still stored until the sweep) it covers nothing
  const temporary: KeepAliveTab = { ...page, expiresAt: NOW + 1000 };
  assert.equal(isKeptAlive([temporary], "https://github.com/pr/1", NOW), true);
  assert.equal(isKeptAlive([temporary], "https://github.com/pr/1", NOW + 1000), false, "expired");
  assert.deepEqual(keepAliveEntries([temporary, domain], "https://github.com/pr/1", NOW + 1000), [domain]);
  assert.equal(
    keepAliveEntry([temporary], "https://github.com/pr/1"),
    temporary,
    "the writers still find it (to drop it)",
  );
});

test("Keep alive - dueKeepAlive skips an expired mark; markKeepAlive stamps the expiry; setKeepAliveExpiry re-bases or clears it", () => {
  const expired: KeepAliveTab = { ...list[0]!, url: "https://gone.example.com/", expiresAt: NOW - 1 };
  assert.deepEqual(dueKeepAlive([...list, expired], NOW), [list[0]], "due, not paused, not expired");
  const marked = markKeepAlive([], [{ url: "https://a.test/", title: "A" }], 25, NOW + 1, NOW + 3_600_000);
  assert.deepEqual(marked, [
    { url: "https://a.test/", title: "A", minutes: 25, nextReload: NOW + 1, expiresAt: NOW + 3_600_000 },
  ]);
  const forever = markKeepAlive([], [{ url: "https://a.test/", title: "A" }], 25, NOW + 1);
  assert.ok(!("expiresAt" in (forever?.[0] ?? {})), "no duration: no key");
  const set = setKeepAliveExpiry(marked ?? [], "https://a.test/", NOW + 7_200_000);
  assert.equal(set?.[0]?.expiresAt, NOW + 7_200_000);
  const cleared = setKeepAliveExpiry(marked ?? [], "https://a.test/", undefined);
  assert.ok(cleared && !("expiresAt" in (cleared[0] ?? {})), "Never: the key goes");
  assert.equal(setKeepAliveExpiry(marked ?? [], "https://a.test/", NOW + 3_600_000), undefined, "unchanged: no write");
  assert.equal(setKeepAliveExpiry(marked ?? [], "https://nope.test/", undefined), undefined, "unknown mark");
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

test("Keep alive - dueKeepAlive: a mark more than one of its own intervals past its time is missed (sleep, Chrome closed), not due", () => {
  // `later`: the 25 min mark is exactly one interval past its time (still due), one ms more and
  // it is missed; the 5 min mark 2 min past its time stays due either way
  const later = NOW - 1 + 25 * MINUTE;
  const slept = [
    ...list,
    { url: "https://short.example.com/", title: "Short", minutes: 5, nextReload: later - 2 * MINUTE },
  ];
  assert.deepEqual(
    dueKeepAlive(slept, later).map((entry) => entry.url),
    ["https://dash.example.com/board", "https://short.example.com/"],
    "exactly one interval overdue is still due; the 5 min mark 24 min past its time is missed",
  );
  assert.deepEqual(
    dueKeepAlive(slept, later + 1).map((entry) => entry.url),
    ["https://short.example.com/"],
  );
});

test("Keep alive - staggerKeepAlive re-times the overdue marks 30–60 s apart in list order; future and paused ones keep their time; undefined when none", () => {
  const overdue: KeepAliveTab[] = [
    { url: "https://a.example.com/", title: "A", minutes: 25, nextReload: NOW - 2 * 60 * MINUTE },
    { url: "https://b.example.com/", title: "B", minutes: 5, nextReload: NOW + MINUTE },
    { url: "https://c.example.com/", title: "C", minutes: 1, paused: true, nextReload: 0 },
    { url: "https://d.example.com/", title: "D", minutes: 5, nextReload: NOW },
  ];
  const next = staggerKeepAlive(overdue, NOW, () => 0.5);
  assert.ok(next);
  assert.deepEqual(
    next.map((entry) => entry.nextReload),
    [NOW + 45_000, NOW + MINUTE, 0, NOW + 90_000],
    "A first at now + 45 s, D 45 s after A; B (ahead) and C (paused) untouched",
  );
  assert.equal(next[1], overdue[1], "untouched entry keeps its identity");
  const spread = staggerKeepAlive(overdue, NOW, () => 1);
  assert.ok(spread);
  assert.deepEqual(
    [spread[0]?.nextReload, spread[3]?.nextReload],
    [NOW + 60_000, NOW + 120_000],
    "random 1 = 60 s gaps",
  );
  const tight = staggerKeepAlive(overdue, NOW, () => 0);
  assert.ok(tight);
  assert.deepEqual([tight[0]?.nextReload, tight[3]?.nextReload], [NOW + 30_000, NOW + 60_000], "random 0 = 30 s gaps");
  assert.equal(staggerKeepAlive(overdue, NOW - 3 * 60 * MINUTE), undefined, "nothing overdue: no write");
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

test("Keep alive - setKeepAliveReloadAll sets / drops the key; undefined when unchanged or unknown", () => {
  const all = setKeepAliveReloadAll(list, "https://mail.example.com/", true);
  assert.ok(all);
  assert.equal(all[1]?.reloadAll, true);
  assert.equal(all[0], list[0], "other entries untouched");
  const back = setKeepAliveReloadAll(all, "https://mail.example.com/", false);
  assert.ok(back);
  assert.ok(!("reloadAll" in (back[1] ?? {})), "default = key absent");
  assert.equal(setKeepAliveReloadAll(list, "https://mail.example.com/", false), undefined, "same value = no write");
  assert.equal(setKeepAliveReloadAll(list, "https://nope.example.com/", true), undefined, "unknown url = no write");
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

test("Keep alive - restoreKeepAliveRemoval: newest action back, re-armed from now, pages marked meanwhile skipped; undefined when nothing to restore", () => {
  const trash = recordRemoval(recordRemoval<KeepAliveTab>([], [list[0]!], NOW - MINUTE), [list[1]!, list[2]!], NOW);
  const restored = restoreKeepAliveRemoval([list[1]!], trash, NOW, () => 0.5);
  assert.ok(restored);
  assert.deepEqual(
    restored.keepAlive,
    [list[1], { ...list[2], nextReload: NOW + MINUTE }],
    "Mail already marked again: kept once; Paused back with its flag, timer from now",
  );
  assert.deepEqual(
    restored.keepAliveTrash,
    [{ at: NOW - MINUTE, items: [list[0]] }],
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

// ---------- marks as patterns (T-0155): the tagged-page vocabulary, one match rule ----------

test("Keep alive - matchesKeepAlive: a host mark covers the host and its subdomains, a trailing / everything under, * a glob", () => {
  assert.equal(matchesKeepAlive("example.com", "https://example.com/a"), true);
  assert.equal(matchesKeepAlive("example.com", "https://mail.example.com/inbox#x"), true, "subdomain");
  assert.equal(matchesKeepAlive("example.com", "https://notexample.com/"), false);
  assert.equal(matchesKeepAlive("https://a.test/", "https://a.test/docs/1"), true, "everything under");
  assert.equal(matchesKeepAlive("https://a.test/docs/*", "https://a.test/docs/2?x=1"), true, "glob");
  assert.equal(matchesKeepAlive("https://a.test/docs/*", "https://a.test/other"), false);
  assert.equal(matchesKeepAlive("example.com", "chrome://extensions/"), false, "only a reloadable page");
  assert.equal(matchesKeepAlive("", "https://example.com/"), false);
});

test("Keep alive - keepAliveUrlFromInput: a bare host or a pattern is a mark too; an address must stay http(s) / file", () => {
  assert.equal(keepAliveUrlFromInput(" Example.com "), "example.com");
  assert.equal(keepAliveUrlFromInput("*.example.com"), "*.example.com");
  assert.equal(keepAliveUrlFromInput("https://a.test/docs/*"), "https://a.test/docs/*");
  assert.equal(keepAliveUrlFromInput("a.test/docs/"), "https://a.test/docs/", "scheme-less path: https assumed");
  assert.equal(keepAliveUrlFromInput("chrome://a/*"), "", "unsupported scheme pattern");
  assert.equal(keepAliveUrlFromInput("*"), "", "everything is not a mark");
});

test("Keep alive - keepAliveTitle: an address mark is named by its tab (hostname until one is seen), a domain or glob mark by itself", () => {
  assert.equal(keepAliveTitle("https://dash.example.com/board", "Board"), "Board");
  assert.equal(
    keepAliveTitle("https://mail.example.com/", "Inbox"),
    "Inbox",
    "a site root from a tab is still one address",
  );
  assert.equal(keepAliveTitle("https://dash.example.com/board"), "dash.example.com");
  assert.equal(keepAliveTitle("https://dash.example.com/board", ""), "dash.example.com");
  assert.equal(keepAliveTitle("example.com", "Some tab"), "example.com");
  assert.equal(keepAliveTitle("https://a.test/docs/*", "Doc 2"), "https://a.test/docs/*");
});

test("Keep alive - rearmKeepAlive renames a page mark after its tab, never a domain or pattern mark", () => {
  const site: KeepAliveTab = { url: "example.com", title: "example.com", minutes: 5, nextReload: 1 };
  assert.equal(rearmKeepAlive([site], "example.com", NOW, "Inbox (3)")[0]?.title, "example.com");
  assert.equal(rearmKeepAlive([site], "example.com", NOW, "Inbox (3)")[0]?.nextReload, NOW, "re-armed all the same");
});

test("Keep alive - keepAliveOpenUrl: what the Alive view opens for a mark with no open tab — the page, the site's root, nothing for a glob", () => {
  assert.equal(keepAliveOpenUrl("https://dash.example.com/board#x"), "https://dash.example.com/board#x");
  assert.equal(keepAliveOpenUrl("example.com"), "https://example.com/");
  assert.equal(keepAliveOpenUrl("*.example.com"), "https://example.com/");
  assert.equal(keepAliveOpenUrl("https://a.test/docs/"), "https://a.test/docs/", "a prefix is an address");
  assert.equal(keepAliveOpenUrl("https://a.test/docs/*"), "");
  assert.equal(keepAliveOpenUrl("youtube"), "");
});

test("Keep alive - keepAliveKindLabel names a mark's kind the way the menu items do: URL (one address, a site root included), domain, pattern", () => {
  assert.equal(keepAliveKindLabel("https://dash.example.com/board#x"), "URL");
  assert.equal(keepAliveKindLabel("https://mail.example.com/"), "URL");
  assert.equal(keepAliveKindLabel("example.com"), "domain");
  assert.equal(keepAliveKindLabel("*.example.com"), "domain");
  assert.equal(keepAliveKindLabel("https://a.test/docs/*"), "pattern");
  assert.equal(keepAliveKindLabel("youtube"), "pattern");
});
