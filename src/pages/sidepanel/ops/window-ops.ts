// Window operations: display label, list order, pin / color / rename, and moving tabs
// into another (or a new) window.
import { send } from "../../../app/messages.ts";
import { inlineEdit } from "../../../lib/ui/inline-edit.ts";
import { toastFailure } from "../../../lib/ui/toast.ts";
import { listEl } from "../foundation/elements.ts";
import { windowGroupName, windowMaps } from "../model/index.ts";
import type { WindowMaps } from "../model/index.ts";
import { refresh } from "../foundation/scheduler.ts";
import { pinActive, state } from "../foundation/state.ts";
import { orderWindowIds } from "../model/window-order.ts";
import { reportAnswer } from "./answer.ts";

// display name of a window (custom name or "Window #N") for menu headers
export function windowLabel(windowId: number): string {
  // live sets on purpose: in the Parked windows scope allTabs holds snapshots, and this label
  // names live windows (quick launch rows, park prompt, move targets)
  const maps = windowMaps(state.liveTabs, state.currentWindowId, state.liveWindowMeta);
  return windowGroupName(windowId, {
    currentWindowId: state.currentWindowId,
    indexes: maps.indexes,
    names: maps.names,
  });
}

// the list order of window-order.ts over the panel state (pins rank only while pinActive())
export function orderedWindowIds(maps: WindowMaps): number[] {
  const pinnedIds = new Set(
    pinActive() ? [...maps.indexes.keys()].filter((windowId) => state.liveWindowMeta.get(windowId)?.pinnedWindow) : [],
  );
  return orderWindowIds(maps, state.currentWindowId, pinnedIds);
}

export async function moveTabsToWindow(tabIds: number[], windowId: number | null, index = -1): Promise<void> {
  // Chrome unpins a tab that changes window — remember the pins, restore after
  const pinnedIds = state.liveTabs
    .filter((tab) => tab.pinned && tabIds.includes(tab.id) && tab.windowId !== windowId)
    .map((tab) => tab.id);
  try {
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
  } catch (error) {
    toastFailure("move the tabs", error); // the target window closed inside the debounce, a tab went
  }
  refresh(true);
}

// bring a window to the front (header menu, quick launch): a window gone since the render is reported
export async function focusWindow(windowId: number): Promise<void> {
  try {
    await chrome.windows.update(windowId, { focused: true });
  } catch (error) {
    toastFailure("focus the window", error);
    refresh(false);
  }
}

export async function setWindowPin(windowId: number, pinned: boolean): Promise<void> {
  reportAnswer(await send({ type: "window-pin", windowId, pinned }), pinned ? "pin the window" : "unpin the window");
  refresh(true);
}

export async function setWindowColor(windowId: number, color: string | null): Promise<void> {
  reportAnswer(await send({ type: "window-set-color", windowId, color }), "color the window");
  refresh(true);
}

export function startRenameWindow(windowId: number): void {
  const label = listEl.querySelector(`.group-header[data-window-id="${windowId}"] .group-label`);
  if (!label) {
    return;
  }
  inlineEdit(label, {
    initial: state.liveWindowMeta.get(windowId)?.name ?? "",
    placeholder: "Window name",
    // empty commits too — it clears the name back to the default label
    commit: async (name) => reportAnswer(await send({ type: "window-rename", windowId, name }), "rename the window"),
    finish: () => refresh(false),
  });
}
