import { hostnameOf, isProtected } from "../core/core.js";
import { loadState } from "../core/storage.js";

const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
const state = await loadState();

document.getElementById("current").textContent = `Current: ${tab?.title ?? "—"}`;

const protectButton = document.getElementById("protect-site");
const host = tab ? hostnameOf(tab.url) : "";
if (host) {
  protectButton.textContent = isProtected(tab.url, state.protectionRules)
    ? `🛡 Unprotect ${host}`
    : `🛡 Protect ${host}`;
} else {
  protectButton.disabled = true;
}

const tabs = await chrome.tabs.query({});
document.getElementById("stats").textContent =
  `Auto snooze: ${state.settings.autoSnoozeEnabled ? "ON" : "OFF"} · ` +
  `Open: ${tabs.length} · Snoozed: ${tabs.filter((t) => t.discarded).length} · ` +
  `Protected: ${tabs.filter((t) => isProtected(t.url, state.protectionRules)).length}`;

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
