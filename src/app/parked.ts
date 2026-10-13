// Parked windows, pure: the snapshot a window becomes when parked, the plan that rebuilds
// it, list edits (remove tabs, rename, remove, restore from trash) and the synthetic tab
// rows the side panel lists in its Parked windows scope. No DOM, no chrome.*.
import { popRemoval } from "./removal-trash.ts";
import type { ParkedGroup, ParkedTab, ParkedWindow, Removal } from "./types.ts";

type Tab = chrome.tabs.Tab;
type TabGroup = chrome.tabGroups.TabGroup;

export type SnapshotTab = Pick<Tab, "index" | "url" | "pendingUrl" | "title" | "pinned" | "active" | "groupId">;
// color stays a plain string: the stored shape and the mock hand over strings, Chrome a union of them
export type SnapshotGroup = { id: number; title?: string; color: string; collapsed?: boolean };
export type SnapshotMeta = { name?: string; color?: string; pinnedWindow?: boolean };

// optional flags are keys only when true — stored data and deepEqual in tests stay honest
function flag<K extends string>(key: K, value: boolean | undefined): Partial<Record<K, true>> {
  return value ? ({ [key]: true } as Record<K, true>) : {};
}

// What a window is when it closes: tabs in strip order with the address they show (a
// loading tab has only pendingUrl), the groups some tab is in, and the identity bits.
export function snapshotWindow(
  tabs: SnapshotTab[],
  groups: SnapshotGroup[],
  meta: SnapshotMeta,
  now: number,
  id: string,
): ParkedWindow {
  const ordered = [...tabs].sort((a, b) => a.index - b.index);
  const parkedGroups: ParkedGroup[] = [];
  const groupSlots = new Map<number, number>(); // live group id → index into parkedGroups
  const parkedTabs: ParkedTab[] = [];
  for (const tab of ordered) {
    const url = tab.url || tab.pendingUrl;
    if (!url) {
      continue; // nothing to reopen
    }
    const live = groups.find((group) => group.id === tab.groupId);
    let slot: number | undefined;
    if (live) {
      slot = groupSlots.get(live.id);
      if (slot === undefined) {
        slot = parkedGroups.length;
        groupSlots.set(live.id, slot);
        parkedGroups.push({ title: live.title ?? "", color: live.color, ...flag("collapsed", live.collapsed) });
      }
    }
    parkedTabs.push({
      url,
      title: tab.title || url,
      ...flag("pinned", tab.pinned),
      ...flag("active", tab.active),
      ...(slot === undefined ? {} : { group: slot }),
    });
  }
  return {
    id,
    parkedAt: now,
    ...(meta.name ? { name: meta.name } : {}),
    ...(meta.color ? { color: meta.color } : {}),
    ...flag("pinnedWindow", meta.pinnedWindow),
    tabs: parkedTabs,
    groups: parkedGroups,
  };
}

export interface RestorePlan {
  urls: string[];
  pinned: number[]; // tab indexes
  active: number; // tab index
  groups: { title: string; color: string; collapsed: boolean; indexes: number[] }[];
}

// what the worker creates, by position in `urls`
export function restorePlan(parked: ParkedWindow): RestorePlan {
  const groups = parked.groups.map((group) => ({
    title: group.title,
    color: group.color,
    collapsed: group.collapsed ?? false,
    indexes: [] as number[],
  }));
  parked.tabs.forEach((tab, index) => {
    if (tab.group !== undefined) {
      groups[tab.group]?.indexes.push(index);
    }
  });
  const activeIndex = parked.tabs.findIndex((tab) => tab.active);
  return {
    urls: parked.tabs.map((tab) => tab.url),
    pinned: parked.tabs.flatMap((tab, index) => (tab.pinned ? [index] : [])),
    active: activeIndex === -1 ? 0 : activeIndex,
    groups: groups.filter((group) => group.indexes.length > 0),
  };
}

// header / menu title: the window's own name, else when it was parked
export function parkedWindowLabel(parked: ParkedWindow): string {
  return parked.name ?? `Parked ${new Date(parked.parkedAt).toLocaleString()}`;
}

