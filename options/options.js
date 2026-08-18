// Imperative shell: DOM + chrome.* effects only; view logic lives in model.js.
import {
  applyExperimental,
  DEFAULTS,
  featureEnabled,
  makeRule,
  resolveColorScheme,
} from "../core/core.js";
import { getElementById } from "../core/dom.js";
import { loadFeatures, loadState, saveState } from "../core/storage.js";

const FEATURES = await loadFeatures();
import {
  aboutText,
  clampFontSize,
  clampedNumber,
  hasRule,
  releaseSections,
  snapshotBlocks,
} from "./model.js";

const SETTING_IDS = [
  "autoSnoozeEnabled",
  "inactivityMinutes",
  "checkIntervalMinutes",
  "excludePinned",
  "excludeAudible",
  "minAwakePerWindow",
];

async function render() {
  const state = await loadState();
  for (const id of SETTING_IDS) {
    const input = getElementById(id);
    if (input.type === "checkbox") input.checked = Boolean(state.settings[id]);
    else input.value = String(state.settings[id]);
  }

  const list = getElementById("rules");
  list.textContent = "";
  if (state.protectionRules.length === 0) {
    const li = document.createElement("li");
    li.className = "muted";
    li.textContent = "No protected sites yet.";
    list.append(li);
  }
  for (const rule of state.protectionRules) {
    const li = document.createElement("li");
    const span = document.createElement("span");
    span.textContent = rule.pattern;
    const remove = document.createElement("button");
    remove.innerHTML =
      '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M4 4l8 8M12 4l-8 8"/></svg>';
    remove.title = remove.ariaLabel = `Remove ${rule.pattern}`;
    remove.addEventListener("click", async () => {
      await saveState({
        protectionRules: state.protectionRules.filter((r) => r.id !== rule.id),
      });
      flashSaved();
      render();
    });
    li.append(span, remove);
    list.append(li);
  }

  getElementById("fontSize").value = String(state.ui.fontSize ?? 1);
  getElementById("density").value = state.ui.density ?? "comfortable";
  getElementById("theme").value = state.ui.theme ?? "auto";
  getElementById("historyNav").checked = state.ui.historyNav ?? true;
  getElementById("showExperimental").checked = state.ui.showExperimental ?? false;

  const features = applyExperimental(FEATURES, state.ui.showExperimental ?? false);
  getElementById("historyNav-label").hidden =
    !featureEnabled(features, "OPTIONS_NAVIGATION_STACK");
  const allowExperimental = featureEnabled(features, "ALLOW_EXPERIMENTAL");
  getElementById("showExperimental-label").hidden = !allowExperimental;
  getElementById("experimental-warning").hidden =
    !(allowExperimental && (state.ui.showExperimental ?? false));
  getElementById("perf-section").hidden =
    !featureEnabled(features, "SHOW_PERFORMANCE_INFO");
  applyTheme(state.ui.theme);

  getElementById("about").textContent = aboutText(chrome.runtime.getManifest().version);
}

async function saveSettings() {
  const settings = {};
  for (const id of SETTING_IDS) {
    const input = getElementById(id);
    settings[id] =
      input.type === "checkbox"
        ? input.checked
        : clampedNumber(input.value, Number(input.min) || 0);
  }
  await saveState({ settings });
  flashSaved();
}

// light-dark() colors resolve via color-scheme, so forcing it flips the palette
function applyTheme(theme) {
  document.documentElement.style.colorScheme = resolveColorScheme(theme);
}

let savedTimer;
function flashSaved() {
  const el = getElementById("saved");
  el.hidden = false;
  clearTimeout(savedTimer);
  savedTimer = setTimeout(() => (el.hidden = true), 1200);
}

for (const id of SETTING_IDS) {
  getElementById(id).addEventListener("change", saveSettings);
}

getElementById("fontSize").addEventListener("change", async () => {
  const input = getElementById("fontSize");
  const fontSize = clampFontSize(input.value);
  input.value = String(fontSize);
  const state = await loadState();
  await saveState({ ui: { ...state.ui, fontSize } });
  flashSaved();
});

