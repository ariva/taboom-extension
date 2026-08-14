import { DEFAULTS, makeRule } from "../core/core.js";
import { loadState, saveState } from "../core/storage.js";

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
    const input = document.getElementById(id);
    if (input.type === "checkbox") input.checked = state.settings[id];
    else input.value = state.settings[id];
  }

  const list = document.getElementById("rules");
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

  document.getElementById("fontSize").value = state.ui.fontSize ?? 1;
  document.getElementById("density").value = state.ui.density ?? "comfortable";
  document.getElementById("theme").value = state.ui.theme ?? "auto";
  applyTheme(state.ui.theme);

  document.getElementById("about").textContent =
    `Taboom ${chrome.runtime.getManifest().version}`;
}

async function saveSettings() {
  const settings = {};
  for (const id of SETTING_IDS) {
    const input = document.getElementById(id);
    const floor = Number(input.min) || 0;
    settings[id] =
      input.type === "checkbox" ? input.checked : Math.max(floor, Number(input.value) || floor);
  }
  await saveState({ settings });
  flashSaved();
}

// light-dark() colors resolve via color-scheme, so forcing it flips the palette
function applyTheme(theme) {
  document.documentElement.style.colorScheme = theme === "light" || theme === "dark" ? theme : "";
}

let savedTimer;
function flashSaved() {
  const el = document.getElementById("saved");
  el.hidden = false;
  clearTimeout(savedTimer);
  savedTimer = setTimeout(() => (el.hidden = true), 1200);
}

for (const id of SETTING_IDS) {
  document.getElementById(id).addEventListener("change", saveSettings);
}

document.getElementById("fontSize").addEventListener("change", async () => {
  const input = document.getElementById("fontSize");
  const fontSize = Math.min(1.5, Math.max(0.6, Number(input.value) || 1));
  input.value = fontSize;
  const state = await loadState();
  await saveState({ ui: { ...state.ui, fontSize } });
  flashSaved();
});

document.getElementById("density").addEventListener("change", async () => {
  const density = document.getElementById("density").value;
  const state = await loadState();
  await saveState({ ui: { ...state.ui, density } });
  flashSaved();
});

document.getElementById("theme").addEventListener("change", async () => {
  const theme = document.getElementById("theme").value;
  applyTheme(theme);
  const state = await loadState();
  await saveState({ ui: { ...state.ui, theme } });
  flashSaved();
});

document.getElementById("add-rule").addEventListener("click", async () => {
  const input = document.getElementById("new-rule");
  const rule = makeRule(input.value);
  if (!rule) return;
  const state = await loadState();
  if (!state.protectionRules.some((r) => r.pattern === rule.pattern)) {
    await saveState({ protectionRules: [...state.protectionRules, rule] });
    flashSaved();
  }
  input.value = "";
  render();
});

// chrome:// URLs can't be plain hrefs — open via tabs API
document.getElementById("links").addEventListener("click", (event) => {
  const link = event.target.closest("a[data-url]");
  if (!link) return;
  event.preventDefault();
  chrome.tabs.create({ url: link.dataset.url });
});

document.getElementById("danger").addEventListener("click", async () => {
  if (!confirm("Delete all Taboom settings and protection rules?")) return;
  await chrome.storage.local.clear();
  await saveState(structuredClone(DEFAULTS));
  render();
});

render();
