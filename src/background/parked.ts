// Parked windows: park = snapshot the window and close it; restore = open the tabs again
// (a new window with the old identity, or appended into a live one) and recreate pins,
// groups and the active tab; move = open picked parked tabs somewhere live.
import type { MessageError, ParkedTarget } from "../app/messages.ts";
import { restorePlan, snapshotWindow } from "../app/parked.ts";
import { addParkedWindow, dropParkedTabsByUrl, localStore } from "../app/storage.ts";
import { capabilities } from "../lib/platform/capabilities.ts";
import { patchWindowProfiles, windowProfileOf } from "./window-profiles.ts";

type TabIdList = [number, ...number[]]; // what chrome.tabs.group is typed to take

// Every "nothing happened" path answers a reason: the dispatcher turns undefined into { ok }, and the
// panel toasts an { error } — a silent ok after a click is what these used to be
export async function parkWindow(windowId: number): Promise<MessageError | undefined> {
  const [tabs, groups, profile] = await Promise.all([
    chrome.tabs.query({ windowId }),
    capabilities.tabGroups ? chrome.tabGroups.query({ windowId }).catch(() => []) : [],
    windowProfileOf(windowId),
  ]);
  if (tabs.length === 0) {
    return { error: "the window is gone or has no tabs" };
  }
  const parked = snapshotWindow(
    tabs,
    groups,
    { name: profile?.name, color: profile?.color, pinnedWindow: profile?.pinnedWindow },
    Date.now(),
    `p-${crypto.randomUUID()}`,
  );
  // the snapshot is on disk before the window goes — a crash in between loses nothing
  await addParkedWindow(parked);
  await chrome.windows.remove(windowId);
  return undefined;
}

interface OpenedTabs {
  windowId: number | undefined;
  ids: (number | undefined)[]; // by position in `urls`; undefined where Chrome refused the address
}

// One path for every reopen: into `windowId`, or into a new window built around the first
// address Chrome accepts (windows.create takes a url list but rejects the whole call on one bad
// address — file:// without permission, data:, odd schemes — and cannot pin; so one tab at a
// time, each failure on its own, and a refused seed address tries the next one).
async function openTabs(urls: string[], pinned: number[], windowId: number | undefined): Promise<OpenedTabs> {
  const ids: (number | undefined)[] = [];
  let start = 0;
  let seed: number | undefined;
  while (windowId === undefined && start < urls.length) {
    const win = await chrome.windows.create({ url: urls[start], focused: true }).catch(() => undefined);
    windowId = win?.id;
    if (windowId !== undefined) {
      seed = start;
      ids[start] = win?.tabs?.[0]?.id;
    }
    start++;
  }
  if (windowId === undefined) {
    return { windowId, ids }; // every address refused: nothing opened
  }
  for (let index = start; index < urls.length; index++) {
    const tab = await chrome.tabs
      .create({ windowId, url: urls[index], active: false, pinned: pinned.includes(index) })
      .catch(() => undefined);
    ids[index] = tab?.id;
  }
  // the window's first tab came from windows.create, which cannot pin
  if (seed !== undefined && pinned.includes(seed) && ids[seed] !== undefined) {
    await chrome.tabs.update(ids[seed], { pinned: true }).catch(() => {});
  }
  return { windowId, ids };
}

// a stored group becomes a Chrome group around these (already open) tabs
async function recreateGroup(
  tabIds: TabIdList,
  windowId: number,
  group: { title: string; color: string; collapsed?: boolean },
): Promise<void> {
  try {
    const groupId = await chrome.tabs.group({ tabIds, createProperties: { windowId } });
    // `as`: our stored color is Chrome's color name as a string
    await chrome.tabGroups.update(groupId, {
      title: group.title,
      color: group.color as chrome.tabGroups.TabGroup["color"],
      collapsed: group.collapsed ?? false,
    });
  } catch (error) {
    console.debug("parked group restore failed", group.title, error);
  }
}

// the window a just-created tab landed in (a new window's id is only known this way)
async function openedWindowOf(tabId: number | undefined): Promise<number | undefined> {
  if (tabId === undefined) {
    return undefined;
  }
  return (await chrome.tabs.get(tabId).catch(() => undefined))?.windowId;
}

