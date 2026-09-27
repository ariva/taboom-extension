// Toolbar events: search, filter chips, scope/sort selects, sort direction, fuzzy
// toggle, select-all, settings and the bulk buttons — with the per-filter scroll
// memory and the ui-prefs persistence those handlers share.
import { featureEnabled } from "../../../app/core.ts";
import { saveState } from "../../../app/storage.ts";
import { closest, getElementById } from "../../../lib/dom.ts";
import { closeTabs, protectTabs, snooze, wake } from "../ops/actions.ts";
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
import { render } from "../foundation/scheduler.ts";
import { canonicalDir, SORT_DIRECTIONS } from "../model/sort-direction.ts";
import { initialDirFor } from "../render/sorting.ts";
import { effectiveSort, state } from "../foundation/state.ts";

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
      state.filter = "all";
    }
  }
  state.cursor = value ? 0 : -1;
  state.pendingScroll = value ? 0 : (scrollByFilter.get(state.filter) ?? 0);
  render(false);
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
  state.pendingScroll = scrollMap.get(state.filter) ?? 0;
  persistUiPrefs();
  // mid-search the old/new filtered sets barely overlap — a view transition
  // cross-fades two unrelated lists (reads as ghosting), so skip animation
  render(!state.query);
});

// scope/sort change = a different list — start at top, and saved per-filter
// positions from the old view are meaningless now
function resetScrollPositions(): void {
  scrollByFilter.clear();
  searchScrollByFilter.clear();
  state.pendingScroll = 0;
}

scopeSelect.addEventListener("change", () => {
  state.scope = scopeSelect.value;
  resetScrollPositions();
  persistUiPrefs();
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
    state.sortDir = states[(states.indexOf(state.sortDir) + 1) % states.length]!; // modulo length: always in range
  }
  resetScrollPositions(); // new order = saved positions meaningless; start at top
  persistUiPrefs();
  render(!state.query);
});

// JSON of the ui object this panel just persisted — its storage echo is skipped
// (the click handler already rendered that state; without this every filter/
// scope/sort click renders twice and re-queries all tabs 150ms later)
let lastOwnUiWrite: string | null = null;

// live-updates.ts compares the storage echo against it, then spends it
export function ownUiWrite(): string | null {
  return lastOwnUiWrite;
}

export function clearOwnUiWrite(): void {
  lastOwnUiWrite = null;
}

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
  lastOwnUiWrite = JSON.stringify(ui);
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

getElementById("settings-btn").addEventListener("click", () => {
  chrome.runtime.openOptionsPage();
});

// main.ts wires the buttons at boot, at their original spot in the listener order
export function initBulkButtons(): void {
  getElementById("bulk-snooze").addEventListener("click", () => snooze([...state.selected]));
  getElementById("bulk-wake").addEventListener("click", () => wake([...state.selected]));
  getElementById("bulk-protect").addEventListener("click", () => protectTabs([...state.selected]));
  getElementById("bulk-close").addEventListener("click", () => closeTabs([...state.selected]));
}

getElementById("bulk-clear").addEventListener("click", () => {
  state.selected.clear();
  render();
});
