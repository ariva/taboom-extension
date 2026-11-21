// Keep-it-alive: the 30 s sweep alarm that reloads marked pages when their
// jittered time comes, the mark/unmark entry points (menu, panel message) and
// the checkbox menu item's state.
import { DEFAULTS, featureEnabled, isSupportedUrl } from "../app/core.ts";
import {
  dueKeepAlive,
  isKeptAlive,
  keepAliveKey,
  keepAliveTargets,
  markKeepAlive,
  nextReloadAt,
  rearmAllKeepAlive,
  rearmKeepAlive,
  staggerKeepAlive,
} from "../app/keep-alive.ts";
import { loadState, localStore, removeKeepAlive } from "../app/storage.ts";
import { siteOf } from "../app/tag-patterns.ts";
import type { KeepAliveTab, Settings } from "../app/types.ts";
import { enqueueMenuOp } from "./context-menus.ts";
import { effectiveFeatures } from "./nav-mode.ts";

const ALARM_NAME = "keep-alive";
// the Keep alive ▸ submenu of the page menu: Page (the address) and Domain (the site)
export const KEEP_ALIVE_MENU_ID = "keep-alive-tab";
export const KEEP_ALIVE_SITE_MENU_ID = "keep-alive-site";
// what a mark made from a tab covers: its page (default) or its site, like Tag URL… / Tag domain…
export type KeepAliveScope = "site" | undefined;
// one alarm for every mark: each entry carries its own due time, the sweep
// only has to look often enough — 30 s is the MV3 floor
const SWEEP_MINUTES = 0.5;

