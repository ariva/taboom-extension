// Keep-it-alive marks as pure functions: the key a page is matched by, the
// list edits, and the reload schedule. No DOM, no chrome.* — the worker, the
// options page and the side panel all go through here.
import { hostnameOf, isSupportedUrl } from "./core.ts";
import { popRemoval } from "./removal-trash.ts";
import { matchesTagPageKey, pageKeyOf, tagPagePatternFromInput, tagPatternKind } from "./tag-patterns.ts";
import type { KeepAliveRemoval, KeepAliveTab } from "./types.ts";

// A mark follows the page, not the tab: one made from a tab drops the fragment so in-page
// navigation (#section) keeps matching; unsupported urls key to "" and never match
export function keepAliveKey(url: string | undefined): string {
  if (!isSupportedUrl(url)) {
    return "";
  }
  return (url ?? "").split("#")[0] ?? "";
}

// A mark's url is a pattern with the tagged-page vocabulary (tag-patterns.ts): an address (with
// a # exact — /#/dashboard is not /#/mail —, without one covering every fragment; ending in /
// everything under it), a host and its subdomains, or a * glob. The one rule for "is this tab
// the mark's page": every caller compares through here. A reload needs a reloadable page, so an
// unsupported url never matches whatever the pattern
export function matchesKeepAlive(markUrl: string, url: string | undefined): boolean {
  return isSupportedUrl(url) && matchesTagPageKey(markUrl, pageKeyOf(url));
}

export function isKeptAlive(list: KeepAliveTab[], url: string | undefined): boolean {
  return list.some((entry) => matchesKeepAlive(entry.url, url));
}

// the "Default value" dropdown choices (minutes); DEFAULTS.settings.keepAliveMinutes is one of them
export const KEEP_ALIVE_MINUTES = [1, 5, 10, 15, 20, 25, 30, 45, 60, 90] as const;

const JITTER_MS = 55_000;
// chrome.alarms refuses anything closer than 30 s (MV3, Chrome 120+); the
// 1-minute interval minus the jitter would land under that
const MIN_GAP_MS = 30_000;

// the mark behind a url — undefined when the page is not marked
export function keepAliveEntry(list: KeepAliveTab[], url: string | undefined): KeepAliveTab | undefined {
  return list.find((entry) => matchesKeepAlive(entry.url, url));
}

// a typed mark (options Add row, the address edit): the tagged-page normalizer (an address
// through URL() like a tab url, https assumed for a scheme-less path, a bare host as a site, a
// glob with its scheme and host lowered; the fragment stays — typing one means that exact
// address) — then an address must be a reloadable one: http, https or file. "" otherwise
export function keepAliveUrlFromInput(text: string): string {
  const pattern = tagPagePatternFromInput(text);
  return SCHEME.test(pattern) && !isSupportedUrl(pattern) ? "" : pattern;
}

const SCHEME = /^[a-z][a-z0-9+.-]*:/i;

// a mark's name: an address mark (one page, or everything under a path — marks made from a tab
// on a site's root end in /) is named by its tab, the hostname until one is seen (Add row); a
// domain, word or glob mark by the pattern itself (no single tab stands for it)
export function keepAliveTitle(markUrl: string, tabTitle?: string): string {
  return isAddressMark(markUrl) ? tabTitle || hostnameOf(markUrl) : markUrl;
}

// one address, no glob — the kinds a tab's title and address can stand for
function isAddressMark(markUrl: string): boolean {
  return SCHEME.test(markUrl) && !markUrl.includes("*");
}

// how the menus name a mark's kind — the words of the add items (Keep alive URL / domain):
// one address is a URL (a site root from a tab too), a host a domain, a glob or a word a pattern
export function keepAliveKindLabel(markUrl: string): "URL" | "domain" | "pattern" {
  if (isAddressMark(markUrl)) {
    return "URL";
  }
  return tagPatternKind(markUrl) === "domain" ? "domain" : "pattern";
}

// what opens for a mark with no open tab (Alive view): the page itself, a site's root, nothing
// for a glob or a word — no one address stands for those
export function keepAliveOpenUrl(markUrl: string): string {
  if (isAddressMark(markUrl)) {
    return markUrl;
  }
  return tagPatternKind(markUrl) === "domain" ? `https://${markUrl.replace(/^\*\./, "")}/` : "";
}

