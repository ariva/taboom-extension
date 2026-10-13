import { createStorage } from "../lib/storage.ts";
import { DEFAULTS } from "./core.ts";
import {
  keepAliveEntry,
  nextReloadAt,
  restoreKeepAliveRemoval,
  setKeepAlivePaused,
  unmarkKeepAlive,
} from "./keep-alive.ts";
import {
  removedParkedSlice,
  removeParkedTabs,
  removeParkedWindow,
  renameParkedGroup,
  renameParkedWindow,
  restoreParkedRemoval,
} from "./parked.ts";
import { restoreRuleRemoval } from "./protection-rules.ts";
import { recordRemoval } from "./removal-trash.ts";
import type {
  AppState,
  Features,
  KeepAliveTab,
  LocalStorageSchema,
  ParkedWindow,
  ProtectionRule,
  SessionStorageSchema,
} from "./types.ts";

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
    keepAliveTrash: recordRemoval(keepAliveTrash, removed, Date.now()),
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

// The one door for dropping protection rules (chip ✕, Clear all, menu "Remove site
// protection", panel Unprotect): what leaves the list lands in the trash for Settings →
// Restore. Resolves to the rules now in force so the worker can reapply tab flags.
export async function dropProtectionRules(
  keep: (rules: ProtectionRule[]) => ProtectionRule[],
): Promise<ProtectionRule[]> {
  const { protectionRules = [], protectionTrash = [] } = await localStore.get(["protectionRules", "protectionTrash"]);
  const remaining = keep(protectionRules);
  const removed = protectionRules.filter((rule) => !remaining.includes(rule));
  if (removed.length === 0) {
    return protectionRules;
  }
  await localStore.set({
    protectionRules: remaining,
    protectionTrash: recordRemoval(protectionTrash, removed, Date.now()),
  });
  return remaining;
}

// Options "Restore last removal" (Protected Sites). False when the trash is empty.
export async function restoreProtectionRules(): Promise<boolean> {
  const { protectionRules = [], protectionTrash = [] } = await localStore.get(["protectionRules", "protectionTrash"]);
  const restored = restoreRuleRemoval(protectionRules, protectionTrash);
  if (!restored) {
    return false;
  }
  await localStore.set(restored);
  return true;
}

// ---------- parked windows: the only writers of storage.local.parkedWindows ----------

// the worker's park step, after the snapshot and before the window closes
export async function addParkedWindow(parked: ParkedWindow): Promise<void> {
  const { parkedWindows = [] } = await localStore.get("parkedWindows");
  await localStore.set({ parkedWindows: [...parkedWindows, parked] });
}

// one read-edit-write for every list edit; false when the edit changed nothing
async function editParked(edit: (list: ParkedWindow[]) => ParkedWindow[] | undefined): Promise<boolean> {
  const { parkedWindows = [] } = await localStore.get("parkedWindows");
  const next = edit(parkedWindows);
  if (!next) {
    return false;
  }
  await localStore.set({ parkedWindows: next });
  return true;
}

export function renameParked(id: string, name: string): Promise<boolean> {
  return editParked((list) => renameParkedWindow(list, id, name));
}

export function renameParkedGroupTitle(id: string, groupIndex: number, title: string): Promise<boolean> {
  return editParked((list) => renameParkedGroup(list, id, groupIndex, title));
}

// tabs moved into a live window (or forgotten one by one) leave the snapshot — not a removal, no trash
export function dropParkedTabs(id: string, indexes: number[]): Promise<boolean> {
  return editParked((list) => removeParkedTabs(list, id, indexes));
}

// Remove parked tab / group: the removed slice lands in the trash as its own entry, so Restore
// last removed can put it back into its window. False when nothing matched.
export async function removeParkedTabsToTrash(id: string, indexes: number[]): Promise<boolean> {
  const { parkedWindows = [], parkedTrash = [] } = await localStore.get(["parkedWindows", "parkedTrash"]);
  const parked = parkedWindows.find((entry) => entry.id === id);
  const slice = parked ? removedParkedSlice(parked, indexes) : undefined;
  const remaining = slice ? removeParkedTabs(parkedWindows, id, indexes) : undefined;
  if (!slice || !remaining) {
    return false;
  }
  await localStore.set({ parkedWindows: remaining, parkedTrash: recordRemoval(parkedTrash, [slice], Date.now()) });
  return true;
}

// Restore: the window comes back to life, so the entry simply goes (parking again recreates it)
export async function takeParkedWindow(id: string): Promise<ParkedWindow | undefined> {
  const { parkedWindows = [] } = await localStore.get("parkedWindows");
  const parked = parkedWindows.find((entry) => entry.id === id);
  if (!parked) {
    return undefined;
  }
  await localStore.set({ parkedWindows: parkedWindows.filter((entry) => entry !== parked) });
  return parked;
}

// Remove parked window: the one door that drops one on purpose — it lands in the trash for Undo remove
export async function forgetParkedWindow(id: string): Promise<boolean> {
  const { parkedWindows = [], parkedTrash = [] } = await localStore.get(["parkedWindows", "parkedTrash"]);
  const remaining = removeParkedWindow(parkedWindows, id);
  if (!remaining) {
    return false;
  }
  const removed = parkedWindows.filter((parked) => !remaining.includes(parked));
  await localStore.set({ parkedWindows: remaining, parkedTrash: recordRemoval(parkedTrash, removed, Date.now()) });
  return true;
}

export async function restoreParkedWindows(): Promise<boolean> {
  const { parkedWindows = [], parkedTrash = [] } = await localStore.get(["parkedWindows", "parkedTrash"]);
  const restored = restoreParkedRemoval(parkedWindows, parkedTrash);
  if (!restored) {
    return false;
  }
  await localStore.set(restored);
  return true;
}
