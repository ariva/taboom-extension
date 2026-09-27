// refresh(): loads tabs, tab groups, persisted state and window identity into `state`,
// syncs the flag-gated toolbar bits, then renders.
import { applyExperimental, featureEnabled, resolveColorScheme, resolveNavMode } from "../../../app/core.ts";
import { loadState, localStore, sessionStore } from "../../../app/storage.ts";
import type { AppState } from "../../../app/types.ts";
import { getElementById } from "../../../lib/dom.ts";
import { capabilities } from "../../../lib/platform/capabilities.ts";
import { sortSelect } from "../foundation/elements.ts";
import { deriveTabs } from "../model/index.ts";
import { render } from "../foundation/scheduler.ts";
import { effectiveSort, FLAG_GATED_SORTS, namesActive, state } from "../foundation/state.ts";
import type { PanelTab } from "../foundation/state.ts";

type TabGroup = chrome.tabGroups.TabGroup;

// animate only for user-initiated refreshes; background event echoes
// (tab/storage/focus changes — incl. renders triggered in OTHER open panels)
// re-render without a view transition
export async function refresh(animate = false, preloaded: AppState | null = null): Promise<void> {
  const [persisted, tabs, win, { windowProfiles = {} }, { windowSessionMap = {} }, groups] = await Promise.all([
    preloaded ?? loadState(), // startup passes its already-read state — no second read
    chrome.tabs.query({}),
    chrome.windows.getLastFocused(),
    localStore.get("windowProfiles"),
    sessionStore.get("windowSessionMap"),
    capabilities.tabGroups ? chrome.tabGroups.query({}).catch(() => []) : [],
  ]);
  state.tabGroups = new Map(groups.map((group): [number, TabGroup] => [group.id, group]));
  state.rules = persisted.protectionRules;
  state.ui = persisted.ui;
  document.documentElement.style.fontSize = `${state.ui.fontSize ?? 1}rem`;
  // light-dark() colors resolve via color-scheme, so forcing it flips the palette
  document.documentElement.style.colorScheme = resolveColorScheme(state.ui.theme);
  // focus moved to another window: the window grouping reorders (new current
  // window jumps to the top) — without a scroll the viewport stays mid-list
  // and the current group sits above it
  if (state.currentWindowId != null && win.id !== state.currentWindowId && effectiveSort() === "window") {
    state.followCurrent = true;
  }
  state.currentWindowId = win.id!; // live windows always have an id (only sessions-API windows lack one)
  state.allTabs = tabs as PanelTab[]; // chrome.tabs.query: every tab has an id — see PanelTab
  // tabs closed outside the panel (or id-swapped by discard) leave stale ids
  // in the selection — prune so counts and select-all stay truthful
  const liveIds = new Set(tabs.map((tab) => tab.id));
  for (const tabId of [...state.selected]) {
    if (!liveIds.has(tabId)) {
      state.selected.delete(tabId);
    }
  }
  state.derived = deriveTabs(tabs, state.rules);
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
