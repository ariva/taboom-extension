// Pure list grouping: consecutive same-key runs, the title / domain / url group names
// and Chrome's tab-group color table. No DOM, no chrome.*.

type Tab = chrome.tabs.Tab;

// ordered [key, tabs[]] pair — see groupTabs
export type TabRun<K, T extends Tab = Tab> = [key: K, tabs: T[]];

// Chrome's 9 fixed tab-group colors (chrome.tabGroups.Color → hex)
export const TAB_GROUP_COLORS = {
  grey: "#5f6368",
  blue: "#1a73e8",
  red: "#d93025",
  yellow: "#f9ab00",
  green: "#188038",
  pink: "#d01884",
  purple: "#a142f4",
  cyan: "#007b83",
  orange: "#fa903e",
};

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