getElementById("density").addEventListener("change", async () => {
  const density = getElementById("density").value;
  const state = await loadState();
  await saveState({ ui: { ...state.ui, density } });
  flashSaved();
});

getElementById("historyNav").addEventListener("change", async () => {
  const historyNav = getElementById("historyNav").checked;
  const state = await loadState();
  await saveState({ ui: { ...state.ui, historyNav } });
  flashSaved();
});

getElementById("showExperimental").addEventListener("change", async () => {
  const showExperimental = getElementById("showExperimental").checked;
  const state = await loadState();
  await saveState({ ui: { ...state.ui, showExperimental } });
  flashSaved();
});


getElementById("theme").addEventListener("change", async () => {
  const theme = getElementById("theme").value;
  applyTheme(theme);
  const state = await loadState();
  await saveState({ ui: { ...state.ui, theme } });
  flashSaved();
});

getElementById("add-rule").addEventListener("click", async () => {
  const input = getElementById("new-rule");
  const rule = makeRule(input.value);
  if (!rule) return;
  const state = await loadState();
  if (!hasRule(state.protectionRules, rule.pattern)) {
    await saveState({ protectionRules: [...state.protectionRules, rule] });
    flashSaved();
  }
  input.value = "";
  render();
});

// chrome:// URLs can't be plain hrefs — open via tabs API
getElementById("links").addEventListener("click", (event) => {
  const link = /** @type {HTMLElement | null} */ (
    /** @type {HTMLElement} */ (event.target).closest("a[data-url]")
  );
  if (!link) return;
  event.preventDefault();
  chrome.tabs.create({ url: link.dataset.url });
});

const PERF_SNAPSHOTS_MAX = 20;

// each Show click snapshots the current metrics, so the list shows evolution over time
getElementById("perf-show").addEventListener("click", async () => {
  const { perfMetrics = {}, perfSnapshots = [] } = /** @type {Record<string, any>} */ (
    await chrome.storage.local.get(["perfMetrics", "perfSnapshots"])
  );
  let snapshots = perfSnapshots;
  if (Object.keys(perfMetrics).length > 0) {
    snapshots = [...perfSnapshots, { at: Date.now(), metrics: perfMetrics }].slice(
      -PERF_SNAPSHOTS_MAX,
    );
    await chrome.storage.local.set({ perfSnapshots: snapshots });
  }
  getElementById("perf-out").textContent =
    snapshotBlocks(snapshots).join("\n\n") || "No metrics recorded yet.";
});

// running counters restart; stored snapshot history stays for comparison
getElementById("perf-reset-snapshot").addEventListener("click", async () => {
  await chrome.storage.local.remove("perfMetrics");
  flashSaved();
});

getElementById("perf-reset").addEventListener("click", async () => {
  await chrome.storage.local.remove(["perfMetrics", "perfSnapshots"]);
  getElementById("perf-out").textContent = "";
  flashSaved();
});

getElementById("danger").addEventListener("click", async () => {
  if (!confirm("Delete all Taboom settings and protection rules?")) return;
  await chrome.storage.local.clear();
  await saveState(structuredClone(DEFAULTS));
  render();
});

render();

// rules/settings can change from the side panel or context menu while this page is open
chrome.storage.onChanged.addListener(() => render());

// What's new: bundled CHANGES.md — one collapsible per release, newest open
fetch(chrome.runtime.getURL("CHANGES.md"))
  .then((response) => response.text())
  .then((markdown) => {
    const sections = releaseSections(markdown);
    if (sections.length === 0) return;
    const box = getElementById("whats-new");
    for (const [index, section] of sections.entries()) {
      const details = document.createElement("details");
      details.open = index === 0;
      const summary = document.createElement("summary");
      summary.textContent = index === 0 ? `What's new — ${section.title}` : section.title;
      const pre = document.createElement("pre");
      pre.className = "muted";
      pre.textContent = section.body;
      details.append(summary, pre);
      box.append(details);
    }
    box.hidden = false;
  })
  .catch(() => {}); // CHANGES.md missing from a dev checkout — section stays hidden