// flag (experimental opt-in applied) + the user's checkbox
export async function keepAliveActive(): Promise<boolean> {
  const { state, features } = await effectiveFeatures();
  return featureEnabled(features, "KEEP_ALIVE") && state.settings.keepAliveEnabled;
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

// Every read-modify-write of the mark list in the worker runs on this chain: a sweep alarm due
// at browser start and the startup stagger otherwise both read the same list and the loser's
// write re-times pages the winner just reloaded
let keepAliveChain: Promise<unknown> = Promise.resolve();
function queuedKeepAlive<T>(work: () => Promise<T>): Promise<T> {
  const next = keepAliveChain.then(work, work);
  keepAliveChain = next.catch(() => {});
  return next;
}

export function keepAlivePass(): Promise<void> {
  return queuedKeepAlive(keepAlivePassNow);
}

async function keepAlivePassNow(): Promise<void> {
  const list = await activeKeepAliveList();
  if (list.length === 0) {
    return;
  }
  const now = Date.now();
  const due = dueKeepAlive(list, now);
  const tabs = due.length > 0 ? await chrome.tabs.query({}) : [];
  const reloaded: { url: string; title: string | undefined }[] = [];
  for (const entry of due) {
    // a mark whose page is closed stays armed (and quiet) until the user removes it in Options
    const targets = keepAliveTargets(tabs, entry.url, entry.reloadAll ?? false);
    await Promise.allSettled(
      targets.map((tab) =>
        // id checked by keepAliveTargets; ?? keeps the type honest without a cast
        chrome.tabs.reload(tab.id ?? -1).catch((error) => console.debug("keep-alive reload failed", tab.id, error)),
      ),
    );
    // the reloaded tab names the mark from now on (Settings table, Alive view)
    reloaded.push({ url: entry.url, title: targets[0]?.title });
  }
  // The reloads took a while: a Settings edit (Remove, Add, Pause, interval) may have landed
  // meanwhile. Re-arm against the list as it is now, not as it was read — a stale write would
  // resurrect a removed mark or drop a new one; a mark gone meanwhile is simply not re-armed.
  const { keepAlive = [] } = await localStore.get("keepAlive");
  let next = keepAlive;
  for (const { url, title } of reloaded) {
    const current = next.find((entry) => entry.url === url);
    if (current) {
      next = rearmKeepAlive(next, url, nextReloadAt(current.minutes, now), title);
    }
  }
  // whatever is still overdue was missed by the machine (sleep), not the sweep: one every 30–60 s
  const staggered = staggerKeepAlive(next, now);
  if (next === keepAlive && staggered === undefined) {
    return;
  }
  await localStore.set({ keepAlive: staggered ?? next });
}

// runtime.onStartup: the marks that came due while Chrome was closed reload one every 30–60 s
// from now, not all in the first sweep; the rest keep their time
export function staggerOverdueKeepAlive(): Promise<void> {
  return queuedKeepAlive(async () => {
    const { keepAlive = [] } = await localStore.get("keepAlive");
    const next = staggerKeepAlive(keepAlive, Date.now());
    if (next) {
      await localStore.set({ keepAlive: next });
    }
  });
}

// the site a tab's domain mark names ("" for a page that cannot be reloaded: nothing to keep)
function siteKeyOf(tab: chrome.tabs.Tab): string {
  return isSupportedUrl(tab.url) ? siteOf(tab.url) : "";
}

// the site mark itself, not a page mark that happens to cover the site — the Domain check
function hasSiteMark(list: KeepAliveTab[], tab: chrome.tabs.Tab): boolean {
  const site = siteKeyOf(tab);
  return site !== "" && list.some((entry) => entry.url === site);
}

async function markTabs(tabs: chrome.tabs.Tab[], scope: KeepAliveScope, expiresAt?: number): Promise<boolean> {
  const [{ settings }, { keepAlive = [] }] = await Promise.all([loadState(), localStore.get("keepAlive")]);
  const minutes = settings.keepAliveMinutes;
  const pages = tabs.map((tab) => ({
    url: scope === "site" ? siteKeyOf(tab) : keepAliveKey(tab.url),
    title: tab.title,
  }));
  const next = markKeepAlive(keepAlive, pages, minutes, nextReloadAt(minutes, Date.now()), expiresAt);
  if (!next) {
    return false;
  }
  await localStore.set({ keepAlive: next });
  return true;
}

// expiresAt: a temporary mark (the row menu's duration); the expiry sweep drops it at its time
export async function setTabsKeepAlive(
  tabs: chrome.tabs.Tab[],
  kept: boolean,
  scope?: KeepAliveScope,
  expiresAt?: number,
): Promise<void> {
  if (!(await keepAliveActive())) {
    return;
  }
  // unmark goes through the shared writer so the marks land in the restorable trash; a page
  // unmark hands the tab url in (the writer drops the mark covering it), a site unmark the site
  const keys = tabs.map((tab) => (scope === "site" ? siteKeyOf(tab) : tab.url));
  const changed = kept ? await markTabs(tabs, scope, expiresAt) : await removeKeepAlive(keys);
  if (!changed) {
    return;
  }
  await ensureKeepAliveAlarm();
  await syncKeepAliveMenu(tabs.find((tab) => tab.active));
}

// context menu click: flip the clicked page (Page) or its site (Domain)
export async function toggleTabKeepAlive(tab: chrome.tabs.Tab, scope?: KeepAliveScope): Promise<void> {
  const { keepAlive = [] } = await localStore.get("keepAlive");
  const kept = scope === "site" ? hasSiteMark(keepAlive, tab) : isKeptAlive(keepAlive, tab.url);
  await setTabsKeepAlive([tab], !kept, scope);
}

// Keep the two checkbox items matching the active tab: Page is checked when any mark covers
// the page (a site mark too), Domain when the site mark itself exists.
export async function syncKeepAliveMenu(tab: chrome.tabs.Tab | null | undefined): Promise<void> {
  if (!tab || keepAliveKey(tab.url) === "") {
    return;
  }
  const list = await activeKeepAliveList();
  const checks: [id: string, checked: boolean][] = [
    [KEEP_ALIVE_SITE_MENU_ID, hasSiteMark(list, tab)],
    [KEEP_ALIVE_MENU_ID, isKeptAlive(list, tab.url)],
  ];
  for (const [id, checked] of checks) {
    await enqueueMenuOp(
      () =>
        new Promise((resolve) =>
          chrome.contextMenus.update(id, { checked }, () => {
            void chrome.runtime.lastError; // item absent while the feature is off — expected
            resolve(undefined);
          }),
        ),
    );
  }
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
export function restartKeepAlive(): Promise<void> {
  return queuedKeepAlive(restartKeepAliveNow);
}

async function restartKeepAliveNow(): Promise<void> {
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
