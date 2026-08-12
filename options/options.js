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
    remove.textContent = "Remove";
    remove.addEventListener("click", async () => {
      await saveState({
        protectionRules: state.protectionRules.filter((r) => r.id !== rule.id),
      });
      render();
    });
    li.append(span, remove);
    list.append(li);
  }

  document.getElementById("fontSize").value = state.ui.fontSize ?? 1;

  document.getElementById("about").textContent =
    `TabsManager ${chrome.runtime.getManifest().version}`;
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
});

document.getElementById("add-rule").addEventListener("click", async () => {
  const input = document.getElementById("new-rule");
  const rule = makeRule(input.value);
  if (!rule) return;
  const state = await loadState();
  if (!state.protectionRules.some((r) => r.pattern === rule.pattern)) {
    await saveState({ protectionRules: [...state.protectionRules, rule] });
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
  if (!confirm("Delete all TabsManager settings and protection rules?")) return;
  await chrome.storage.local.clear();
  await saveState(structuredClone(DEFAULTS));
  render();
});

render();
