// Toolbar events: search, filter chips, scope/sort selects, sort direction, fuzzy
// toggle, select-all, settings and the bulk buttons — with the per-filter scroll
// memory and the ui-prefs persistence those handlers share.
import { featureEnabled } from "../../../app/core.ts";
import type { UiPrefs } from "../../../app/types.ts";
import { saveState, sessionStore } from "../../../app/storage.ts";
import { closest, getElementById } from "../../../lib/dom.ts";
import { closeTabs, protectTabs, snooze, wake } from "../ops/actions.ts";
import { restoreLastForgotten } from "../ops/parked-ops.ts";
import {
  filterBar,
  listEl,
  scopeSelect,
  searchInput,
  selectAllBox,
  sortDirBtn,
  sortSelect,
} from "../foundation/elements.ts";
import { countsByFilter, searchCandidates } from "../model/index.ts";
import type { FilterName } from "../model/index.ts";
import { refresh, render } from "../foundation/scheduler.ts";
import { canonicalDir, SORT_DIRECTIONS } from "../model/sort-direction.ts";
import { initialDirFor } from "../render/sorting.ts";
import { effectiveSort, parkedActive, parkedScope, state } from "../foundation/state.ts";

// Scroll positions are remembered per filter — in two separate worlds, so they
// can't clobber each other: scrollByFilter holds normal-browsing positions
// (restored when the search is cleared), searchScrollByFilter holds positions
// within the current search results (restored when switching filters mid-search,
// discarded when the search ends).
const scrollByFilter = new Map<string, number>();
const searchScrollByFilter = new Map<string, number>();

export function setQuery(value: string): void {
  if (value && !state.query) {
    scrollByFilter.set(state.filter, listEl.scrollTop); // entering search
    state.searchCollapsedGroups.clear(); // every search starts fully expanded
  }
  if (!value) {
    searchScrollByFilter.clear(); // search over — in-results positions are stale
    state.searchCollapsedGroups.clear();
    if (state.filterBeforeSearch !== null) {
      state.filter = state.filterBeforeSearch; // the search is over: the filter it replaced is back
      state.filterBeforeSearch = null;
    }
  }
  state.query = value;
  // search narrowed the current filter to nothing while matches exist elsewhere:
  // auto-select All so the results aren't hidden behind the filter (not
  // persisted — the user didn't choose it)
  if (
    value &&
    state.filter !== "all" &&
    featureEnabled(state.features, "SEARCH_AUTO_SELECT_ALL") &&
    (state.ui.searchEmptyFilter ?? "keep") === "all" // user opted in (options: Customization)
  ) {
    const found = countsByFilter(searchCandidates(state.allTabs, state), state.derived);
    // an unknown stored filter reads undefined here — never === 0, so nothing switches
    if (found[state.filter as FilterName] === 0 && found.all > 0) {
      state.filterBeforeSearch ??= state.filter; // the first switch of this search remembers the user's filter
      state.filter = "all";
    }
  }
  state.cursor = value ? 0 : -1;
  state.pendingScroll = value ? 0 : (scrollByFilter.get(state.filter) ?? 0);
  render(false);
  publishSharedSearch(value);
}

// Shared search: the search text is part of the shared view (ui.panelView; an independent panel
// shares nothing). What this panel types goes to storage.session.sharedSearch once the keystrokes
// settle, and every other open panel takes it as if typed there. lastSharedSearch is the text the
// store holds as far as this panel knows: a foreign text already adopted matches it, so it is not
// written back. ownWrites are this panel's writes whose storage echo has not arrived yet: an echo
// lands after the next keystrokes (always; late by several writes when seven panels are busy
// rendering), and taken for foreign text it would reset the box to the older text (T-0149).
// longer than a typing gap (120–250 ms): the other panels follow when the typist pauses, not per
// keystroke — every open panel renders the adopted text on the one main thread the extension's
// pages share, 190 ms each for 1100 rows (measured 2026-11-05, 7 panels)
const SHARE_SEARCH_DEBOUNCE_MS = 300;
let lastSharedSearch: string | undefined;
let ownWrites: string[] = [];
let shareSearchTimer: ReturnType<typeof setTimeout> | undefined;

function viewShared(): boolean {
  return (state.ui.panelView ?? "shared") === "shared";
}