// The snapshot is consumed AFTER the tabs exist, and only the tabs that opened leave it: a
// refused address or a target window closed meanwhile keeps its tabs parked instead of losing
// the window with nothing to undo (park does the mirror image: snapshot first, close after)
export async function restoreParked(id: string, intoWindowId?: number): Promise<MessageError | undefined> {
  const { parkedWindows = [] } = await localStore.get("parkedWindows");
  const parked = parkedWindows.find((entry) => entry.id === id);
  if (!parked) {
    return { error: "the parked window is no longer there" };
  }
  const plan = restorePlan(parked);
  const { windowId, ids } = await openTabs(plan.urls, plan.pinned, intoWindowId);
  // consumed by address, not position: the snapshot may have been edited while the tabs opened
  const opened = ids.flatMap((tabId, index) => (tabId === undefined ? [] : [plan.urls[index] ?? ""]));
  if (opened.length > 0) {
    await dropParkedTabsByUrl(id, opened);
  }
  if (windowId === undefined) {
    return { error: "none of its addresses could be opened" };
  }
  for (const group of plan.groups) {
    const tabIds = group.indexes.map((index) => ids[index]).filter((tabId): tabId is number => tabId !== undefined);
    if (tabIds.length === 0 || !capabilities.tabGroups) {
      continue;
    }
    await recreateGroup(tabIds as TabIdList, windowId, group);
  }
  const active = ids[plan.active];
  if (active !== undefined) {
    await chrome.tabs.update(active, { active: true }).catch(() => {});
  }
  // the old identity follows the new window (not an existing one — that has its own)
  if (intoWindowId === undefined && (parked.name || parked.color || parked.pinnedWindow)) {
    await patchWindowProfiles([windowId], {
      name: parked.name,
      color: parked.color,
      pinnedWindow: parked.pinnedWindow,
    });
  }
  return undefined;
}

// Open the picked parked tabs in a live window / group / a new window; `keep` leaves them
// parked as well (a copy), otherwise they leave the snapshot.
export async function moveParkedTabs(
  id: string,
  indexes: number[],
  target: ParkedTarget,
  keep: boolean,
  asGroup: boolean,
): Promise<MessageError | undefined> {
  const { parkedWindows = [] } = await localStore.get("parkedWindows");
  const parked = parkedWindows.find((entry) => entry.id === id);
  if (!parked) {
    return { error: "the parked window is no longer there" };
  }
  const picked = indexes.flatMap((index) => parked.tabs[index] ?? []);
  if (picked.length === 0) {
    return { error: "those tabs are no longer in the snapshot" };
  }
  let windowId: number | undefined;
  let groupId: number | undefined;
  if ("groupId" in target) {
    groupId = target.groupId;
    windowId = (await chrome.tabGroups.get(groupId).catch(() => undefined))?.windowId;
    if (windowId === undefined) {
      return { error: "the target group is gone" }; // the menu was stale
    }
  } else {
    windowId = target.windowId ?? undefined;
  }
  const { ids } = await openTabs(
    picked.map((tab) => tab.url),
    picked.flatMap((tab, index) => (tab.pinned ? [index] : [])),
    windowId,
  );
  const created = ids.filter((tabId): tabId is number => tabId !== undefined);
  if (groupId !== undefined && created.length > 0) {
    await chrome.tabs.group({ tabIds: created as TabIdList, groupId }).catch(() => {});
  }
  // a whole parked group moved: it becomes a Chrome group again, same title and color
  const slot = picked[0]?.group;
  const group = asGroup && slot !== undefined ? parked.groups[slot] : undefined;
  const targetWindow = await openedWindowOf(created[0]);
  if (groupId === undefined && group && created.length > 0 && targetWindow !== undefined && capabilities.tabGroups) {
    await recreateGroup(created as TabIdList, targetWindow, group);
  }
  // only what opened leaves the snapshot (restore does the same): a target window closed
  // after the menu was built, or an address Chrome refused, keeps its tab parked
  const opened = picked.flatMap((tab, position) => (ids[position] === undefined ? [] : [tab.url]));
  if (!keep && opened.length > 0) {
    await dropParkedTabsByUrl(id, opened);
  }
  return opened.length === 0 ? { error: "none of the addresses could be opened" } : undefined;
}
