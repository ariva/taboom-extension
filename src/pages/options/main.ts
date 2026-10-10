// Imperative shell: DOM + chrome.* effects only; view logic lives in model.js.
// Entry of the options page: boot, the page render, then the feature modules' init*()
// calls in the order this file used to register their listeners.
import { loadFeatures, loadState } from "../../app/storage.ts";
import { getReleaseVersion, markDevPage } from "../../app/env.ts";
import { closest, getElementById } from "../../lib/dom.ts";
import { aboutText } from "./model.ts";
import { registerRender, setFeatures } from "./page-state.ts";
// The feature modules register nothing when evaluated: each wires its listeners in an
// init*() called below, so their import order does not matter.
import { initSettingsForm, renderSettings } from "./settings-form.ts";
import { initUiPrefs, renderUiPrefs } from "./ui-prefs.ts";
import { initRules, renderRules } from "./rules.ts";
import { initKeepAlive, renderKeepAlive } from "./keep-alive.ts";
import { initPerfPanel } from "./perf-panel.ts";
import { initDangerZone, renderDangerZone } from "./danger-zone.ts";
import { initWhatsNew } from "./whats-new.ts";

markDevPage();
const FEATURES = await loadFeatures();
setFeatures(FEATURES);

async function render() {
  const state = await loadState();
  renderSettings(state);
  await renderRules(state);
  renderUiPrefs(state);
  await renderKeepAlive(state);
  await renderDangerZone();

  getElementById("about").textContent = aboutText(getReleaseVersion());
}
// the feature modules re-render through page-state.ts's forwarder
registerRender(render);

initSettingsForm();
initUiPrefs();
initRules();
initKeepAlive();

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

// rules/settings can change from the side panel or context menu while this page
// is open — but only re-render for keys this page shows (tabHistory changes on
// every tab switch and perfMetrics on every measured render; neither is shown)
chrome.storage.onChanged.addListener((changes) => {
  if (changes.settings || changes.protectionRules || changes.ui || changes.keepAlive) {
    render();
  }
});

initWhatsNew();