function publishSharedSearch(value: string): void {
  clearTimeout(shareSearchTimer);
  if (!viewShared() || value === lastSharedSearch) {
    return;
  }
  shareSearchTimer = setTimeout(() => {
    lastSharedSearch = value;
    ownWrites.push(value);
    sessionStore.set({ sharedSearch: value });
  }, SHARE_SEARCH_DEBOUNCE_MS);
}

// The Tags chip's ticks are a filter, so the shared view carries them too (storage.session.sharedTagFilter,
// written on every tick / reset / quick-launch pick, no debounce — clicks, not keystrokes). Same echo
// guard as the search: the JSON the store holds as far as this panel knows.
let lastSharedTagFilter: string | undefined;

export function publishSharedTagFilter(): void {
  const ids = [...state.tagFilter];
  const json = JSON.stringify(ids);
  if (!viewShared() || json === lastSharedTagFilter) {
    return;
  }
  lastSharedTagFilter = json;
  sessionStore.set({ sharedTagFilter: ids });
}

// a storage.session.sharedTagFilter write (another panel ticked, or the set found at boot); the
// render refills an open picker
export function adoptSharedTagFilter(ids: string[] | undefined): void {
  const next = ids ?? [];
  if (!viewShared()) {
    return;
  }
  lastSharedTagFilter = JSON.stringify(next);
  if (next.length === state.tagFilter.size && next.every((id) => state.tagFilter.has(id))) {
    return; // the own write echoing back, or nothing new
  }
  state.tagFilter = new Set(next);
  render(false);
}

// a storage.session.sharedSearch write (another panel typed, or the text found at boot)
export function adoptSharedSearch(text: string | undefined): void {
  const value = text ?? "";
  if (!viewShared()) {
    return;
  }
  const own = ownWrites.indexOf(value);
  if (own !== -1) {
    ownWrites = ownWrites.slice(own + 1); // echoes come in write order: everything before it has echoed too
    return; // this panel's own write: the box already moved on, keystrokes waiting keep their timer
  }
  clearTimeout(shareSearchTimer); // keystrokes still waiting here are older than the text that just landed
  lastSharedSearch = value;
  if (value === state.query) {
    return; // the own write echoing back, or nothing new
  }
  searchInput.value = value;
  setQuery(value);
}

searchInput.addEventListener("input", () => {
  setQuery(searchInput.value);
});

filterBar.addEventListener("click", (event) => {
  const button = closest(event.target, "button[data-filter]");
  if (!button) {
    return;
  }
  // per-filter scroll memory applies while searching too, but in-search
  // positions live in their own map so pre-search spots survive the search
  const scrollMap = state.query ? searchScrollByFilter : scrollByFilter;
  scrollMap.set(state.filter, listEl.scrollTop);
  state.filter = button.dataset.filter!; // the button matched [data-filter]
  state.filterBeforeSearch = null; // the user's choice, search or not
  state.pendingScroll = scrollMap.get(state.filter) ?? 0;
  state.revealCurrent = true; // the current row at the top, when this view holds it
  persistUiPrefs();
  // mid-search the old/new filtered sets barely overlap — a view transition
  // cross-fades two unrelated lists (reads as ghosting), so skip animation
  render(!state.query);
});

// scope/sort change = a different list — start at top (the current row at the top when the
// list holds it), and saved per-filter positions from the old view are meaningless now
function resetScrollPositions(): void {
  scrollByFilter.clear();
  searchScrollByFilter.clear();
  state.pendingScroll = 0;
  state.revealCurrent = true;
}

scopeSelect.addEventListener("change", () => {
  const wasParked = parkedActive() && state.scope === "parked-windows";
  state.scope = scopeSelect.value;
  resetScrollPositions();
  persistUiPrefs();
  // the parked scope lists a different data set (refresh swaps it in / out); the other two
  // only filter the live list
  if (wasParked || (parkedActive() && state.scope === "parked-windows")) {
    state.selected.clear(); // ids of one set mean nothing in the other
    refresh(!state.query);
    return;
  }
  render(!state.query);
});

sortSelect.addEventListener("change", () => {
  state.sort = sortSelect.value;
  state.sortDir = initialDirFor(state.sort);
  state.collapsedGroups.clear(); // keys from another grouping are meaningless
  state.searchCollapsedGroups.clear();
  resetScrollPositions();
  persistUiPrefs();
  render(!state.query);
});

