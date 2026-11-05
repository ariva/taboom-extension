// Live updates: chrome.tabs / tabGroups / windows / storage events → one debounced refresh.
import { capabilities } from "../../../lib/platform/capabilities.ts";
import { refresh, render } from "../foundation/scheduler.ts";
import type { FocusHint, UiPrefs, WindowProfiles } from "../../../app/types.ts";
import { identityChanged } from "../../../app/window-identity.ts";
import { state } from "../foundation/state.ts";
import { hintSurvives } from "../model/focus-intent.ts";
import { askFocus } from "../ops/focus-ask.ts";
import { adoptSharedSearch, adoptSharedTagFilter, adoptStoredView } from "./toolbar-events.ts";

// Tab/storage events → debounced refresh. Querying Chrome fresh each time
// avoids incremental-cache sync bugs; cheap for a few hundred tabs.
// The wait also lets the panel that caused the event (a click in another panel on the same
// main thread) paint first; a render asked for while a refresh is pending folds into the refresh
let refreshTimer: ReturnType<typeof setTimeout> | undefined;
let refreshDue = false;
function scheduleRefresh(): void {
  refreshDue = true;
  armTimer();
}
function scheduleRender(): void {
  armTimer();
}
function armTimer(): void {
  clearTimeout(refreshTimer);
  refreshTimer = setTimeout(() => {
    const full = refreshDue;
    refreshDue = false;
    if (full) {
      refresh();
    } else {
      render(false);
    }
  }, 150);
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

// A press or key inside this panel proves its window is the focused one, whatever Chrome's
// record says (a Linux workspace switch leaves it naming the window focused before, with no
// windows.onFocusChanged until a real click elsewhere and back). Corrected at once — a row
// click right after reads the right origin — and told to the other panels.
for (const type of ["pointerdown", "keydown"]) {
  document.addEventListener(
    type,
    () => {
      if (state.panelWindowId != null && state.currentWindowId !== state.panelWindowId) {
        askFocus(state.panelWindowId);
        scheduleRefresh();
      }
    },
    true,
  );
}
// a focus change after the settle window is the user moving focus for real: the record rules again
chrome.windows.onFocusChanged.addListener((windowId) => {
  if (state.focusHint && !hintSurvives(state.focusHint, windowId, Date.now())) {
    state.focusHint = null;
  }
});

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
    if (changes.focusHint?.newValue) {
      // another panel asked Chrome for a window (or proved its own focused): show it as current
      // here too. Only ever written as a FocusHint; this panel's own write echoes back unchanged
      const hint = changes.focusHint.newValue as FocusHint;
      if (hint.windowId !== state.focusHint?.windowId || hint.at !== state.focusHint.at) {
        state.focusHint = hint;
        scheduleRefresh();
      }
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
    // a click in another panel moves the view only: no tab changed, so the adopted view renders
    // without re-querying them, and the independent view (nothing adopted) does nothing at all —
    // every open panel shares one main thread, and a refresh per panel per click added up (T-0150).
    // The scope is not view-only: the Parked scope swaps the data set in refresh()
    if (relevant.length === 1 && before && movedOnly(before, stored, VIEW_ONLY_KEYS)) {
      if ((state.ui.panelView ?? "shared") === "shared") {
        scheduleRender();
      }
      return;
    }
  }
  scheduleRefresh();
});

const VIEW_ONLY_KEYS = new Set<keyof UiPrefs>(["defaultFilter", "sort", "sortDirections"]);

// true when every key whose value differs between the two is in `keys` (objects by content)
function movedOnly(before: Partial<UiPrefs>, after: Partial<UiPrefs>, keys: Set<keyof UiPrefs>): boolean {
  const all = new Set([...Object.keys(before), ...Object.keys(after)] as (keyof UiPrefs)[]);
  for (const key of all) {
    if (!keys.has(key) && JSON.stringify(before[key]) !== JSON.stringify(after[key])) {
      return false;
    }
  }
  return true;
}
