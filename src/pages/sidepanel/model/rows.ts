// Pure row-level view models: what one tab row shows (badges, highlights, favicon, dot),
// the bulk-selection summary and the empty-list message. No DOM, no chrome.*.
import { formatAge, isSupportedUrl } from "../../../app/core.ts";
import type { DerivedTabs, TabId } from "./derived.ts";
import { highlightRanges } from "./search.ts";
import type { HighlightRange } from "./search.ts";

type Tab = chrome.tabs.Tab;

export type Badge = [label: string, kind: string];

export interface RowContext {
  index: number;
  cursor: number;
  now: number;
  currentWindowId: number | null;
  derived: DerivedTabs;
  selected: ReadonlySet<TabId>;
  dotColors: Map<number, string>;
  indexes: Map<number, number>;
  queryTokens?: string[];
  fuzzy?: boolean;
}

export interface RowViewModel {
  classes: string[];
  viewTransitionName: string;
  checked: boolean;
  favicon: { pageUrl: string } | { letter: string }; // no _favicon/ for unsupported URLs — host initial instead
  title: string;
  titleRanges: HighlightRange[];
  host: string;
  hostRanges: HighlightRange[];
  age: string | null;
  badges: Badge[];
  canSnooze: boolean;
  protected: boolean;
  protectLabel: string;
  dot: { color: string | undefined; title: string } | null;
}

export interface BulkSummary {
  hidden: boolean;
  text: string;
  allChecked: boolean;
  indeterminate: boolean;
  selectAllTitle: string;
}

export function badges(tab: Pick<Tab, "discarded" | "pinned" | "audible">, isProtectedTab: boolean): Badge[] {
  const list: Badge[] = [];
  if (tab.discarded) {
    list.push(["snoozed", "warn"]);
  }
  if (isProtectedTab) {
    list.push(["protected", "ok"]);
  }
  if (tab.pinned) {
    list.push(["pinned", ""]);
  }
  if (tab.audible) {
    list.push(["🔊", ""]);
  }
  return list;
}

export function emptyMessage(query: string, filter: string): string {
  if (query) {
    return "No tabs match — press Esc to clear the search.";
  }
  if (filter === "snoozed") {
    return "Nothing snoozed yet. Hover a tab and use the pause button.";
  }
  if (filter === "protected") {
    return "No protected tabs. Use the shield button on a tab to protect its site.";
  }
  return "No open tabs.";
}

// everything renderRow needs to build the DOM, as plain data
export function rowViewModel(
  tab: Tab,
  {
    index,
    cursor,
    now,
    currentWindowId,
    derived,
    selected,
    dotColors,
    indexes,
    queryTokens = [],
    fuzzy = false,
  }: RowContext,
): RowViewModel {
  const d = derived.get(tab.id)!; // derived is built from the same tabs (deriveTabs, once per refresh)
  const title = (tab.discarded ? "⏸ " : "") + (tab.title || tab.url || "(untitled)");
  const host = d.host || tab.url || "";
  const titleRanges = highlightRanges(title, queryTokens, fuzzy);
  const hostRanges = highlightRanges(host, queryTokens, fuzzy);
  // searching but nothing to mark in the visible fields: the hit is inside the
  // raw URL — say so, otherwise the row looks like a false positive
  const urlOnlyMatch = queryTokens.length > 0 && titleRanges.length === 0 && hostRanges.length === 0;
  return {
    classes: [
      "row",
      index === cursor && "cursor",
      tab.discarded && "snoozed",
      tab.active && "active-tab",
      tab.active && tab.windowId === currentWindowId && "current",
    ].filter((name): name is string => Boolean(name)),
    viewTransitionName: `tab-${tab.id}`,
    checked: selected.has(tab.id),
    favicon: tab.url && isSupportedUrl(tab.url) ? { pageUrl: tab.url } : { letter: (d.host[0] ?? "•").toUpperCase() },
    title,
    titleRanges,
    host,
    hostRanges,
    age: !tab.active && tab.lastAccessed ? formatAge(now - tab.lastAccessed) : null,
    badges: [...badges(tab, d.protected), ...(urlOnlyMatch ? [["url match", ""] satisfies Badge] : [])],
    canSnooze: !tab.discarded && isSupportedUrl(tab.url),
    protected: d.protected,
    protectLabel: d.protected ? "Unprotect site" : "Protect site",
    dot:
      dotColors.size > 0
        ? {
            color: dotColors.get(tab.windowId),
            title: tab.windowId === currentWindowId ? "Current window" : `Window #${indexes.get(tab.windowId)}`,
          }
        : null,
  };
}

export function bulkSummary(visible: Tab[], selected: ReadonlySet<TabId>): BulkSummary {
  const selectedVisible = visible.filter((tab) => selected.has(tab.id)).length;
  const allChecked = visible.length > 0 && selectedVisible === visible.length;
  return {
    hidden: selected.size === 0,
    text: `${selected.size} selected`,
    allChecked,
    indeterminate: selectedVisible > 0 && !allChecked,
    selectAllTitle: allChecked ? "Unselect all" : `Select all ${visible.length} shown`,
  };
}
