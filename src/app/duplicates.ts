// Duplicate tabs as pure functions: which open tabs are the same page, which copy a
// cleanup keeps and which ones it closes. No DOM, no chrome.* — the side panel's
// Duplicates view (windows-popover/duplicates.ts) is the only caller today.
import { isKeptAlive } from "./core.ts";
import type { KeepAliveTab } from "./types.ts";

// the slice of chrome.tabs.Tab the rules read; tests build these by hand
export interface DuplicateTab {
  id: number;
  windowId: number;
  url?: string;
  title?: string;
  pinned?: boolean;
  active?: boolean;
  discarded?: boolean;
  lastAccessed?: number;
}

export interface DuplicateSet<T extends DuplicateTab> {
  key: string;
  title: string;
  url: string; // "" for the New Tab set — there is no one address to show
  tabs: T[]; // in the order given (tabs.query order: window, then index)
  windowIds: number[];
}

export interface KeeperContext {
  currentWindowId: number | null;
  keepAlive: KeepAliveTab[];
}

// "one": a single survivor across every window; "per-window": one survivor in each window
export type CleanupMode = "one" | "per-window";

// Chrome spells its blank page several ways; a blank page is clutter per window, not
// per browser, so the set keeps one in every window whatever the mode
export const NEW_TAB_KEY = "newtab";
const NEW_TAB_URLS = new Set([
  "chrome://newtab",
  "chrome://new-tab-page",
  "chrome://new-tab-page-third-party",
  "about:blank",
]);

// same page = same address without the fragment, query kept (like keep-alive marks)
export function duplicateKey(url: string | undefined): string {
  if (!url) {
    return "";
  }
  const bare = url.split("#")[0] ?? "";
  return NEW_TAB_URLS.has(bare.replace(/\/$/, "")) ? NEW_TAB_KEY : bare;
}

export function duplicateSets<T extends DuplicateTab>(tabs: readonly T[]): DuplicateSet<T>[] {
  const byKey = new Map<string, T[]>();
  for (const tab of tabs) {
    const key = duplicateKey(tab.url);
    if (key === "") {
      continue;
    }
    byKey.set(key, [...(byKey.get(key) ?? []), tab]);
  }
  const sets: DuplicateSet<T>[] = [];
  for (const [key, copies] of byKey) {
    if (copies.length < 2) {
      continue;
    }
    const isNewTab = key === NEW_TAB_KEY;
    sets.push({
      key,
      title: isNewTab ? "New Tab" : copies.find((tab) => tab.title)?.title || key,
      url: isNewTab ? "" : key,
      tabs: copies,
      windowIds: [...new Set(copies.map((tab) => tab.windowId))],
    });
  }
  return sets;
}

// The copy worth keeping comes first: the user's pinned one, a kept-alive page, the tab
// in front of them, the active tab of its window, an awake one over a snoozed one, then
// the most recently used; ties keep the given order. Same spirit as keep-alive targets.
export function rankKeepers<T extends DuplicateTab>(tabs: readonly T[], context: KeeperContext): T[] {
  const score = (tab: T): number =>
    (tab.pinned ? 32 : 0) +
    (isKeptAlive(context.keepAlive, tab.url) ? 16 : 0) +
    (tab.active && tab.windowId === context.currentWindowId ? 8 : 0) +
    (tab.active ? 4 : 0) +
    (tab.discarded ? 0 : 2);
  return tabs
    .map((tab, index) => ({ tab, index, score: score(tab) }))
    .sort((a, b) => b.score - a.score || (b.tab.lastAccessed ?? 0) - (a.tab.lastAccessed ?? 0) || a.index - b.index)
    .map((entry) => entry.tab);
}

// the tabs a cleanup closes, in the set's order. A pinned copy is never closed: the user
// pinned it on purpose, two pinned copies both stay
export function duplicatesToClose<T extends DuplicateTab>(
  set: DuplicateSet<T>,
  mode: CleanupMode,
  context: KeeperContext,
): T[] {
  const perWindow = mode === "per-window" || set.key === NEW_TAB_KEY;
  const groups = perWindow
    ? set.windowIds.map((windowId) => set.tabs.filter((tab) => tab.windowId === windowId))
    : [set.tabs];
  const closing = new Set<T>();
  for (const group of groups) {
    for (const tab of rankKeepers(group, context).slice(1)) {
      if (!tab.pinned) {
        closing.add(tab);
      }
    }
  }
  return set.tabs.filter((tab) => closing.has(tab));
}

// windows that would close with these tabs — their last tab goes with them
export function closingWindows(allTabs: readonly DuplicateTab[], closingIds: readonly number[]): number[] {
  const closing = new Set(closingIds);
  const survivors = new Set(allTabs.filter((tab) => !closing.has(tab.id)).map((tab) => tab.windowId));
  return [...new Set(allTabs.map((tab) => tab.windowId))].filter((windowId) => !survivors.has(windowId));
}