sortDirBtn.addEventListener("click", () => {
  const meta = SORT_DIRECTIONS[effectiveSort()];
  if (meta?.inverse) {
    // smart pair swap: e.g. Recently used ⇄ Least recently used
    state.sort = meta.inverse;
    sortSelect.value = meta.inverse;
    state.sortDir = canonicalDir(state.sort);
  } else {
    const states = meta?.states ?? ["asc", "desc"];
    state.sortDir = states[(states.indexOf(state.sortDir) + 1) % states.length] ?? "asc"; // modulo length: always in range
  }
  resetScrollPositions(); // new order = saved positions meaningless; start at top
  persistUiPrefs();
  render(!state.query);
});

// Shared view (ui.panelView, the default): a filter / scope / sort written elsewhere — Settings'
// Restore defaults, a click in another panel — lands here as if clicked here, without being
// written back. The independent view keeps this panel's own choice; the store still seeds the
// next panel to open. Own writes never reach this (the storage echo is skipped).
export function adoptStoredView(ui: Partial<UiPrefs>): void {
  if ((ui.panelView ?? state.ui.panelView ?? "shared") !== "shared") {
    return;
  }
  state.ui = { ...state.ui, ...ui }; // initialDirFor reads sortDirMode / sortDirections from it (a partial write keeps the rest)
  let changed = false;
  if (ui.defaultFilter !== undefined && ui.defaultFilter !== state.filter) {
    state.filter = ui.defaultFilter;
    state.filterBeforeSearch = null; // a click in another panel: the user's choice here too
    changed = true;
  }
  if (ui.scope !== undefined && ui.scope !== state.scope) {
    const wasParked = parkedScope();
    state.scope = ui.scope;
    scopeSelect.value = ui.scope;
    if (wasParked !== parkedScope()) {
      state.selected.clear(); // ids of one set mean nothing in the other
    }
    changed = true;
  }
  if (ui.sort !== undefined && ui.sort !== state.sort) {
    state.sort = ui.sort;
    sortSelect.value = ui.sort;
    state.sortDir = initialDirFor(ui.sort);
    state.collapsedGroups.clear(); // keys from another grouping are meaningless
    state.searchCollapsedGroups.clear();
    changed = true;
  }
  if (changed) {
    resetScrollPositions();
  }
}

// Every ui object this panel persists is remembered (state.pendingUiWrites) until its storage
// echo arrives: the echo is skipped — the click handler already rendered that state; without
// this every filter / scope / sort click renders twice and re-queries all tabs 150 ms later —
// and a refresh that was already reading storage keeps the panel's own ui instead of the
// pre-write one it read. A set, not one slot: two clicks inside one round trip echo twice.

export function persistUiPrefs(): void {
  const ui = {
    ...state.ui,
    defaultFilter: state.filter,
    scope: state.scope,
    sort: state.sort,
    // every sort remembers its last direction (only applied when the user's
    // Sort memory option is "remember")
    sortDirections: { ...(state.ui.sortDirections ?? {}), [state.sort]: state.sortDir },
  };
  state.ui = ui;
  state.pendingUiWrites.add(JSON.stringify(ui));
  saveState({ ui });
}

// fuzzy checkbox next to search = the same ui.experimental_fuzzySearch pref
// the options page exposes; re-render re-ranks the active search immediately
getElementById("fuzzy-toggle").addEventListener("change", () => {
  state.ui = { ...state.ui, experimental_fuzzySearch: getElementById("fuzzy-toggle").checked };
  persistUiPrefs();
  render(false);
});

// Select/unselect everything currently visible (i.e. matching search + filter).
selectAllBox.addEventListener("change", () => {
  if (selectAllBox.checked) {
    for (const tab of state.visible) {
      state.selected.add(tab.id);
    }
  } else {
    for (const tab of state.visible) {
      state.selected.delete(tab.id);
    }
  }
  render(false);
});

// main.ts wires the buttons at boot, at their original spot in the listener order
export function initBulkButtons(): void {
  getElementById("bulk-snooze").addEventListener("click", () => snooze([...state.selected]));
  getElementById("bulk-wake").addEventListener("click", () => wake([...state.selected]));
  getElementById("bulk-protect").addEventListener("click", () => protectTabs([...state.selected]));
  getElementById("bulk-close").addEventListener("click", () => closeTabs([...state.selected]));
  getElementById("parked-undo").addEventListener("click", restoreLastForgotten); // Parked windows scope only
}

getElementById("bulk-clear").addEventListener("click", () => {
  state.selected.clear();
  render();
});
