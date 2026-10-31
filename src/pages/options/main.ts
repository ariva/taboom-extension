// Imperative shell: DOM + chrome.* effects only; view logic lives in model.js.
// Entry of the options page: boot, the page render, then the feature modules' init*()
// calls in the order this file used to register their listeners.
import { loadFeatures, loadState } from "../../app/storage.ts";
import type { Features, UiPrefs } from "../../app/types.ts";
import { getReleaseVersion, markDevPage } from "../../app/env.ts";
import { closest, getElementById } from "../../lib/dom.ts";
import { aboutText, settingsTitle } from "./model.ts";
import { registerRender, setFeatures } from "./page-state.ts";
// The feature modules register nothing when evaluated: each wires its listeners in an
// init*() called below, so their import order does not matter.
import { initSettingsForm, renderSettings } from "./settings-form.ts";
import { initUiPrefs, renderUiPrefs } from "./ui-prefs.ts";
import { initRules, renderRules } from "./rules.ts";
import { initKeepAlive, renderKeepAlive } from "./keep-alive.ts";
import { initTags, renderTags } from "./tags.ts";
import { initPerfPanel } from "./perf-panel.ts";
import { initDangerZone, renderDangerZone } from "./danger-zone.ts";
import { initWhatsNew } from "./whats-new.ts";

// before markDevPage: the dev prefix goes in front of the final heading
getElementById("page-title").textContent = settingsTitle(getReleaseVersion());
markDevPage();
const FEATURES = await loadFeatures().catch((): Features => ({})); // fail-closed for this page load: every flag off
setFeatures(FEATURES);

async function render() {
  const state = await loadState();
  renderSettings(state);
  await renderRules(state);
  renderUiPrefs(state);
  await renderKeepAlive(state);
  await renderTags(state);
  await renderDangerZone();

  getElementById("about").textContent = aboutText(getReleaseVersion());
}
// the feature modules re-render through page-state.ts's forwarder
registerRender(render);

initSettingsForm();
initUiPrefs();
initRules();
initKeepAlive();
initTags();

// chrome:// URLs can't be plain hrefs — open via tabs API
getElementById("links").addEventListener("click", (event) => {
  const link = closest(event.target, "a[data-url]");
  if (!link) {
    return;
  }
  event.preventDefault();
  chrome.tabs.create({ url: link.dataset.url });
});

initPerfPanel();
initDangerZone();

render();

// rules / settings change from the side panel, the context menu and the worker while this page is
// open. One card per key: the keep-alive sweep writes every 30 s while a mark is due and every
// panel chip click writes `ui` — neither is a reason to rebuild every table (and end an edit in one)
const PANEL_VIEW_KEYS: (keyof UiPrefs)[] = [
  "defaultFilter",
  "scope",
  "sort",
  "sortDirections",
  "quickLaunchGroupOrder",
];
function uiMovedBeyondPanelView(change: chrome.storage.StorageChange): boolean {
  // StorageChange values are `unknown`; "ui" is only ever written whole, as UiPrefs
  const before = change.oldValue as Partial<UiPrefs> | undefined;
  const after = change.newValue as Partial<UiPrefs> | undefined;
  if (!before || !after) {
    return true; // first write, a cleared store: no diff to trust
  }
  const keys = new Set([...Object.keys(before), ...Object.keys(after)]) as Set<keyof UiPrefs>;
  return [...keys].some(
    (key) => !PANEL_VIEW_KEYS.includes(key) && JSON.stringify(before[key]) !== JSON.stringify(after[key]),
  );
}
chrome.storage.onChanged.addListener(async (changes, area) => {
  if (area !== "local") {
    return;
  }
  const ui = changes.ui;
  if (ui && uiMovedBeyondPanelView(ui)) {
    await render(); // flags, theme, table sorts: every card may move
    return;
  }
  const has = (...keys: string[]) => keys.some((key) => key in changes);
  const cards = {
    settings: has("settings"),
    rules: has("protectionRules", "protectionTrash"),
    keepAlive: has("keepAlive", "keepAliveTrash", "settings"), // settings: the keep-alive switch hides the card body
    tags: has("tags", "tagPages", "tagTrash"),
    // the undo stacks drive the Restore buttons and "Clear restore data" — an undo or a removal made in
    // the side panel (parked windows, keep-alive, unprotect) must show here too
    danger: has("keepAliveTrash", "protectionTrash", "parkedTrash", "tagTrash"),
  };
  if (!Object.values(cards).some(Boolean)) {
    return;
  }
  const state = await loadState();
  if (cards.settings) {
    renderSettings(state);
  }
  if (cards.rules) {
    await renderRules(state);
  }
  if (cards.keepAlive) {
    await renderKeepAlive(state);
  }
  if (cards.tags) {
    await renderTags(state);
  }
  if (cards.danger) {
    await renderDangerZone();
  }
});

initWhatsNew();
