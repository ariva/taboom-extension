// Snoozing (tab discard): the auto-snooze alarm and its pass, manual snooze of
// one tab, and the manual-wake timestamps that reset the inactivity clock.
import { isSupportedUrl, selectAutoSnoozeTargets } from "../app/core.ts";
import { loadState, sessionStore } from "../app/storage.ts";
import type { Settings } from "../app/types.ts";

const ALARM_NAME = "auto-snooze";

export async function ensureAlarm(settings: Settings): Promise<void> {
  await chrome.alarms.create(ALARM_NAME, {
    periodInMinutes: Math.max(1, settings.checkIntervalMinutes),
  });
}

// alarms.onAlarm
export function onAlarm(alarm: chrome.alarms.Alarm): void {
  if (alarm.name === ALARM_NAME) {
    autoSnoozePass();
  }
}

export async function autoSnoozePass(): Promise<void> {
  const state = await loadState();
  if (!state.settings.autoSnoozeEnabled) {
    return;
  }
  const tabs = await chrome.tabs.query({});
  // manual wakes reset the inactivity clock (storage.session: survives SW
  // idle-death, gone with the browser session like the tabs themselves)
  const { wakeTimes = {} } = await sessionStore.get("wakeTimes");
  const openIds = new Set(tabs.map((tab) => tab.id));
  const pruned = Object.fromEntries(Object.entries(wakeTimes).filter(([tabId]) => openIds.has(Number(tabId))));
  if (Object.keys(pruned).length !== Object.keys(wakeTimes).length) {
    await sessionStore.set({ wakeTimes: pruned });
  }
  await Promise.allSettled(
    selectAutoSnoozeTargets(tabs, state.settings, state.protectionRules, Date.now(), pruned).map((tabId) =>
      chrome.tabs.discard(tabId).catch((error) => console.debug("discard failed", tabId, error)),
    ),
  );
}

// manual wake — restart the inactivity clock for these tabs
export async function recordWakes(tabIds: number[]): Promise<void> {
  const { wakeTimes = {} } = await sessionStore.get("wakeTimes");
  const now = Date.now();
  for (const tabId of tabIds) {
    wakeTimes[tabId] = now;
  }
  return sessionStore.set({ wakeTimes });
}

export async function snoozeTab(tabId: number): Promise<void> {
  const tab = await chrome.tabs.get(tabId);
  if (tab.discarded || !isSupportedUrl(tab.url)) {
    return;
  }
  if (tab.active) {
    // Chrome refuses to discard the active tab; activate a neighbor first.
    const tabs = await chrome.tabs.query({ windowId: tab.windowId });
    const other = tabs.find((t) => t.id !== tabId && !t.discarded) ?? tabs.find((t) => t.id !== tabId);
    if (other) {
      await chrome.tabs.update(other.id, { active: true });
    } else {
      // lone tab in window — open a new tab to take focus so the snooze still happens
      await chrome.tabs.create({ windowId: tab.windowId, active: true });
    }
  }
  // discard() resolves with the post-discard Tab (its id may change!)
  let result: chrome.tabs.Tab | undefined;
  try {
    result = await chrome.tabs.discard(tabId);
  } catch {
    // right after switching focus Chrome may briefly still treat the tab as
    // active — retry once; a second failure propagates to the caller's UI
    await new Promise((resolve) => setTimeout(resolve, 200));
    result = await chrome.tabs.discard(tabId);
  }
  if (result && !result.discarded) {
    throw new Error("Chrome refused to discard this tab (playing audio or capturing media?)");
  }
}
