// Pure filter + sort selection: the filter / scope / sort value types, selectVisible
// with its grouped and per-window orderings, and the filter-chip counts. No DOM, no chrome.*.
import type { UiPrefs } from "../../../app/types.ts";
import type { DerivedTabs } from "./derived.ts";
import { fuzzyActive, searchCandidates } from "./search.ts";
import type { SearchView } from "./search.ts";
import { windowGroupName, windowMaps } from "./windows.ts";
import type { WindowMetaMap } from "./windows.ts";

type Tab = chrome.tabs.Tab;

// allowed values of the filter buttons / scope + sort selects / direction button.
// The view fields below stay `string`: they arrive unvalidated from the DOM and
// storage (see UiPrefs), and unknown values simply fall through the switches.
export type FilterName = "all" | "awake" | "snoozed" | "protected";
export type ScopeName = "all-windows" | "current-window";
export type SortName =
  | "recent"
  | "oldest"
  | "title"
  | "domain"
  | "group-title"
  | "group-domain"
  | "group-url"
  | "group-tabgroup"
  | "window";
export type SortDir = "asc" | "desc" | "none";

export interface SelectView extends SearchView {
  ui?: Partial<Pick<UiPrefs, "experimental_fuzzySearch" | "groupByWindowTabsOrder">>;
  filter: string; // FilterName
  sort: string; // SortName
  now: number;
  sortDir?: string; // SortDir
  tabGroups?: Map<number, chrome.tabGroups.TabGroup>;
  windowMeta?: WindowMetaMap | null;
}

// filter + sort the full tab list down to what the panel shows.
// sortDir: flat sorts take "asc"|"desc"; grouped sorts take "none" (natural
// order) | "desc" (most visible tabs first) | "asc" (fewest first). Group
// direction reorders GROUPS only — within-group order is always recency.
// recent/oldest carry their direction in their identity and ignore sortDir.
export function selectVisible<T extends Tab>(tabs: T[], view: SelectView): T[] {
  const { filter, sort, currentWindowId, derived, now, sortDir } = view;
  const s = sortDir === "desc" ? -1 : 1;
  let result = searchCandidates(tabs, view);
  // derived.get()! below: derived is built from these same tabs (deriveTabs, once per refresh)
  switch (filter) {
    case "awake":
      result = result.filter((tab) => !tab.discarded);
      break;
    case "snoozed":
      result = result.filter((tab) => tab.discarded);
      break;
    case "protected":
      result = result.filter((tab) => derived.get(tab.id)!.protected);
      break;
  }
  const last = (tab: Tab): number => tab.lastAccessed ?? now;
  if (fuzzyActive(view)) {
    return result; // fuzzy relevance order beats the active sort while typing
  }
  switch (sort) {
    case "recent":
      result.sort((a, b) => last(b) - last(a));
      break;
    case "oldest":
      result.sort((a, b) => last(a) - last(b));
      break;
    case "title":
      result.sort((a, b) => s * (a.title ?? "").localeCompare(b.title ?? ""));
      break;
    case "domain":
      result.sort((a, b) => s * derived.get(a.id)!.host.localeCompare(derived.get(b.id)!.host));
      break;
    // key-grouped sorts (title/domain): "none" = groups alphabetical;
    // "desc"/"asc" = by visible group size (ties alphabetical);
    // recent-first within a group
    case "group-title":
      sortGroupedByKey(result, (tab) => tab.title ?? "", sortDir, last);
      break;
    case "group-domain":
      sortGroupedByKey(result, (tab) => derived.get(tab.id)!.host, sortDir, last);
      break;
    case "group-url":
      sortGroupedByKey(result, (tab) => tab.url ?? "", sortDir, last);
      break;
    // Chrome tab groups: groups ABC by title, ungrouped bucket last; the
    // gid suffix keeps same-titled groups apart. Inside a group rows follow
    // STRIP order (a group is a strip structure — moves must mirror it);
    // the ungrouped bucket spans windows, so recency is more useful there.
    case "group-tabgroup": {
      const keyOf = (tab: Tab): string => {
        const gid = tab.groupId ?? -1;
        if (gid === -1) {
          return "\uffff"; // sorts after every real title
        }
        const title = view.tabGroups?.get(gid)?.title || "untitled";
        return `${title.toLocaleLowerCase()}\u0000${gid}`;
      };
      const sizes = new Map<string, number>();
      for (const tab of result) {
        sizes.set(keyOf(tab), (sizes.get(keyOf(tab)) ?? 0) + 1);
      }
      const bySize = sortDir === "desc" ? -1 : sortDir === "asc" ? 1 : 0;
      result.sort(
        (a, b) =>
          // sizes.get()!: every key of result was counted above
          bySize * (sizes.get(keyOf(a))! - sizes.get(keyOf(b))!) ||
          keyOf(a).localeCompare(keyOf(b)) ||
          ((a.groupId ?? -1) !== -1 ? (a.index ?? 0) - (b.index ?? 0) : last(b) - last(a)),
      );
      break;
    }
    // "none" = current window first then windows by id (natural 1..x);
    // "desc"/"asc" = windows by visible tab count (natural order as tiebreak);
    // within a window: ui.groupByWindowTabsOrder — same-as-window (default, tab strip position) | recent
    // (last used) | title-asc | title-desc
    case "window": {
      // Two independent lists: pinned windows always above unpinned (current
      // window above both). Within each band the same internal ordering:
      // size (when the direction button says so), then display name (numeric-
      // aware, so Window #2 < Window #10) — matching the windows popover.
      const meta = view.windowMeta;
      const maps = windowMaps(tabs, currentWindowId, meta ?? null);
      const labelOf = (windowId: number): string =>
        windowGroupName(windowId, { currentWindowId, indexes: maps.indexes, names: maps.names });
      const band = (tab: Tab): number =>
        tab.windowId === currentWindowId ? 0 : meta?.get(tab.windowId)?.pinnedWindow ? 1 : 2;
      const sizes = new Map<number, number>();
      for (const tab of result) {
        sizes.set(tab.windowId, (sizes.get(tab.windowId) ?? 0) + 1);
      }
      const bySize = sortDir === "desc" ? -1 : sortDir === "asc" ? 1 : 0;
      const within = windowTabComparator(view.ui?.groupByWindowTabsOrder, last);
      result.sort(
        (a, b) =>
          band(a) - band(b) ||
          // sizes.get()!: every windowId of result was counted above
          bySize * (sizes.get(a.windowId)! - sizes.get(b.windowId)!) ||
          labelOf(a.windowId).localeCompare(labelOf(b.windowId), undefined, { numeric: true, sensitivity: "base" }) ||
          within(a, b),
      );
      break;
    }
  }
  return result;
}