// interval ± 55 s, uniformly random per fire; `random` injectable for tests
export function nextReloadAt(minutes: number, now: number, random: () => number = Math.random): number {
  const gap = minutes * 60_000 + (random() * 2 - 1) * JITTER_MS;
  return now + Math.max(MIN_GAP_MS, Math.round(gap));
}

// `pages` carry mark urls already (keepAliveKey for a tab, keepAliveUrlFromInput for a
// typed one; "" = unsupported, skipped). undefined when every page was already marked —
// callers skip the write. `minutes` is the default at mark time: later default changes
// leave existing marks alone
export function markKeepAlive(
  list: KeepAliveTab[],
  pages: { url: string; title?: string }[],
  minutes: number,
  nextReload: number,
): KeepAliveTab[] | undefined {
  const known = new Set(list.map((entry) => entry.url));
  const added: KeepAliveTab[] = [];
  for (const { url, title } of pages) {
    if (url === "" || known.has(url)) {
      continue;
    }
    known.add(url);
    added.push({ url, title: keepAliveTitle(url, title), minutes, nextReload });
  }
  return added.length > 0 ? [...list, ...added] : undefined;
}

// a mark's own url (options Remove, Alive view) drops that mark alone; a tab url with no
// mark spelled exactly like it drops the mark covering it (the fragment-free one)
export function unmarkKeepAlive(list: KeepAliveTab[], urls: (string | undefined)[]): KeepAliveTab[] | undefined {
  const dropped = new Set<KeepAliveTab>();
  for (const url of urls) {
    const exact = list.filter((entry) => entry.url === url);
    for (const entry of exact.length > 0 ? exact : list.filter((entry) => matchesKeepAlive(entry.url, url))) {
      dropped.add(entry);
    }
  }
  return dropped.size === 0 ? undefined : list.filter((entry) => !dropped.has(entry));
}

// The tabs a due mark reloads. One per mark by default — a page open twice shares one
// session, and reloading both doubles the traffic and the "Leave site?" prompts: the
// pinned one (the user's "keep this" tab), else the first in tabs.query order (window
// order, then tab index). A mark set to reloadAll (its Tabs dropdown) hits every match.
export function keepAliveTargets<T extends { id?: number; pinned?: boolean; url?: string }>(
  tabs: T[],
  markUrl: string,
  reloadAll: boolean,
): T[] {
  const matches = tabs.filter((tab) => tab.id !== undefined && matchesKeepAlive(markUrl, tab.url));
  if (reloadAll) {
    return matches;
  }
  const first = matches.find((tab) => tab.pinned) ?? matches[0];
  return first ? [first] : [];
}

// A running mark more than one of its own intervals past its time was not skipped by the
// 30 s sweep but by the machine: lid closed, or Chrome not running. Those are not due — the
// sweep hands them to staggerKeepAlive instead of reloading them all at once. A mark inside
// its interval (a quick restart included) still reloads on time: a session timeout does not wait.
export function dueKeepAlive(list: KeepAliveTab[], now: number): KeepAliveTab[] {
  return list.filter(
    (entry) => !entry.paused && entry.nextReload <= now && now - entry.nextReload <= entry.minutes * 60_000,
  );
}

const STAGGER_MS = 30_000;

// Every running mark whose time has passed is re-timed 30–60 s after the previous one, in list
// order, the first 30–60 s from `now`: after a browser start or a long sleep the kept pages
// catch up one at a time instead of in one burst (the network may still be coming up, and five
// "Leave site?" prompts at once help nobody). Marks still ahead of `now` and paused ones keep
// their time. undefined when nothing was overdue — callers skip the write.
export function staggerKeepAlive(
  list: KeepAliveTab[],
  now: number,
  random: () => number = Math.random,
): KeepAliveTab[] | undefined {
  let at = now;
  let changed = false;
  const next = list.map((entry) => {
    if (entry.paused || entry.nextReload > now) {
      return entry;
    }
    at += STAGGER_MS + Math.round(random() * STAGGER_MS);
    changed = true;
    return { ...entry, nextReload: at };
  });
  return changed ? next : undefined;
}

// the sweep passes the reloaded tab's title: a page mark named at mark time (or by hostname
// from the Add row) catches up with the page within one interval; "" / absent keeps it. A
// domain or pattern mark keeps its own name — the reloaded tab is one of many
export function rearmKeepAlive(list: KeepAliveTab[], url: string, nextReload: number, title?: string): KeepAliveTab[] {
  return list.map((entry) =>
    entry.url === url ? { ...entry, nextReload, title: keepAliveTitle(url, title || entry.title) } : entry,
  );
}

