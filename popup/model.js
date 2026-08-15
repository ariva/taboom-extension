// Pure view logic for the popup - easier to test.
import { hostnameOf, isProtected } from "../core/core.js";

export function currentLine(tab) {
  return `Current: ${tab?.title ?? "—"}`;
}

// label/state for the protect button; disabled when the tab has no host
export function protectAction(tab, rules) {
  const host = tab ? hostnameOf(tab.url) : "";
  if (!host) return { disabled: true, label: null };
  return {
    disabled: false,
    label: `${isProtected(tab.url, rules) ? "Unprotect" : "Protect"} ${host}`,
  };
}

export function statsLine(tabs, settings, rules) {
  return (
    `Auto snooze: ${settings.autoSnoozeEnabled ? "ON" : "OFF"} · ` +
    `Open: ${tabs.length} · Snoozed: ${tabs.filter((t) => t.discarded).length} · ` +
    `Protected: ${tabs.filter((t) => isProtected(t.url, rules)).length}`
  );
}
