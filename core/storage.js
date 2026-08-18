import { DEFAULTS } from "./core.js";

// features.json at extension root is the single source of truth — flip flags
// there while developing, then reload. Pass a features object to skip the fetch.
export async function loadFeatures(testFeatures) {
  if (testFeatures) return testFeatures;
  try {
    const response = await fetch(chrome.runtime.getURL("features.json"));
    return await response.json();
  } catch {
    return {}; // fail-closed: unknown flags read as disabled
  }
}

/** @typedef {{ id: string, type: "host" | "domain", pattern: string, createdAt: number }} Rule */

// One targeted read of the state keys with defaults merged in — not get(null),
// which would also deserialize perfMetrics/perfSnapshots/tabHistory every call.
// Add migrateState() dispatch here when schemaVersion 2 exists.
/** @returns {Promise<{schemaVersion: number, settings: typeof DEFAULTS.settings, protectionRules: Rule[], ui: typeof DEFAULTS.ui}>} */
export async function loadState() {
  const raw = /** @type {Record<string, any>} */ (
    await chrome.storage.local.get(["settings", "protectionRules", "ui"])
  );
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