function patchParked(
  list: ParkedWindow[],
  id: string,
  patch: (parked: ParkedWindow) => ParkedWindow | null | undefined,
): ParkedWindow[] | undefined {
  const index = list.findIndex((parked) => parked.id === id);
  const current = list[index];
  if (!current) {
    return undefined;
  }
  const next = patch(current);
  if (next === undefined) {
    return undefined;
  }
  // null = drop the window
  return next === null ? list.filter((parked) => parked !== current) : list.with(index, next);
}

// Drop tabs by index (a moved or removed parked tab); a window with no tabs left goes too.
export function removeParkedTabs(list: ParkedWindow[], id: string, indexes: number[]): ParkedWindow[] | undefined {
  const drop = new Set(indexes);
  return patchParked(list, id, (parked) => {
    const tabs = parked.tabs.filter((_tab, index) => !drop.has(index));
    if (tabs.length === parked.tabs.length) {
      return undefined;
    }
    return tabs.length === 0 ? null : { ...parked, tabs };
  });
}

// The removed tabs as a parked window of their own (same id / name / time, only the groups
// they are in) — what the trash keeps, so Undo remove can put them back
export function removedParkedSlice(parked: ParkedWindow, indexes: number[]): ParkedWindow | undefined {
  const picked = new Set(indexes);
  const tabs = parked.tabs.filter((_tab, index) => picked.has(index));
  if (tabs.length === 0) {
    return undefined;
  }
  const slots = new Map<number, number>(); // old group index → index in the slice
  const groups: ParkedGroup[] = [];
  const sliceTabs = tabs.map((tab) => {
    if (tab.group === undefined) {
      return tab;
    }
    let slot = slots.get(tab.group);
    const group = parked.groups[tab.group];
    if (slot === undefined && group) {
      slot = groups.length;
      slots.set(tab.group, slot);
      groups.push(group);
    }
    const { group: _old, ...rest } = tab;
    return slot === undefined ? rest : { ...rest, group: slot };
  });
  return { ...parked, tabs: sliceTabs, groups };
}

// a restored slice goes back into its window when that still exists: tabs appended; its
// groups rejoin an identical group still there (same title / color / fold) or are appended
function mergeParked(existing: ParkedWindow, slice: ParkedWindow): ParkedWindow {
  const groups = [...existing.groups];
  const slots = slice.groups.map((group) => {
    const same = groups.findIndex(
      (candidate) =>
        candidate.title === group.title && candidate.color === group.color && candidate.collapsed === group.collapsed,
    );
    if (same !== -1) {
      return same;
    }
    groups.push(group);
    return groups.length - 1;
  });
  return {
    ...existing,
    groups,
    tabs: [
      ...existing.tabs,
      ...slice.tabs.map((tab) => (tab.group === undefined ? tab : { ...tab, group: slots[tab.group] ?? tab.group })),
    ],
  };
}

// empty name = back to the "Parked <date>" label
export function renameParkedWindow(list: ParkedWindow[], id: string, name: string): ParkedWindow[] | undefined {
  const trimmed = name.trim();
  return patchParked(list, id, (parked) => {
    if ((parked.name ?? "") === trimmed) {
      return undefined;
    }
    const { name: _old, ...rest } = parked;
    return trimmed ? { ...rest, name: trimmed } : rest;
  });
}

// rename one of a parked window's groups (the Chrome group it becomes on restore takes the title)
export function renameParkedGroup(
  list: ParkedWindow[],
  id: string,
  groupIndex: number,
  title: string,
): ParkedWindow[] | undefined {
  const trimmed = title.trim();
  return patchParked(list, id, (parked) => {
    const group = parked.groups[groupIndex];
    if (!group || group.title === trimmed) {
      return undefined;
    }
    return { ...parked, groups: parked.groups.with(groupIndex, { ...group, title: trimmed }) };
  });
}

export function removeParkedWindow(list: ParkedWindow[], id: string): ParkedWindow[] | undefined {
  return patchParked(list, id, () => null);
}

