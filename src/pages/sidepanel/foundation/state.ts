// The panel's single mutable state, its types, and the small predicates derived
// from it alone that many features read.
import { featureEnabled } from "../../../app/core.ts";
import type { FeatureName, Features, NavMode, ProtectionRule, UiPrefs } from "../../../app/types.ts";
import { capabilities } from "../../../lib/platform/capabilities.ts";
import type { DerivedTabs, SortDir, WindowMetaMap } from "../model/index.ts";

// every tab the panel holds comes from chrome.tabs.query/create — those always
// carry an id (only foreign-session tabs lack one), so ids flow into chrome.*
// calls and messages without a check at every use
export type PanelTab = chrome.tabs.Tab & { id: number };

type TabGroup = chrome.tabGroups.TabGroup;

// key of one list group: window id / tab-group id (numbers), title / domain /
// url (strings); the collapse sets also hold "tg:<id>" keys of nested tab-group runs
export type GroupKey = number | string;

// the single mutable state of the panel — see `state` below for the field notes
export interface PanelState {
  query: string;
  // filter/scope/sort stay `string` like the model's view types: they arrive
  // unvalidated from the DOM and storage
  filter: string; // FilterName
  scope: string; // ScopeName
  sort: string; // SortName
  sortDir: SortDir;
  ui: UiPrefs;
  rules: ProtectionRule[];
  features: Features;
  rawFeatures: Features;
  navMode: NavMode;
  allTabs: PanelTab[];
  derived: DerivedTabs;
  visible: PanelTab[];
  fullVisible: PanelTab[];
  collapsedGroups: Set<GroupKey>;
  searchCollapsedGroups: Set<GroupKey>;
  selected: Set<number>;
  cursor: number;
  currentWindowId: number | null; // null until the first refresh() resolves
  activeTabId: number | null; // active tab of the current window as of the last refresh()
  followCurrent: boolean;
  revealCurrent: boolean;
  pendingScroll: number | null;
  windowMeta: WindowMetaMap;
  tabGroups: Map<number, TabGroup>;
}

// the single mutable state of the panel — handlers write here, render reads
export const state: PanelState = {
  query: "",
  filter: "all",
  scope: "all-windows",
  sort: "recent",
  sortDir: "desc", // current sort's direction state (see SORT_DIRECTIONS)
  ui: {} as UiPrefs, // placeholder until init / refresh() assign the persisted prefs
  rules: [],
  // placeholder until main.ts assigns the loaded flags right after its top-level await
  // (awaiting them here would queue main.ts's state read behind the fetch);
  // experimental-resolved copy, refreshed in refresh()
  features: {} as Features,
  // the flags exactly as loaded (before the experimental opt-in), static per load —
  // same placeholder-then-assign as `features`
  rawFeatures: {} as Features,
  navMode: "off", // "off" | "compact" | "traditional" — resolved in refresh()
  allTabs: [],
  derived: new Map(), // per-tab {host, haystack, protected} — rebuilt each refresh
  visible: [], // rows the user can interact with (excludes collapsed groups)
  fullVisible: [], // before collapsing — header counts + empty-state check
  collapsedGroups: new Set(), // group keys collapsed in a grouped sort (session only)
  // collapse state WITHIN a search: each search starts fully expanded (matches
  // must be visible), but groups can then be folded without touching the
  // pre-search collapse state — same split as searchScrollByFilter
  searchCollapsedGroups: new Set(),
  selected: new Set(),
  cursor: -1,
  currentWindowId: null, // until the first refresh() resolves
  activeTabId: null,
  // after activating, the tab jumps in the list (top in recent/window sorts) —
  // follow it on the next event-driven re-render so it doesn't vanish off-screen
  followCurrent: false,
  // the active tab changed outside the panel (keyboard history command, Ctrl+Tab):
  // minimal scroll so the row is visible — no jump to top, a row already on
  // screen stays where it is
  revealCurrent: false,
  pendingScroll: null, // scrollTop to apply after the next render (filter/search switches)
  windowMeta: new Map(), // windowId → { name, color } from windowProfiles (WINDOW_NAMES)
  tabGroups: new Map(), // groupId → { title, color, collapsed } from chrome.tabGroups
};

// TAB_GROUPS flag + API present (permission granted, Chrome supports it)
export function tabGroupsActive(): boolean {
  return featureEnabled(state.features, "TAB_GROUPS") && capabilities.tabGroups;
}

// nested tab-group sub-headers make sense only while the list mirrors the
// real strip — grouped tabs are contiguous runs there
export function nestedTabGroupsActive(): boolean {
  return tabGroupsActive() && (state.ui.groupByWindowTabsOrder ?? "same-as-window") === "same-as-window";
}

// WINDOW_NAMES resolved flag + user toggle — every naming surface gates on this
export function namesActive(): boolean {
  return featureEnabled(state.features, "WINDOW_NAMES") && (state.ui.windowNamesEnabled ?? true);
}

// window pinning rides the names feature but has its own kill switch
export function pinActive(): boolean {
  return namesActive() && featureEnabled(state.features, "WINDOW_PIN");
}

// sorts that only exist while their feature flag is on (option hidden + a
// stored preference falls back to the window grouping)
export const FLAG_GATED_SORTS: Record<string, FeatureName> = {
  "group-tabgroup": "TAB_GROUPS",
  "group-title": "GROUP_BY_TITLE",
  "group-domain": "GROUP_BY_DOMAIN",
  "group-url": "GROUP_BY_URL",
};

// flag-gated sort selected while its flag is off: fall back to the window
// grouping for display — the stored preference is not rewritten
export function effectiveSort(): string {
  const flag = FLAG_GATED_SORTS[state.sort];
  if (flag && !featureEnabled(state.features, flag)) {
    return "window";
  }
  return state.sort;
}

// the collapse set in effect: searches get their own (fresh per search)
export function activeCollapsedSet(): Set<GroupKey> {
  return state.query ? state.searchCollapsedGroups : state.collapsedGroups;
}

// in-window reorder only makes sense while the list mirrors the real tab
// strip: Group by window with the "Same as window" tab order
export function reorderActive(): boolean {
  return effectiveSort() === "window" && (state.ui.groupByWindowTabsOrder ?? "same-as-window") === "same-as-window";
}
