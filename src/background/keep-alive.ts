// Keep-it-alive: the 30 s sweep alarm that reloads marked pages when their
// jittered time comes, the mark/unmark entry points (menu, panel message) and
// the checkbox menu item's state.
import { applyExperimental, DEFAULTS, featureEnabled } from "../app/core.ts";
import {
  dueKeepAlive,
  isKeptAlive,
  keepAliveKey,
  markKeepAlive,
  nextReloadAt,
  rearmAllKeepAlive,
  rearmKeepAlive,
  unmarkKeepAlive,
} from "../app/keep-alive.ts";
import { loadState, localStore } from "../app/storage.ts";
import type { KeepAliveTab, Settings } from "../app/types.ts";
import { enqueueMenuOp } from "./context-menus.ts";
import { getFeatures } from "./nav-mode.ts";

const ALARM_NAME = "keep-alive";
export const KEEP_ALIVE_MENU_ID = "keep-alive-tab";
// one alarm for every mark: each entry carries its own due time, the sweep
// only has to look often enough — 30 s is the MV3 floor
const SWEEP_MINUTES = 0.5;

// flag (experimental opt-in applied) + the user's checkbox
export async function keepAliveActive(): Promise<boolean> {
  const [{ settings, ui }, features] = await Promise.all([loadState(), getFeatures()]);
  return (
    featureEnabled(applyExperimental(features, ui.showExperimental ?? false), "KEEP_ALIVE") && settings.keepAliveEnabled
  );
}

// the marks the sweep and the snooze pass honour: none while the feature is off
export async function activeKeepAliveList(): Promise<KeepAliveTab[]> {
  if (!(await keepAliveActive())) {
    return [];
  }
  const { keepAlive = [] } = await localStore.get("keepAlive");
  return keepAlive;
}

export async function ensureKeepAliveAlarm(): Promise<void> {
  if ((await activeKeepAliveList()).length === 0) {
    await chrome.alarms.clear(ALARM_NAME);
    return;
  }
  await chrome.alarms.create(ALARM_NAME, { periodInMinutes: SWEEP_MINUTES });
}

// alarms.onAlarm
export function onKeepAliveAlarm(alarm: chrome.alarms.Alarm): void {
  if (alarm.name === ALARM_NAME) {
    keepAlivePass();
  }
}

export async function keepAlivePass(): Promise<void> {
  const list = await activeKeepAliveList();
  const now = Date.now();
  const due = dueKeepAlive(list, now);
  if (due.length === 0) {
    return;
  }
  const tabs = await chrome.tabs.query({});
  let next = list;
  for (const entry of due) {
    // every tab on the page reloads; a mark whose page is closed stays armed
    // (and quiet) until the user removes it in Options
    const targets = tabs.flatMap((tab) =>
      tab.id !== undefined && keepAliveKey(tab.url) === entry.url ? [tab.id] : [],
    );
    await Promise.allSettled(
      targets.map((tabId) =>
        chrome.tabs.reload(tabId).catch((error) => console.debug("keep-alive reload failed", tabId, error)),
      ),
    );
    next = rearmKeepAlive(next, entry.url, nextReloadAt(entry.minutes, now));
  }
  await localStore.set({ keepAlive: next });
}

export async function setTabsKeepAlive(tabs: chrome.tabs.Tab[], kept: boolean): Promise<void> {
  if (!(await keepAliveActive())) {
    return;
  }
  const [{ settings }, { keepAlive = [] }] = await Promise.all([loadState(), localStore.get("keepAlive")]);
  const next = kept
    ? markKeepAlive(keepAlive, tabs, settings.keepAliveMinutes, nextReloadAt(settings.keepAliveMinutes, Date.now()))
    : unmarkKeepAlive(
        keepAlive,
        tabs.map((tab) => tab.url),
      );
  if (!next) {
    return;
  }
  await localStore.set({ keepAlive: next });
  await ensureKeepAliveAlarm();
  await syncKeepAliveMenu(tabs.find((tab) => tab.active));
}

// context menu click: flip the clicked page
export async function toggleTabKeepAlive(tab: chrome.tabs.Tab): Promise<void> {
  const { keepAlive = [] } = await localStore.get("keepAlive");
  await setTabsKeepAlive([tab], !isKeptAlive(keepAlive, tab.url));
}

// Keep the checkbox item matching the active tab's mark.
export async function syncKeepAliveMenu(tab: chrome.tabs.Tab | null | undefined): Promise<void> {
  if (!tab || keepAliveKey(tab.url) === "") {
    return;
  }
  const checked = isKeptAlive(await activeKeepAliveList(), tab.url);
  await enqueueMenuOp(
    () =>
      new Promise((resolve) =>
        chrome.contextMenus.update(KEEP_ALIVE_MENU_ID, { checked }, () => {
          void chrome.runtime.lastError; // item absent while the feature is off — expected
          resolve(undefined);
        }),
      ),
  );
}

// tabs.onUpdated: the active tab navigated — its mark may differ
export async function syncKeepAliveMenuOnNavigation(
  _tabId: number,
  changeInfo: chrome.tabs.OnUpdatedInfo,
  tab: chrome.tabs.Tab,
): Promise<void> {
  if (changeInfo.url && tab?.active) {
    await syncKeepAliveMenu(tab);
  }
}

// the main checkbox went on: every mark starts over from now
export async function restartKeepAlive(): Promise<void> {
  const { keepAlive = [] } = await localStore.get("keepAlive");
  if (keepAlive.length > 0) {
    await localStore.set({ keepAlive: rearmAllKeepAlive(keepAlive, Date.now()) });
  }
}

// storage.onChanged("settings"): the checkbox moved → menu item appears / goes, sweep follows
export function keepAliveSettingChanged(
  oldValue: Partial<Settings> | undefined,
  newValue: Partial<Settings> | undefined,
): boolean {
  // a partial settings write without the key means the default, not "off"
  const fallback = DEFAULTS.settings.keepAliveEnabled;
  return (oldValue?.keepAliveEnabled ?? fallback) !== (newValue?.keepAliveEnabled ?? fallback);
}
