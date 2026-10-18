// Menus of the Parked windows scope: the parked window header (restore / rename / remove),
// the parked tab-group header (move or copy the whole group, rename, remove) and the parked
// tab row (move or copy into something live, remove).
import { parkedRef, parkedWindowLabel } from "../../../app/parked.ts";
import {
  clearCtxMenu,
  ctxAppend,
  ctxDivider,
  ctxItem,
  ctxSubmenu,
  ctxTitle,
  showCtxMenu,
} from "../../../lib/ui/context-menu.ts";
import type { ParkedTarget } from "../../../app/messages.ts";
import { state, tabGroupsActive, tagsActive } from "../foundation/state.ts";
import { TAB_GROUP_COLORS, windowGroupName, windowMaps } from "../model/index.ts";
import { actionIds, copyUrls } from "../ops/actions.ts";
import {
  forgetParked,
  forgetParkedTabs,
  moveParkedTabs,
  parkedGroupOf,
  parkedOf,
  restoreLastForgotten,
  restoreParked,
  startRenameParked,
  startRenameParkedGroup,
} from "../ops/parked-ops.ts";
import { orderedWindowIds } from "../ops/window-ops.ts";
import { appendTagItems } from "./tag-menu.ts";

// the quick launch opens the same menu from its parked rows: rename edits the row there,
// not a list header, and "Show in Parked windows" jumps to the scope
export interface ParkedMenuHost {
  rename: (windowId: number) => void;
  showInList: () => void;
}

export function openParkedWindowMenu(event: MouseEvent, windowId: number, host?: ParkedMenuHost): void {
  const parked = parkedOf(windowId);
  if (!parked) {
    return;
  }
  clearCtxMenu();
  ctxAppend(ctxTitle(parkedWindowLabel(parked)), ctxDivider());
  ctxAppend(
    ctxItem("Restore window", () => restoreParked(windowId, false)),
    ctxItem("Restore into this window", () => restoreParked(windowId, true)),
    ctxItem("Rename window…", () => (host ? host.rename(windowId) : startRenameParked(windowId))),
    ...(host ? [ctxItem("Show in Parked windows", host.showInList)] : []),
    ctxDivider(),
    ctxItem("Remove parked window", () => forgetParked(windowId)),
  );
  if (state.parkedTrashCount > 0) {
    ctxAppend(ctxItem("Undo last remove", restoreLastForgotten));
  }
  showCtxMenu(event);
}

// live windows as move targets — the list itself shows parked rows, so the live sets are read
function appendWindowTargets(submenu: HTMLElement, pick: (target: ParkedTarget) => void): void {
  const maps = windowMaps(state.liveTabs, state.currentWindowId, state.liveWindowMeta);
  for (const liveWindowId of orderedWindowIds(maps)) {
    const name = windowGroupName(liveWindowId, {
      currentWindowId: state.currentWindowId,
      indexes: maps.indexes,
      names: maps.names,
    });
    submenu.append(ctxItem(name, () => pick({ windowId: liveWindowId })));
  }
  submenu.append(ctxItem("New window", () => pick({ windowId: null })));
}

// a parked tab group: its rows move (or copy) together and come back as a Chrome group
export function openParkedGroupMenu(event: MouseEvent, groupId: number): void {
  const found = parkedGroupOf(groupId);
  const ids = state.allTabs.filter((tab) => tab.groupId === groupId).map((tab) => tab.id);
  if (!found || ids.length === 0) {
    return;
  }
  const noun = `group (${ids.length} tab${ids.length === 1 ? "" : "s"})`;
  clearCtxMenu();
  ctxAppend(ctxTitle(found.parked.groups[found.index]?.title || "(unnamed group)"), ctxDivider());
  ctxAppend(
    ctxItem("Rename group…", () => startRenameParkedGroup(groupId)),
    ctxDivider(),
  );
  const move = ctxSubmenu(`Move ${noun} to`);
  ctxAppend(move.btn, move.submenu);
  appendWindowTargets(move.submenu, (target) => moveParkedTabs(ids, target, false, true));
  const open = ctxSubmenu(`Open ${noun} in`);
  ctxAppend(open.btn, open.submenu);
  appendWindowTargets(open.submenu, (target) => moveParkedTabs(ids, target, true, true));
  ctxAppend(ctxDivider());
  ctxAppend(ctxItem("Remove parked group", () => forgetParkedTabs(ids)));
  showCtxMenu(event);
}

export function openParkedTabMenu(event: MouseEvent, tabId: number): void {
  const ids = actionIds(tabId).filter((id) => parkedRef(id) !== undefined);
  const clicked = state.allTabs.find((tab) => tab.id === tabId);
  if (ids.length === 0 || !clicked) {
    return;
  }
  const plural = ids.length > 1 ? `${ids.length} parked tabs` : "parked tab";
  clearCtxMenu();
  ctxAppend(
    ctxTitle(ids.length > 1 ? `${ids.length} parked tabs selected` : clicked.title || "Parked tab"),
    ctxDivider(),
  );
  ctxAppend(ctxItem(ids.length > 1 ? `Copy ${ids.length} URLs` : "Copy URL", () => copyUrls(ids)));
  if (tagsActive()) {
    ctxAppend(ctxDivider());
    appendTagItems(ids, event); // tags follow the address: a parked row is tagged like a live tab
  }
  ctxAppend(ctxDivider());
  // Move = opens there and leaves the snapshot; Open = a copy, the tab stays parked
  const move = ctxSubmenu(`Move ${plural} to`);
  ctxAppend(move.btn, move.submenu);
  appendWindowTargets(move.submenu, (target) => moveParkedTabs(ids, target, false));
  if (tabGroupsActive() && state.liveTabGroups.size > 0) {
    const groupMenu = ctxSubmenu(`Move ${plural} to group`);
    ctxAppend(groupMenu.btn, groupMenu.submenu);
    for (const [groupId, group] of state.liveTabGroups) {
      const item = ctxItem(group.title || "(unnamed group)", () => moveParkedTabs(ids, { groupId }, false));
      const dot = document.createElement("span");
      dot.className = "win-dot";
      dot.style.background = TAB_GROUP_COLORS[group.color] ?? "#5f6368";
      item.prepend(dot);
      groupMenu.submenu.append(item);
    }
  }
  const open = ctxSubmenu(`Open ${plural} in`);
  ctxAppend(open.btn, open.submenu);
  appendWindowTargets(open.submenu, (target) => moveParkedTabs(ids, target, true));
  ctxAppend(ctxDivider());
  ctxAppend(
    ctxItem(ids.length > 1 ? `Remove ${ids.length} parked tabs` : "Remove parked tab", () => forgetParkedTabs(ids)),
  );
  showCtxMenu(event);
}
