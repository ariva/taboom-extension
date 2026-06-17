import { DEFAULTS } from "./core.js";

// Single flat read of chrome.storage.local with defaults merged in.
// Add migrateState() dispatch here when schemaVersion 2 exists.
export async function loadState() {
  const raw = await chrome.storage.local.get(null);
  return {
    schemaVersion: 1,
    settings: { ...DEFAULTS.settings, ...(raw.settings ?? {}) },
    protectionRules: raw.protectionRules ?? [],
    ui: { ...DEFAULTS.ui, ...(raw.ui ?? {}) },
  };
}

export async function saveState(patch) {
  await chrome.storage.local.set(patch);
}
