// Parked-window operations of the side panel: the confirmed Park, Restore (new window or
// into this one), moving parked tabs out, Remove with its undo, rename in place. The
// worker does the chrome work (park-window / restore-parked / move-parked-tabs); list
// edits go through the storage writers.
import type { ParkedTarget } from "../../../app/messages.ts";
import { send } from "../../../app/messages.ts";
import { parkedGroupRef, parkedRef, parkedWindowLabel } from "../../../app/parked.ts";
import {
  appendParkedTabs,
  forgetParkedWindow,
  loadState,
  renameParked,
  renameParkedGroupTitle,
  removeParkedTabsToTrash,
  restoreParkedWindows,
  saveState,
} from "../../../app/storage.ts";
import type { ParkedTab, ParkedWindow } from "../../../app/types.ts";
import { closingWindows } from "../../../app/duplicates.ts";
import { askDialog } from "../../../lib/ui/ask-dialog.ts";
import { inlineEdit } from "../../../lib/ui/inline-edit.ts";
import { toast } from "../../../lib/ui/toast.ts";
import { listEl } from "../foundation/elements.ts";
import { refresh } from "../foundation/scheduler.ts";
import { state } from "../foundation/state.ts";
import { closeTabs } from "./actions.ts";
import { windowLabel } from "./window-ops.ts";

// the parked window a synthetic window id (or any of its row ids) stands for
export function parkedOf(syntheticId: number): ParkedWindow | undefined {
  const ref = parkedRef(syntheticId);
  return ref ? state.parked[ref.window] : undefined;
}

// Park window…: asks first (unless the user said "Don't ask again"), then the worker
// snapshots and closes it. Never the only window — closing it would close Chrome.
export async function parkWindowPrompt(windowId: number): Promise<void> {
  const liveWindows = new Set(state.liveTabs.map((tab) => tab.windowId));
  if (liveWindows.size < 2) {
    toast("Open another window first — parking the only window would close Chrome");
    return;
  }
  const count = state.liveTabs.filter((tab) => tab.windowId === windowId).length;
  const { settings } = await loadState();
  if (settings.askBeforePark) {
    const ok = await askDialog({
      message:
        `Park ${windowLabel(windowId)}?\n` +
        `Its ${count} tab${count === 1 ? "" : "s"} close and wait under Parked windows (the scope selector) until you restore them.`,
      okLabel: "Park",
      checkbox: {
        label: "Don't ask again",
        onConfirm: (checked) => {
          if (checked) {
            saveState({ settings: { ...settings, askBeforePark: false } }); // Settings turns it back on
          }
        },
      },
    });
    if (!ok) {
      return;
    }
  }
  await send({ type: "park-window", windowId }).catch(() => {});
  refresh(true);
}

export async function restoreParked(syntheticWindowId: number, intoCurrentWindow: boolean): Promise<void> {
  const parked = parkedOf(syntheticWindowId);
  if (!parked) {
    return;
  }
  const into = intoCurrentWindow && state.currentWindowId != null ? { intoWindowId: state.currentWindowId } : {};
  await send({ type: "restore-parked", id: parked.id, ...into }).catch(() => {});
  refresh(true);
}

// the quick launch's parked row click: a plain click restores a whole window, so it asks
// first (the list's menu items are deliberate picks and do not). True when the restore ran.
export async function restoreParkedPrompt(syntheticWindowId: number): Promise<boolean> {
  const parked = parkedOf(syntheticWindowId);
  if (!parked) {
    return false;
  }
  const count = parked.tabs.length;
  const ok = await askDialog({
    message:
      `Restore ${parkedWindowLabel(parked)}?\n` + `Its ${count} tab${count === 1 ? "" : "s"} open in a new window.`,
    okLabel: "Restore",
  });
  if (!ok) {
    return false;
  }
  await restoreParked(syntheticWindowId, false);
  return true;
}