// within-window tab order for the window grouping (ui.groupByWindowTabsOrder)
function windowTabComparator(
  order: UiPrefs["groupByWindowTabsOrder"] | undefined,
  last: (tab: Tab) => number,
): (a: Tab, b: Tab) => number {
  switch (order) {
    case "same-as-window":
      return (a, b) => (a.index ?? 0) - (b.index ?? 0); // tab strip position
    case "title-asc":
      return (a, b) => (a.title ?? "").localeCompare(b.title ?? "");
    case "title-desc":
      return (a, b) => (b.title ?? "").localeCompare(a.title ?? "");
    default:
      return (a, b) => last(b) - last(a); // recently used
  }
}

// shared ordering for key-grouped sorts — see the group-* cases above
function sortGroupedByKey(
  result: Tab[],
  keyOf: (tab: Tab) => string,
  sortDir: string | undefined,
  last: (tab: Tab) => number,
): void {
  const sizes = new Map<string, number>();
  for (const tab of result) {
    const key = keyOf(tab);
    sizes.set(key, (sizes.get(key) ?? 0) + 1);
  }
  const bySize = sortDir === "desc" ? -1 : sortDir === "asc" ? 1 : 0;
  result.sort(
    (a, b) =>
      // sizes.get()!: every key of result was counted above
      bySize * (sizes.get(keyOf(a))! - sizes.get(keyOf(b))!) || keyOf(a).localeCompare(keyOf(b)) || last(b) - last(a),
  );
}

export function countsByFilter(tabs: Tab[], derived: DerivedTabs): Record<FilterName, number> {
  const counts: Record<FilterName, number> = { all: tabs.length, awake: 0, snoozed: 0, protected: 0 };
  for (const tab of tabs) {
    if (tab.discarded) {
      counts.snoozed++;
    } else {
      counts.awake++;
    }
    if (derived.get(tab.id)!.protected) {
      // derived is built from these same tabs
      counts.protected++;
    }
  }
  return counts;
}
