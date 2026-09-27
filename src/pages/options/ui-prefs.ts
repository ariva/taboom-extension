// Appearance + behaviour prefs (state.ui): fills the fields, hides the ones whose feature
// flag is off, applies the theme, and persists each change through one merge point.
import { applyExperimental, featureEnabled, resolveColorScheme, resolveNavMode } from "../../app/core.ts";
import { loadState, saveState } from "../../app/storage.ts";
import type { AppState, FeatureName, UiPrefs } from "../../app/types.ts";
import { getElementById, mustQuery } from "../../lib/dom.ts";
import { clampFontSize } from "./model.ts";
import { flashSaved, getFeatures } from "./page-state.ts";

export function renderUiPrefs(state: AppState): void {
  const FEATURES = getFeatures();
  getElementById("fontSize").value = String(state.ui.fontSize ?? 1);
  getElementById("density").value = state.ui.density ?? "comfortable";
  getElementById("sortDirMode").value = state.ui.sortDirMode ?? "default";
  getElementById("groupByWindowTabsOrder").value = state.ui.groupByWindowTabsOrder ?? "same-as-window";
  getElementById("searchEmptyFilter").value = state.ui.searchEmptyFilter ?? "keep";
  getElementById("theme").value = state.ui.theme ?? "auto";
  getElementById("showExperimental").checked = state.ui.showExperimental ?? false;
  getElementById("hideUpdateBanner").checked = state.ui.hideUpdateBanner ?? false;
  getElementById("windowNamesEnabled").checked = state.ui.windowNamesEnabled ?? true;
  getElementById("onExtensionUpdate").value = state.ui.onExtensionUpdate ?? "banner";
  getElementById("experimental_fuzzySearch").checked = state.ui.experimental_fuzzySearch ?? true;

  const appliedFeatures = applyExperimental(FEATURES, state.ui.showExperimental ?? false);
  getElementById("historyNav-label").hidden = !featureEnabled(appliedFeatures, "OPTIONS_NAVIGATION_STACK");
  getElementById("windowNamesEnabled-label").hidden = !featureEnabled(appliedFeatures, "WINDOW_NAMES");
  // The dropdown shows the EFFECTIVE mode, not the raw stored value: a stored
  // mode whose flag got disabled falls back (traditional ↔ compact, disabled
  // when neither is available). The stored preference itself is NOT rewritten,
  // so re-enabling the flag restores the user's original choice.
  const mode = resolveNavMode(appliedFeatures, state.ui);
  getElementById("historyNav").value = mode === "off" ? "disabled" : mode;
  // modes whose feature flag is off aren't offered
  for (const [value, flag] of [
    ["traditional", "NAVIGATION_TRADITIONAL_STACK"],
    ["compact", "NAVIGATION_COMPACT_STACK"],
  ] satisfies [string, FeatureName][]) {
    mustQuery(document, `#historyNav option[value="${value}"]`).hidden = !featureEnabled(appliedFeatures, flag);
  }
  getElementById("searchEmptyFilter-label").hidden = !featureEnabled(appliedFeatures, "SEARCH_AUTO_SELECT_ALL");
  // offered only when experimental features are on AND FUZZY_SEARCH is enabled
  // BECAUSE of that opt-in (raw flag off, resolved flag on) — once the flag
  // ships enabled the pref is ignored and the toggle goes away
  getElementById("experimental_fuzzySearch-label").hidden = !(
    (state.ui.showExperimental ?? false) &&
    !featureEnabled(FEATURES, "FUZZY_SEARCH") &&
    featureEnabled(appliedFeatures, "FUZZY_SEARCH")
  );
  const allowExperimental = featureEnabled(appliedFeatures, "ALLOW_EXPERIMENTAL");
  getElementById("showExperimental-label").hidden = !allowExperimental;
  getElementById("experimental-warning").hidden = !(allowExperimental && (state.ui.showExperimental ?? false));
  getElementById("perf-section").hidden = !featureEnabled(appliedFeatures, "SHOW_PERFORMANCE_INFO");
  applyTheme(state.ui.theme);
}

// light-dark() colors resolve via color-scheme, so forcing it flips the palette
export function applyTheme(theme: string | undefined) {
  document.documentElement.style.colorScheme = resolveColorScheme(theme);
}

// Single merge point for ui writes: re-reads right before writing so a
// concurrent writer (the side panel persisting filter/scope/sort) is far less
// likely to be clobbered by a whole-object overwrite from a stale read.
async function saveUiPatch(patch: Partial<UiPrefs>) {
  const state = await loadState();
  await saveState({ ui: { ...state.ui, ...patch } });
  flashSaved();
}

// element id doubles as the ui key; parse cleans the raw value, apply gives
// immediate feedback before the write round-trips
type UiValue = string | number | boolean;
interface UiField {
  id: keyof UiPrefs;
  prop: "value" | "checked";
  parse?: (value: string) => UiValue;
  apply?: (value: UiValue, input: HTMLInputElement) => void;
}
const UI_FIELDS: UiField[] = [
  {
    id: "fontSize",
    prop: "value",
    parse: clampFontSize,
    apply: (v, input) => {
      input.value = String(v);
    },
  },
  { id: "density", prop: "value" },
  { id: "sortDirMode", prop: "value" },
  { id: "groupByWindowTabsOrder", prop: "value" },
  { id: "searchEmptyFilter", prop: "value" },
  { id: "theme", prop: "value", apply: (v) => applyTheme(String(v)) },
  { id: "historyNav", prop: "value" },
  { id: "showExperimental", prop: "checked" },
  { id: "hideUpdateBanner", prop: "checked" },
  { id: "windowNamesEnabled", prop: "checked" },
  { id: "onExtensionUpdate", prop: "value" },
  { id: "experimental_fuzzySearch", prop: "checked" },
];

export function initUiPrefs(): void {
  for (const { id, prop, parse, apply } of UI_FIELDS) {
    getElementById(id).addEventListener("change", async () => {
      const input = getElementById(id);
      const raw = input[prop];
      const value = parse && typeof raw === "string" ? parse(raw) : raw;
      apply?.(value, input);
      await saveUiPatch({ [id]: value });
    });
  }
}
