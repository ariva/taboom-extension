import { createStorage } from "../lib/storage.ts";
import { DEFAULTS } from "./core.ts";
import {
  keepAliveEntry,
  nextReloadAt,
  recordKeepAliveRemoval,
  restoreKeepAliveRemoval,
  setKeepAlivePaused,
  unmarkKeepAlive,
} from "./keep-alive.ts";
import type { AppState, Features, KeepAliveTab, LocalStorageSchema, SessionStorageSchema } from "./types.ts";

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

// the one door for dropping marks: what leaves the list lands in the trash, so
// Settings → Restore can undo any removal (row, menu, worker, Clear all), newest first
async function writeRemoval(next: (keepAlive: KeepAliveTab[]) => KeepAliveTab[] | undefined): Promise<boolean> {
  const { keepAlive = [], keepAliveTrash = [] } = await localStore.get(["keepAlive", "keepAliveTrash"]);
  const remaining = next(keepAlive);
  if (!remaining) {
    return false;
  }
  const removed = keepAlive.filter((entry) => !remaining.includes(entry));
  await localStore.set({
    keepAlive: remaining,
    keepAliveTrash: recordKeepAliveRemoval(keepAliveTrash, removed, Date.now()),
  });
  return true;
}

// Drop the marks behind these pages (options Remove, side panel menus, worker unmark). False when none matched.
export function removeKeepAlive(urls: (string | undefined)[]): Promise<boolean> {
  return writeRemoval((keepAlive) => unmarkKeepAlive(keepAlive, urls));
}

// Options "Clear all". False when the list was already empty.
export function clearKeepAlive(): Promise<boolean> {
  return writeRemoval((keepAlive) => (keepAlive.length === 0 ? undefined : []));
}

// Options "Restore last removal". False when the trash is empty.
export async function restoreKeepAlive(): Promise<boolean> {
  const { keepAlive = [], keepAliveTrash = [] } = await localStore.get(["keepAlive", "keepAliveTrash"]);
  const restored = restoreKeepAliveRemoval(keepAlive, keepAliveTrash, Date.now());
  if (!restored) {
    return false;
  }
  await localStore.set(restored);
  return true;
}
