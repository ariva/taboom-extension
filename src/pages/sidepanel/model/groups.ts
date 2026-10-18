// Pure list grouping: consecutive same-key runs, the title / domain / url / tag group names
// and Chrome's tab-group color table. No DOM, no chrome.*.
import { TAG_COLORS } from "../../../app/tags.ts";
import type { Tag } from "../../../app/types.ts";

type Tab = chrome.tabs.Tab;

// ordered [key, tabs[]] pair — see groupTabs
export type TabRun<K, T extends Tab = Tab> = [key: K, tabs: T[]];

// Chrome's 9 fixed tab-group colors (chrome.tabGroups.Color → hex) — one table with tags
export const TAB_GROUP_COLORS = TAG_COLORS;

// hex of a tab-group color; undefined for none / one this table lacks (a vanished
// group, a color newer than the table) — callers supply the fallback
export function tabGroupColor(color: string | undefined): string | undefined {
  const table: Record<string, string | undefined> = TAB_GROUP_COLORS;
  return color === undefined ? undefined : table[color];
}

export function titleGroupName(title: string): string {
  return title || "(untitled)";
}

export function domainGroupName(host: string): string {
  return host || "(no domain)";
}

export function urlGroupName(url: string): string {
  return url || "(no url)";
}

// group-tag header: the first tag's name; the untagged bucket
export function tagGroupName(tag: Tag | undefined): string {
  return tag ? tag.name : "No tag";
}

// Generic grouping: consecutive same-key runs → ordered [key, tabs[]] pairs.
// The list must already be sorted by the key (the group-* sorts guarantee it).
export function groupTabs<K, T extends Tab>(tabs: T[], key: (tab: T) => K): TabRun<K, T>[] {
  const groups: TabRun<K, T>[] = [];
  for (const tab of tabs) {
    const last = groups[groups.length - 1];
    if (last && last[0] === key(tab)) {
      last[1].push(tab);
    } else {
      groups.push([key(tab), [tab]]);
    }
  }
  return groups;
}
