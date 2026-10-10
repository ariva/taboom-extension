// Keep-it-alive marks as pure functions: the key a page is matched by, the
// list edits, and the reload schedule. No DOM, no chrome.* — the worker, the
// options page and the side panel all go through here.
import { isKeptAlive, keepAliveKey } from "./core.ts";
import type { KeepAliveTab } from "./types.ts";

// the matching half lives in core.ts (auto-snooze eligibility reads it); re-exported
// so every keep-alive caller imports from one place
export { isKeptAlive, keepAliveKey };

// the "Default value" dropdown choices (minutes); DEFAULTS.settings.keepAliveMinutes is one of them
export const KEEP_ALIVE_MINUTES = [1, 5, 10, 15, 20, 25, 30, 45, 60, 90] as const;

const JITTER_MS = 55_000;
// chrome.alarms refuses anything closer than 30 s (MV3, Chrome 120+); the
// 1-minute interval minus the jitter would land under that
const MIN_GAP_MS = 30_000;

// the mark behind a url, fragment ignored — undefined when the page is not marked
export function keepAliveEntry(list: KeepAliveTab[], url: string | undefined): KeepAliveTab | undefined {
  const key = keepAliveKey(url);
  return key === "" ? undefined : list.find((entry) => entry.url === key);
}

// interval ± 55 s, uniformly random per fire; `random` injectable for tests
export function nextReloadAt(minutes: number, now: number, random: () => number = Math.random): number {
  const gap = minutes * 60_000 + (random() * 2 - 1) * JITTER_MS;
  return now + Math.max(MIN_GAP_MS, Math.round(gap));
}

// undefined when every page was already marked (or unsupported) — callers skip the write.
// `minutes` is the default at mark time: later default changes leave existing marks alone
export function markKeepAlive(
  list: KeepAliveTab[],
  tabs: { url?: string; title?: string }[],
  minutes: number,
  nextReload: number,
): KeepAliveTab[] | undefined {
  const known = new Set(list.map((entry) => entry.url));
  const added: KeepAliveTab[] = [];
  for (const tab of tabs) {
    const url = keepAliveKey(tab.url);
    if (url === "" || known.has(url)) {
      continue;
    }
    known.add(url);
    added.push({ url, title: tab.title || url, minutes, nextReload });
  }
  return added.length > 0 ? [...list, ...added] : undefined;
}

export function unmarkKeepAlive(list: KeepAliveTab[], urls: (string | undefined)[]): KeepAliveTab[] | undefined {
  const keys = new Set(urls.map(keepAliveKey));
  const next = list.filter((entry) => !keys.has(entry.url));
  return next.length === list.length ? undefined : next;
}

export function dueKeepAlive(list: KeepAliveTab[], now: number): KeepAliveTab[] {
  return list.filter((entry) => !entry.paused && entry.nextReload <= now);
}

export function rearmKeepAlive(list: KeepAliveTab[], url: string, nextReload: number): KeepAliveTab[] {
  return list.map((entry) => (entry.url === url ? { ...entry, nextReload } : entry));
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
