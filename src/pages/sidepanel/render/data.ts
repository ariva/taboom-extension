// refresh(): loads tabs, tab groups, persisted state and window identity into `state`,
// syncs the flag-gated toolbar bits, then renders.
import { applyExperimental, featureEnabled, resolveColorScheme, resolveNavMode } from "../../../app/core.ts";
import { loadState, localStore, sessionStore } from "../../../app/storage.ts";
import type { AppState } from "../../../app/types.ts";
import { parkedLayoutKey, parkedPanelTabs } from "../../../app/parked.ts";
import { enabledTags } from "../../../app/tags.ts";
import { getElementById, mustQuery } from "../../../lib/dom.ts";
import { capabilities } from "../../../lib/platform/capabilities.ts";
import { filterBar, scopeSelect, sortSelect } from "../foundation/elements.ts";
import { deriveTabs, windowMaps } from "../model/index.ts";
import { render } from "../foundation/scheduler.ts";
import {
  effectiveSort,
  FLAG_GATED_SORTS,
  keepAliveActive,
  namesActive,
  parkedActive,
  parkedScope,
  state,
  tagsActive,
} from "../foundation/state.ts";
import type { PanelTab } from "../foundation/state.ts";

type TabGroup = chrome.tabGroups.TabGroup;

// animate only for user-initiated refreshes; background event echoes
// (tab/storage/focus changes — incl. renders triggered in OTHER open panels)
// re-render without a view transition
// two refreshes in flight (an explicit one racing the debounced one): only the newest may land
let generation = 0;

