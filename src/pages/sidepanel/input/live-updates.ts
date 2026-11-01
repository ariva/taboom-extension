// Live updates: chrome.tabs / tabGroups / windows / storage events → one debounced refresh.
import { capabilities } from "../../../lib/platform/capabilities.ts";
import { refresh } from "../foundation/scheduler.ts";
import type { UiPrefs, WindowProfiles } from "../../../app/types.ts";
import { identityChanged } from "../../../app/window-identity.ts";
import { state } from "../foundation/state.ts";
import { adoptSharedSearch, adoptSharedTagFilter, adoptStoredView } from "./toolbar-events.ts";

// Tab/storage events → debounced refresh. Querying Chrome fresh each time
// avoids incremental-cache sync bugs; cheap for a few hundred tabs.
let refreshTimer: ReturnType<typeof setTimeout> | undefined;
function scheduleRefresh(): void {
  clearTimeout(refreshTimer);
  refreshTimer = setTimeout(refresh, 150);
}

for (const event of [
  chrome.tabs.onCreated,
  chrome.tabs.onActivated,
  chrome.tabs.onRemoved,
  chrome.tabs.onReplaced, // a discard may swap a tab's id (prerender, back/forward cache)
  chrome.tabs.onMoved,
  chrome.tabs.onAttached,
  chrome.tabs.onDetached,
  chrome.windows.onFocusChanged,
  ...(capabilities.tabGroups
    ? [chrome.tabGroups.onCreated, chrome.tabGroups.onRemoved, chrome.tabGroups.onUpdated, chrome.tabGroups.onMoved]
    : []),
]) {
  event.addListener(scheduleRefresh);
}

// onUpdated fires for every tab's loading progress — with hundreds of tabs that's
// a constant stream; only changes the list actually shows should trigger a render
const RENDERED_TAB_PROPS = ["title", "url", "favIconUrl", "discarded", "audible", "pinned", "groupId"];
chrome.tabs.onUpdated.addListener((_tabId, changeInfo) => {
  if (RENDERED_TAB_PROPS.some((prop) => prop in changeInfo)) {
    scheduleRefresh();
  }
});

// our own perf flush + history bookkeeping write storage constantly — don't
// let those echo back into renders (history buttons have their own listener)
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "session") {
    if (changes.sharedSearch) {
      // StorageChange values are `unknown`; the key is only ever written as a string
      adoptSharedSearch(changes.sharedSearch.newValue as string | undefined);
    }
    if (changes.sharedTagFilter) {
      // likewise: only ever written as a string[]
      adoptSharedTagFilter(changes.sharedTagFilter.newValue as string[] | undefined);
    }
    return; // the rest of storage.session (wake times, the identity map) is worker bookkeeping
  }
  if (area !== "local") {
    return;
  }
  const ignored = [
    "perfMetrics",
    "perfSnapshots",
    "tabHistory",
    "updateAvailable",
    "dismissedUpdate",
    "windowSessionMap", // identity bookkeeping churns on every tab event
  ];
  // windowProfiles churns the same way (fingerprints rewritten per tab event) but also carries the
  // names / colors / pins another panel or the worker's restart recovery may change: refresh on those only
  const relevant = Object.keys(changes).filter((key) =>
    key === "windowProfiles"
      ? // StorageChange values are `unknown`; the key is only ever written as WindowProfiles
        identityChanged(
          changes.windowProfiles?.oldValue as WindowProfiles | undefined,
          changes.windowProfiles?.newValue as WindowProfiles | undefined,
        )
      : !ignored.includes(key),
  );
  if (relevant.length === 0) {
    return;
  }
  // this panel's own ui-prefs write echoing back — already rendered that state
  if (
    relevant.length === 1 &&
    relevant[0] === "ui" &&
    state.pendingUiWrites.delete(JSON.stringify(changes.ui?.newValue))
  ) {
    return;
  }
  if (changes.ui) {
    // a foreign ui write supersedes whatever this panel still had in flight: storage is the truth
    // again from here (and no stale entry can keep refresh() from reading it)
    state.pendingUiWrites.clear();
  }
  if (changes.ui?.newValue) {
    // StorageChange values are `unknown`; "ui" is only ever written whole, as UiPrefs
    const stored = changes.ui.newValue as Partial<UiPrefs>;
    const before = changes.ui.oldValue as Partial<UiPrefs> | undefined;
    // only a filter / scope / sort that changed IN STORAGE is adopted: the live trio may differ from
    // the stored one on purpose (the Parked scope shows All for a stored snoozed, a flag off, a
    // search that auto-selected All), and a theme write must not re-apply the stored one over it
    const { defaultFilter, scope, sort, ...rest } = stored;
    const view: Partial<UiPrefs> = rest;
    if (before?.defaultFilter !== defaultFilter) {
      view.defaultFilter = defaultFilter;
    }
    if (before?.scope !== scope) {
      view.scope = scope;
    }
    if (before?.sort !== sort) {
      view.sort = sort;
    }
    adoptStoredView(view); // a foreign write: the shared view follows it (a cleared store has no new value)
  }
  scheduleRefresh();
});