// per-mark interval; the schedule restarts so the countdown matches the new value at once
export function setKeepAliveMinutes(
  list: KeepAliveTab[],
  url: string,
  minutes: number,
  nextReload: number,
): KeepAliveTab[] | undefined {
  const entry = list.find((candidate) => candidate.url === url);
  if (!entry || entry.minutes === minutes) {
    return undefined;
  }
  return list.map((candidate) => (candidate === entry ? { ...entry, minutes, nextReload } : candidate));
}

// the row's Tabs dropdown; the key is absent for the default so stored marks stay minimal
export function setKeepAliveReloadAll(
  list: KeepAliveTab[],
  url: string,
  reloadAll: boolean,
): KeepAliveTab[] | undefined {
  const entry = list.find((candidate) => candidate.url === url);
  if (!entry || (entry.reloadAll ?? false) === reloadAll) {
    return undefined;
  }
  const { reloadAll: _previous, ...one } = entry;
  const next = reloadAll ? { ...entry, reloadAll: true } : one;
  return list.map((candidate) => (candidate === entry ? next : candidate));
}

// options url edit (click the address): the mark is re-keyed, title / interval / timer
// stay. undefined when the mark is unknown, nothing valid was typed, the url is the
// same, or another mark already has it (two marks on one key would shadow each other)
export function setKeepAliveUrl(list: KeepAliveTab[], url: string, nextUrl: string): KeepAliveTab[] | undefined {
  const entry = list.find((candidate) => candidate.url === url);
  if (!entry || nextUrl === "" || nextUrl === url || list.some((candidate) => candidate.url === nextUrl)) {
    return undefined;
  }
  // a placeholder title (the hostname from the Add row, a pattern's own name) follows the new
  // address; a real page title stays until the sweep sees the page and refreshes it
  const title = entry.title === keepAliveTitle(url) ? keepAliveTitle(nextUrl) : keepAliveTitle(nextUrl, entry.title);
  return list.map((candidate) => (candidate === entry ? { ...entry, url: nextUrl, title } : candidate));
}

// every mark restarts from now at its own interval — on re-enable, else every due
// time that passed while the feature was off would reload all pages at once
export function rearmAllKeepAlive(list: KeepAliveTab[], now: number, random?: () => number): KeepAliveTab[] {
  return list.map((entry) => ({ ...entry, nextReload: nextReloadAt(entry.minutes, now, random) }));
}

// pause keeps the mark (menu, Alive view, snooze exclusion) but stops the reloads;
// both directions restart the schedule from now (a toggle is a fresh start)
export function setKeepAlivePaused(
  list: KeepAliveTab[],
  url: string,
  paused: boolean,
  nextReload: number,
): KeepAliveTab[] | undefined {
  const entry = list.find((candidate) => candidate.url === url);
  if (!entry || (entry.paused ?? false) === paused) {
    return undefined;
  }
  const { paused: _previous, ...running } = entry;
  const next = paused ? { ...entry, paused: true, nextReload } : { ...running, nextReload };
  return list.map((candidate) => (candidate === entry ? next : candidate));
}

// "m:ss" left until the reload (seconds rounded up), "now" once due — the sweep picks it up within 30 s
export function formatCountdown(nextReload: number, now: number): string {
  const seconds = Math.ceil((nextReload - now) / 1000);
  if (seconds <= 0) {
    return "now";
  }
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

// ---------- removal trash (src/app/removal-trash.ts holds the stack) ----------

// the newest action back into the list: a page marked again meanwhile keeps its current mark,
// the others return as they were (paused flag included) with a fresh timer so a restore after
// days does not reload them all at once. undefined when the trash is empty.
export function restoreKeepAliveRemoval(
  list: KeepAliveTab[],
  trash: KeepAliveRemoval[],
  now: number,
  random?: () => number,
): { keepAlive: KeepAliveTab[]; keepAliveTrash: KeepAliveRemoval[] } | undefined {
  const popped = popRemoval(trash);
  if (!popped) {
    return undefined;
  }
  const known = new Set(list.map((entry) => entry.url));
  const returning = popped.newest.items
    .filter((entry) => !known.has(entry.url))
    .map((entry) => ({ ...entry, nextReload: nextReloadAt(entry.minutes, now, random) }));
  return { keepAlive: [...list, ...returning], keepAliveTrash: popped.rest };
}
