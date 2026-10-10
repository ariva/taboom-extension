import { createStorage } from "../lib/storage.ts";
import { DEFAULTS } from "./core.ts";
import { keepAliveEntry, nextReloadAt, setKeepAlivePaused, unmarkKeepAlive } from "./keep-alive.ts";
import type { AppState, Features, LocalStorageSchema, SessionStorageSchema } from "./types.ts";

// the only doors to chrome.storage — keys and value types come from the schemas
export const localStore = createStorage<LocalStorageSchema>("local");
export const sessionStore = createStorage<SessionStorageSchema>("session");

// features.json at extension root is the single source of truth — flip flags
// there while developing, then reload. Pass a features object to skip the fetch.
export async function loadFeatures(testFeatures?: Features): Promise<Features> {
  if (testFeatures) {
    return testFeatures;
  }
  try {
    const response = await fetch(chrome.runtime.getURL("features.json"));
    return await response.json();
  } catch {
    return {}; // fail-closed: unknown flags read as disabled
  }
}

// One targeted read of the state keys with defaults merged in — not get(null),
// which would also deserialize perfMetrics/perfSnapshots/tabHistory every call.
// Add migrateState() dispatch here when schemaVersion 2 exists.
export async function loadState(): Promise<AppState> {
  const raw = await localStore.get(["settings", "protectionRules", "ui"]);
  return {
    schemaVersion: 1,
    settings: { ...DEFAULTS.settings, ...(raw.settings ?? {}) },
    protectionRules: raw.protectionRules ?? [],
    ui: { ...DEFAULTS.ui, ...(raw.ui ?? {}) },
  };
}

export async function saveState(patch: Partial<AppState>): Promise<void> {
  await localStore.set(patch);
}

// Pause / resume the marks behind these pages (options row checkbox, side panel row
// menu). Either way the schedule restarts from now. False when nothing changed.
export async function pauseKeepAlive(urls: (string | undefined)[], paused: boolean): Promise<boolean> {
  const { keepAlive = [] } = await localStore.get("keepAlive");
  const now = Date.now();
  let next: typeof keepAlive | undefined;
  for (const url of urls) {
    const entry = keepAliveEntry(next ?? keepAlive, url);
    if (entry) {
      next = setKeepAlivePaused(next ?? keepAlive, entry.url, paused, nextReloadAt(entry.minutes, now)) ?? next;
    }
  }
  if (!next) {
    return false;
  }
  await localStore.set({ keepAlive: next });
  return true;
}

// Drop the marks behind these pages (options Remove, side panel mark menu). False when none matched.
export async function removeKeepAlive(urls: (string | undefined)[]): Promise<boolean> {
  const { keepAlive = [] } = await localStore.get("keepAlive");
  const next = unmarkKeepAlive(keepAlive, urls);
  if (!next) {
    return false;
  }
  await localStore.set({ keepAlive: next });
  return true;
}