// Move tab to ▸ Parked: live tabs join a parked window's snapshot and close. The snapshot
// is written before the close (like Park); a window losing its last tab is named first.
export async function moveTabsToParked(tabIds: number[], parked: ParkedWindow): Promise<void> {
  const ids = new Set(tabIds);
  const tabs: ParkedTab[] = state.liveTabs.flatMap((tab) => {
    const url = tab.url || tab.pendingUrl;
    return ids.has(tab.id) && url ? [{ url, title: tab.title || url, ...(tab.pinned ? { pinned: true } : {}) }] : [];
  });
  if (tabs.length === 0) {
    return;
  }
  const closing = closingWindows(state.liveTabs, tabIds);
  const message =
    tabs.length > 1 || closing.length > 0
      ? [
          `Move ${tabs.length} tab${tabs.length === 1 ? "" : "s"} to ${parkedWindowLabel(parked)}?`,
          ...closing.map((windowId) => `${windowLabel(windowId)} will close — every tab in it moves.`),
        ].join("\n")
      : undefined;
  await closeTabs(tabIds, message, () => appendParkedTabs(parked.id, tabs));
}

// row ids → their parked window id + tab indexes (a selection may span parked windows)
function byParkedWindow(tabIds: number[]): Map<string, number[]> {
  const grouped = new Map<string, number[]>();
  for (const tabId of tabIds) {
    const ref = parkedRef(tabId);
    const parked = ref ? state.parked[ref.window] : undefined;
    if (ref && parked) {
      grouped.set(parked.id, [...(grouped.get(parked.id) ?? []), ref.tab]);
    }
  }
  return grouped;
}

// open parked tabs in a live window / group / a new window; keep = a copy, the tab stays
// parked; asGroup = the rows are one parked group, recreate it around them
export async function moveParkedTabs(
  tabIds: number[],
  target: ParkedTarget,
  keep: boolean,
  asGroup = false,
): Promise<void> {
  for (const [id, indexes] of byParkedWindow(tabIds)) {
    await send({ type: "move-parked-tabs", id, indexes, target, keep, asGroup }).catch(() => {});
  }
  for (const tabId of tabIds) {
    state.selected.delete(tabId);
  }
  refresh(true);
}

// Remove parked tab / group: into the trash, so Undo remove puts it back into its window
export async function forgetParkedTabs(tabIds: number[]): Promise<void> {
  for (const [id, indexes] of byParkedWindow(tabIds)) {
    await removeParkedTabsToTrash(id, indexes);
  }
  for (const tabId of tabIds) {
    state.selected.delete(tabId);
  }
  refresh(true);
}

export async function forgetParked(syntheticWindowId: number): Promise<void> {
  const parked = parkedOf(syntheticWindowId);
  if (parked) {
    await forgetParkedWindow(parked.id);
    refresh(true);
  }
}

export async function restoreLastForgotten(): Promise<void> {
  await restoreParkedWindows();
  refresh(true);
}

// the parked tab-group a synthetic group id stands for
export function parkedGroupOf(groupId: number): { parked: ParkedWindow; index: number } | undefined {
  const ref = parkedGroupRef(groupId);
  const parked = ref ? state.parked[ref.window] : undefined;
  return ref && parked?.groups[ref.group] ? { parked, index: ref.group } : undefined;
}

// same inline edit as a live tab-group header; the title lands in the snapshot
export function startRenameParkedGroup(groupId: number): void {
  const found = parkedGroupOf(groupId);
  const label = listEl.querySelector(
    `.group-header[data-tab-group-id="${groupId}"] .group-label, .tabgroup-header[data-tab-group-id="${groupId}"] .tg-title`,
  );
  if (!found || !label) {
    return;
  }
  inlineEdit(label, {
    initial: found.parked.groups[found.index]?.title ?? "",
    placeholder: "Group name",
    commit: (title) => renameParkedGroupTitle(found.parked.id, found.index, title),
    finish: () => refresh(false),
  });
}

// same inline edit as a live window header; the name lands in the snapshot
export function startRenameParked(syntheticWindowId: number): void {
  const parked = parkedOf(syntheticWindowId);
  const label = listEl.querySelector(`.group-header[data-window-id="${syntheticWindowId}"] .group-label`);
  if (!parked || !label) {
    return;
  }
  inlineEdit(label, {
    initial: parked.name ?? "",
    placeholder: "Window name",
    commit: (name) => renameParked(parked.id, name),
    finish: () => refresh(false),
  });
}
