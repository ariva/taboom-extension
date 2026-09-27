// Window operations: display label, list order, pin / color / rename, and moving tabs
// into another (or a new) window.
import { send } from "../../../app/messages.ts";
import { inlineEdit } from "../../../lib/ui/inline-edit.ts";
import { listEl } from "../foundation/elements.ts";
import { windowGroupName, windowMaps } from "../model/index.ts";
import type { WindowMaps } from "../model/index.ts";
import { refresh } from "../foundation/scheduler.ts";
import { pinActive, state } from "../foundation/state.ts";
import { orderWindowIds } from "../model/window-order.ts";

// display name of a window (custom name or "Window #N") for menu headers
export function windowLabel(windowId: number): string {
  const maps = windowMaps(state.allTabs, state.currentWindowId, state.windowMeta);
  return windowGroupName(windowId, {
    currentWindowId: state.currentWindowId,
    indexes: maps.indexes,
    names: maps.names,
  });
}

// the list order of window-order.ts over the panel state (pins rank only while pinActive())
export function orderedWindowIds(maps: WindowMaps): number[] {
  const pinnedIds = new Set(
    pinActive() ? [...maps.indexes.keys()].filter((windowId) => state.windowMeta.get(windowId)?.pinnedWindow) : [],
  );
  return orderWindowIds(maps, state.currentWindowId, pinnedIds);
}

export async function moveTabsToWindow(tabIds: number[], windowId: number | null, index = -1): Promise<void> {
  // Chrome unpins a tab that changes window — remember the pins, restore after
  const pinnedIds = state.allTabs
    .filter((tab) => tab.pinned && tabIds.includes(tab.id) && tab.windowId !== windowId)
    .map((tab) => tab.id);
  if (windowId == null) {
    // new window: it is created around the first tab, the rest follow
    const [first, ...rest] = tabIds;
    const win = await chrome.windows.create({ tabId: first });
    if (rest.length > 0) {
      // win!: windows.create resolves with the new window (optional only in the typings)
      await chrome.tabs.move(rest, { windowId: win!.id, index: -1 });
    }
  } else {
    await chrome.tabs.move(tabIds, { windowId, index });
  }
  for (const id of pinnedIds) {
    await chrome.tabs.update(id, { pinned: true }).catch(() => {});
  }
  refresh(true);
}

export async function setWindowPin(windowId: number, pinned: boolean): Promise<void> {
  await send({ type: "window-pin", windowId, pinned }).catch(() => {});
  refresh(true);
}

export async function setWindowColor(windowId: number, color: string | null): Promise<void> {
  await send({ type: "window-set-color", windowId, color }).catch(() => {});
  refresh(true);
}

export function startRenameWindow(windowId: number): void {
  const label = listEl.querySelector(`.group-header[data-window-id="${windowId}"] .group-label`);
  if (!label) {
    return;
  }
  inlineEdit(label, {
    initial: state.windowMeta.get(windowId)?.name ?? "",
    placeholder: "Window name",
    // empty commits too — it clears the name back to the default label
    commit: (name) => send({ type: "window-rename", windowId, name }).catch(() => {}),
    finish: () => refresh(false),
  });
}
