// Imperative shell: DOM + chrome.* effects only; view logic lives in model.js.
import { resolveColorScheme } from "../core/core.js";
import { loadState } from "../core/storage.js";
import { currentLine, protectAction, statsLine } from "./model.js";

const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
const state = await loadState();

document.documentElement.style.colorScheme = resolveColorScheme(state.ui.theme);

document.getElementById("current").textContent = currentLine(tab);

const protectButton = document.getElementById("protect-site");
const protect = protectAction(tab, state.protectionRules);
if (protect.disabled) {
  protectButton.disabled = true;
} else {
  document.getElementById("protect-label").textContent = protect.label;
}

const tabs = await chrome.tabs.query({});
document.getElementById("stats").textContent = statsLine(tabs, state.settings, state.protectionRules);

document.getElementById("snooze").addEventListener("click", async () => {
  const response = await chrome.runtime.sendMessage({ type: "snooze-tab", tabId: tab.id });
  if (response?.error) {
    document.getElementById("current").textContent = `⚠ ${response.error}`;
    return;
  }
  window.close();
});

protectButton.addEventListener("click", async () => {
  await chrome.runtime.sendMessage({ type: "toggle-site-protection", tabId: tab.id });
  window.close();
});

document.getElementById("open-manager").addEventListener("click", async () => {
  await chrome.sidePanel.open({ windowId: tab.windowId });
  window.close();
});