export async function refresh(animate = false, preloaded: AppState | null = null): Promise<void> {
  const mine = ++generation;
  const [
    persisted,
    tabs,
    win,
    panelWindowId,
    { windowProfiles = {}, keepAlive = [], parkedWindows = [], parkedTrash = [], tags = [], tagPages = [] },
    { windowSessionMap = {} },
    groups,
  ] = await Promise.all([
    preloaded ?? loadState(), // startup passes its already-read state — no second read
    chrome.tabs.query({}),
    chrome.windows.getLastFocused({ windowTypes: ["normal", "popup"] }), // not a focused DevTools / app window: the list never shows those
    state.panelWindowId ?? chrome.windows.getCurrent().then((own) => own.id ?? null), // read once: a panel never changes window
    localStore.get(["windowProfiles", "keepAlive", "parkedWindows", "parkedTrash", "tags", "tagPages"]),
    sessionStore.get("windowSessionMap"),
    capabilities.tabGroups ? chrome.tabGroups.query({}).catch(() => []) : [],
  ]);
  if (mine !== generation) {
    return; // a newer refresh started meanwhile: its answer is the one to show
  }
  state.tabGroups = new Map(groups.map((group): [number, TabGroup] => [group.id, group]));
  // parked rows have positional ids: a parked list edited elsewhere (another panel, Settings'
  // Restore) moves them under the ticks — the selection goes, as live ids go with their tabs
  if (parkedScope() && parkedLayoutKey(state.parked) !== parkedLayoutKey(parkedWindows)) {
    state.selected.clear();
  }
  state.parked = parkedWindows;
  state.parkedTrashCount = parkedTrash.length;
  state.tags = tags;
  // a ticked tag removed or disabled in Settings leaves the filter: kept, it would match nothing
  // while the chip (which names enabled tags only) read "Tags"
  const enabledIds = new Set(enabledTags(tags).map((tag) => tag.id));
  for (const tagId of [...state.tagFilter]) {
    if (!enabledIds.has(tagId)) {
      state.tagFilter.delete(tagId);
    }
  }
  state.tagPages = tagPages;
  state.rules = persisted.protectionRules;
  state.keepAlive = keepAlive;
  state.keepAliveEnabled = persisted.settings.keepAliveEnabled;
  // a write of this panel's own may have landed after this refresh read storage: until its echo
  // arrives the panel's ui is the newer one (the fuzzy toggle, Tabs Order must not flip back)
  if (state.pendingUiWrites.size === 0) {
    state.ui = persisted.ui;
  }
  document.documentElement.style.fontSize = `${state.ui.fontSize ?? 1}rem`;
  // light-dark() colors resolve via color-scheme, so forcing it flips the palette
  document.documentElement.style.colorScheme = resolveColorScheme(state.ui.theme);
  // (a focus move to another window changes the active tab below: that reveal covers the
  // window grouping's reorder, the new current window's group jumping to the top)
  state.panelWindowId = panelWindowId;
  // a window this or another panel asked for (or proved focused by a press) outranks Chrome's
  // focus record while the hint lives — see model/focus-intent.ts
  if (state.focusHint && win.id === state.focusHint.windowId) {
    state.focusHint = null; // Chrome's record caught up: nothing to outrank
  }
  state.currentWindowId = state.focusHint?.windowId ?? win.id!; // live windows always have an id (only sessions-API windows lack one)
  // active tab switched from outside the panel (worker's history command,
  // Ctrl+Tab): the row re-renders as current but may sit off-screen. The first
  // refresh counts too: the panel opens at the top, the active tab may be far down
  const previousActive = state.activeTabId;
  state.activeTabId = tabs.find((tab) => tab.active && tab.windowId === state.currentWindowId)?.id ?? null;
  if (state.activeTabId !== previousActive) {
    state.revealCurrent = true;
  }
  state.allTabs = tabs as PanelTab[]; // chrome.tabs.query: every tab has an id — see PanelTab
  // resolved once per refresh; the keydown handler reads this instead of
  // re-running applyExperimental (a fresh object) on every keypress
  state.features = applyExperimental(state.rawFeatures, state.ui.showExperimental ?? false);
  // window names/colors: session map binds live chrome ids to logical profiles
  state.windowMeta = new Map();
  if (namesActive()) {
    for (const [chromeId, logicalId] of Object.entries(windowSessionMap)) {
      const profile = windowProfiles[logicalId];
      if (profile && (profile.name || profile.color || profile.pinnedWindow)) {
        state.windowMeta.set(Number(chromeId), {
          name: profile.name,
          color: profile.color,
          // model + popover read meta blindly — omit the pin when its flag is off
          pinnedWindow: featureEnabled(state.features, "WINDOW_PIN") ? profile.pinnedWindow : undefined,
        });
      }
    }
  }
  state.liveTabs = state.allTabs;
  state.liveTabGroups = state.tabGroups;
  state.liveWindowMeta = state.windowMeta;
  state.liveWindowMaps = windowMaps(state.liveTabs, state.currentWindowId, state.liveWindowMeta);
  // Parked windows scope: the list shows the snapshots as rows (negative ids, one synthetic
  // window per parked window) — search, filters, sorts and headers work unchanged on them
  // static markup: the scope <select> has the parked-windows option
  mustQuery<HTMLOptionElement>(scopeSelect, 'option[value="parked-windows"]').hidden = !parkedActive();
  if (parkedScope()) {
    const panel = parkedPanelTabs(state.parked);
    state.allTabs = panel.tabs;
    state.tabGroups = panel.groups;
    state.windowMeta = panel.meta;
    if (state.filter === "awake" || state.filter === "snoozed") {
      state.filter = "all"; // nothing parked is awake or snoozed; not persisted — the user did not choose it
    }
  }
  for (const name of ["awake", "snoozed"]) {
    // static markup: both chips exist in #filters
    mustQuery(filterBar, `button[data-filter="${name}"]`).hidden = parkedScope();
  }
  // static markup: the Tags chip exists in #filters; a stored "tags" filter with the flag off reads as All
  mustQuery(filterBar, 'button[data-filter="tags"]').hidden = !tagsActive();
  if (state.filter === "tags" && !tagsActive()) {
    state.filter = "all";
  }
  state.tabsById = new Map([...state.liveTabs, ...state.allTabs].map((tab) => [tab.id, tab]));
  // tabs closed outside the panel (or id-swapped by discard) leave stale ids
  // in the selection — prune so counts and select-all stay truthful
  const shownIds = new Set(state.allTabs.map((tab) => tab.id));
  for (const tabId of [...state.selected]) {
    if (!shownIds.has(tabId)) {
      state.selected.delete(tabId);
    }
  }
  state.derived = deriveTabs(
    state.allTabs,
    state.rules,
    keepAliveActive() ? state.keepAlive : [],
    tagsActive() ? { tags: state.tags, pages: state.tagPages } : undefined,
  );
  // flag turned off mid-navigation: drop the cursor so no stale outline lingers
  if (!featureEnabled(state.features, "SIDEBAR_KEYBOARD_NAVIGATION")) {
    state.cursor = -1;
  }
  state.navMode = resolveNavMode(state.features, state.ui);
  // flag-gated sorts: hide options whose flag is off, and show the effective
  // sort if a stored preference can't apply
  for (const [value, flag] of Object.entries(FLAG_GATED_SORTS)) {
    // static markup: every FLAG_GATED_SORTS key has its <option> in index.html
    sortSelect.querySelector<HTMLElement>(`option[value="${value}"]`)!.hidden = !featureEnabled(state.features, flag);
  }
  sortSelect.value = effectiveSort();
  getElementById("hist-back").hidden = state.navMode === "off";
  getElementById("hist-forward").hidden = state.navMode === "off";
  getElementById("hist-list-btn").hidden = !featureEnabled(state.features, "NAVIGATION_DROPDOWN");
  getElementById("win-list-btn").hidden = !namesActive();
  // offered only when experimental features are on AND FUZZY_SEARCH is enabled
  // BECAUSE of that opt-in (raw flag off, resolved flag on) — drives the same
  // ui.experimental_fuzzySearch pref as the options page
  getElementById("fuzzy-label").hidden = !(
    (state.ui.showExperimental ?? false) &&
    !featureEnabled(state.rawFeatures, "FUZZY_SEARCH") &&
    featureEnabled(state.features, "FUZZY_SEARCH")
  );
  getElementById("fuzzy-toggle").checked = state.ui.experimental_fuzzySearch ?? true;
  render(animate);
}