// Undo remove: the newest batch comes back — a whole window as it was, a removed
// group / tab back into its window (or on its own when that window is gone); undefined when
// the trash is empty.
export function restoreParkedRemoval(
  list: ParkedWindow[],
  trash: Removal<ParkedWindow>[],
): { parkedWindows: ParkedWindow[]; parkedTrash: Removal<ParkedWindow>[] } | undefined {
  const popped = popRemoval(trash);
  if (!popped) {
    return undefined;
  }
  let parkedWindows = list;
  for (const item of popped.newest.items) {
    const index = parkedWindows.findIndex((parked) => parked.id === item.id);
    const existing = parkedWindows[index];
    parkedWindows = existing ? parkedWindows.with(index, mergeParked(existing, item)) : [...parkedWindows, item];
  }
  return { parkedWindows, parkedTrash: popped.rest };
}

// ---------- synthetic rows for the side panel's Parked windows scope ----------
// The panel's list code only knows chrome.tabs.Tab shapes keyed by id, so parked tabs
// are presented as tabs with NEGATIVE ids (never a live id): window -(1 + w·BASE),
// tab -(1 + w·BASE + t), group -(2 + w·BASE + g) — -1 stays Chrome's "no group".
const BASE = 100_000; // ponytail: 100k tabs per parked window; widen if anyone parks more

export function parkedWindowId(windowIndex: number): number {
  return -(1 + windowIndex * BASE);
}

export function parkedTabId(windowIndex: number, tabIndex: number): number {
  return -(1 + windowIndex * BASE + tabIndex);
}

function parkedGroupId(windowIndex: number, groupIndex: number): number {
  return -(2 + windowIndex * BASE + groupIndex);
}

// which parked window / tab a synthetic row id stands for; undefined for a live id
export function parkedRef(tabId: number): { window: number; tab: number } | undefined {
  if (tabId >= 0) {
    return undefined;
  }
  const offset = -tabId - 1;
  return { window: Math.floor(offset / BASE), tab: offset % BASE };
}

// which parked window / group a synthetic group id stands for; undefined for a live id
export function parkedGroupRef(groupId: number): { window: number; group: number } | undefined {
  if (groupId >= -1) {
    return undefined;
  }
  const offset = -groupId - 2;
  return { window: Math.floor(offset / BASE), group: offset % BASE };
}

export interface ParkedPanel {
  tabs: (Tab & { id: number })[];
  groups: Map<number, TabGroup>;
  meta: Map<number, SnapshotMeta>;
}

export function parkedPanelTabs(list: ParkedWindow[]): ParkedPanel {
  const tabs: ParkedPanel["tabs"] = [];
  const groups: ParkedPanel["groups"] = new Map();
  const meta: ParkedPanel["meta"] = new Map();
  list.forEach((parked, windowIndex) => {
    const windowId = parkedWindowId(windowIndex);
    meta.set(windowId, {
      name: parkedWindowLabel(parked),
      ...(parked.color ? { color: parked.color } : {}),
      ...flag("pinnedWindow", parked.pinnedWindow),
    });
    parked.groups.forEach((group, groupIndex) => {
      const id = parkedGroupId(windowIndex, groupIndex);
      // `as`: the panel reads title / color / collapsed; Chrome's color union is wider than our string
      groups.set(id, {
        id,
        windowId,
        title: group.title,
        color: group.color,
        collapsed: group.collapsed ?? false,
      } as TabGroup);
    });
    parked.tabs.forEach((tab, tabIndex) => {
      tabs.push({
        id: parkedTabId(windowIndex, tabIndex),
        windowId,
        index: tabIndex,
        url: tab.url,
        title: tab.title,
        pinned: tab.pinned ?? false,
        active: tab.active ?? false,
        groupId: tab.group === undefined ? -1 : parkedGroupId(windowIndex, tab.group),
        lastAccessed: parked.parkedAt,
        discarded: false,
        audible: false,
        highlighted: false,
        incognito: false,
        selected: false,
        autoDiscardable: false,
        frozen: false,
      });
    });
  });
  return { tabs, groups, meta };
}
