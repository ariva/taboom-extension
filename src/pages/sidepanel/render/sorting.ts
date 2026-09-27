// Grouped sorts and sort direction as the panel applies them: the grouping registry,
// the direction a sort starts in, the direction button, and the collapse set in effect.
import { sortDirBtn } from "../foundation/elements.ts";
import { domainGroupName, titleGroupName, urlGroupName, windowGroupName } from "../model/index.ts";
import type { SortDir, TabRun, WindowMaps } from "../model/index.ts";
import { canonicalDir, DIR_TITLES, SORT_DIRECTIONS } from "../model/sort-direction.ts";
import { activeCollapsedSet, effectiveSort, state } from "../foundation/state.ts";
import type { GroupKey, PanelTab } from "../foundation/state.ts";

type Tab = chrome.tabs.Tab;

// Grouping registry: a grouped sort = a key function + a header-label builder.
// Add future groupings (domain, ...) here — collapse, fold-all, and the
// group-select checkbox come for free.
// `name` is a method signature on purpose: method parameters are bivariant, so
// each grouping declares the key type its own `key` produces (numeric ids /
// string titles) instead of casting the GroupKey union back
export interface Grouping {
  noun: string;
  key: (tab: Tab) => GroupKey;
  name(key: GroupKey, maps: WindowMaps): string;
}

// ordered [key, tabs[]] pair of one rendered group — the model's TabRun over PanelTabs
export type PanelRun = TabRun<GroupKey, PanelTab>;

export const GROUPINGS: Record<string, Grouping> = {
  window: {
    noun: "window",
    key: (tab) => tab.windowId,
    name: (windowId: number, maps: WindowMaps) =>
      windowGroupName(windowId, {
        currentWindowId: state.currentWindowId,
        indexes: maps.indexes,
        names: maps.names,
      }),
  },
  "group-tabgroup": {
    noun: "group",
    key: (tab) => tab.groupId ?? -1,
    name: (groupId: number) => (groupId === -1 ? "No group" : state.tabGroups.get(groupId)?.title || "(unnamed group)"),
  },
  "group-title": {
    key: (tab) => tab.title ?? "",
    name: (title: string) => titleGroupName(title),
    noun: "group",
  },
  "group-domain": {
    key: (tab) => state.derived.get(tab.id)?.host ?? "",
    name: (host: string) => domainGroupName(host),
    noun: "group",
  },
  "group-url": {
    key: (tab) => tab.url ?? "",
    name: (url: string) => urlGroupName(url),
    noun: "group",
  },
};

// initial direction when a sort becomes active: canonical, unless the user
// opted into per-sort memory ("Sort memory: Remember previous" in options)
export function initialDirFor(sort: string): SortDir {
  if ((state.ui.sortDirMode ?? "default") === "remember") {
    // stored by persistUiPrefs from state.sortDir — a SortDir
    return (state.ui.sortDirections?.[sort] as SortDir | undefined) ?? canonicalDir(sort);
  }
  return canonicalDir(sort);
}

// same shape as renderCollapseAllButton: one function owns the whole button,
// called only from render(). Hidden when a grouped sort has a lone group —
// same rule as the fold-all toggle.
export function renderSortDirButton(grouping: Grouping | undefined, anythingToFold: boolean): void {
  sortDirBtn.hidden = Boolean(grouping) && !anythingToFold;
  if (sortDirBtn.hidden) {
    return;
  }
  const meta = SORT_DIRECTIONS[effectiveSort()] ?? { states: ["asc"] };
  const dir = meta.inverse ? meta.states[0] : state.sortDir;
  sortDirBtn.dataset.dir = dir;
  sortDirBtn.title = sortDirBtn.ariaLabel = DIR_TITLES[dir];
}

export function effectiveCollapsed(): Set<GroupKey> {
  return GROUPINGS[effectiveSort()] ? activeCollapsedSet() : new Set();
}
