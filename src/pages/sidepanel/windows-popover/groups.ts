// Groups view of the windows popover: group rows, the "+ New group…" row, rename in
// place, and drag & drop reordering of the list.
import { closest } from "../../../lib/dom.ts";
import { inlineEdit } from "../../../lib/ui/inline-edit.ts";
import { toast } from "../../../lib/ui/toast.ts";
import { activate } from "../ops/actions.ts";
import { reorderedGroupTitles } from "../dnd/dnd-model.ts";
import { clearDropTarget, markDropTarget } from "../dnd/drop-target.ts";
import { winPop } from "../foundation/elements.ts";
import { openTabGroupMenu } from "../menus/menus.ts";
import { TAB_GROUP_COLORS } from "../model/index.ts";
import { refresh } from "../foundation/scheduler.ts";
import { state } from "../foundation/state.ts";
import { commitTabGroupTitle, moveTabsToGroup } from "../ops/tab-group-ops.ts";
import { persistUiPrefs } from "../input/toolbar-events.ts";
import { windowLabel } from "../ops/window-ops.ts";

type TabGroup = chrome.tabGroups.TabGroup;

// the popover shell (windows-popover.ts) imports this module, so its fillWindowsPopover
// arrives by registration instead of an upward import; no-op until then
let fillWindowsPopover: () => void = () => {};

export function registerPopoverRefill(refill: () => void): void {
  fillWindowsPopover = refill;
}

// Groups view: one row per Chrome tab group — click activates the group's
// first tab (focuses its window), ⋯/right-click opens the group menu
export function fillGroupRows(groupList: TabGroup[]): void {
  // user-dragged order first (ui.quickLaunchGroupOrder, by title), the rest ABC
  const order = state.ui.quickLaunchGroupOrder ?? [];
  const rank = (group: TabGroup): number => {
    const slot = order.indexOf(group.title || "");
    return slot === -1 ? order.length : slot;
  };
  const sorted = [...groupList].sort(
    (a, b) => rank(a) - rank(b) || (a.title || "").localeCompare(b.title || "", undefined, { sensitivity: "base" }),
  );
  for (const group of sorted) {
    const tabs = state.allTabs
      .filter((tab) => tab.groupId === group.id)
      .sort((a, b) => (a.index ?? 0) - (b.index ?? 0));
    const row = document.createElement("button");
    row.type = "button";
    row.className = "win-row";
    row.dataset.tabGroupId = String(group.id);
    row.draggable = true; // drag onto another group row to reorder the list
    const square = document.createElement("span");
    square.className = "tg-square";
    square.style.background = TAB_GROUP_COLORS[group.color] ?? "#5f6368";
    const name = document.createElement("span");
    name.className = "win-title";
    name.textContent = group.title || "(unnamed group)";
    const snoozed = tabs.filter((tab) => tab.discarded).length;
    const awake = tabs.length - snoozed; // filter-chip terminology, like the Windows view
    const stats = document.createElement("span");
    stats.className = "win-stats muted";
    stats.textContent = `${tabs.length} tab${tabs.length === 1 ? "" : "s"} · ${awake} awake · ${snoozed} snoozed`;
    row.append(square, name, stats);
    row.title = [
      `Group "${group.title || "(unnamed group)"}"`,
      `${tabs.length} tab${tabs.length === 1 ? "" : "s"} · ${awake} awake · ${snoozed} snoozed`,
      `In ${windowLabel(group.windowId)}`,
    ].join("\n");
    row.addEventListener("click", () => {
      winPop.hidePopover?.();
      if (tabs[0]) {
        activate(tabs[0]);
      }
    });
    const menuBtn = document.createElement("button");
    menuBtn.type = "button";
    menuBtn.className = "win-menu-btn";
    menuBtn.title = menuBtn.ariaLabel = "Group actions";
    menuBtn.textContent = "⋯";
    menuBtn.addEventListener("click", (event) => {
      event.stopPropagation();
      openTabGroupMenu(event, group.id, startRenameTabGroupInList);
    });
    const item = document.createElement("div");
    item.className = "win-item";
    item.append(row, menuBtn);
    winPop.append(item);
  }
  appendNewGroupRow();
}

// bottom row of the Groups view: click swaps the label for a name input (same
// inline edit as the renames). A name opens a background New Tab for the group
// (Chrome has no empty groups) — existing tabs are never pulled in, neither the
// one the user is on nor a sidebar selection (grouping those is the row menu's
// "Move to group ▸ New group…"). Empty / Esc = nothing
function appendNewGroupRow(): void {
  const row = document.createElement("button");
  row.type = "button";
  row.className = "win-row win-new";
  row.title = "New group with a New Tab in it";
  const label = document.createElement("span");
  label.className = "win-title";
  label.textContent = "+ New group…";
  row.append(label);
  row.addEventListener("click", () => {
    if (row.querySelector(".rename-input")) {
      return;
    }
    inlineEdit(label, {
      initial: "",
      placeholder: "New group name",
      commit: async (name) => {
        if (!name.trim()) {
          return;
        }
        try {
          const tab = await chrome.tabs.create({ windowId: state.currentWindowId ?? undefined, active: false });
          await moveTabsToGroup([tab.id!], null, name.trim()); // a tab chrome just created has its id
        } catch (error) {
          toast(String((error as Partial<Error> | null)?.message ?? error));
        }
      },
      finish: () => fillWindowsPopover(),
    });
  });
  const item = document.createElement("div");
  item.className = "win-item";
  item.append(row);
  winPop.append(item);
}

// rename without leaving the windows popover: swap the group row's name for the input
export function startRenameTabGroupInList(groupId: number): void {
  const title = winPop.querySelector(`.win-row[data-tab-group-id="${groupId}"] .win-title`);
  if (!title) {
    return;
  }
  inlineEdit(title, {
    initial: state.tabGroups.get(groupId)?.title ?? "",
    placeholder: "Group name",
    commit: (title) => commitTabGroupTitle(groupId, title),
    finish: () => {
      fillWindowsPopover(); // fresh name in place, popover stays open
      refresh(false);
    },
  });
}

// Groups view: drag a group row onto another to reorder the LIST only — Chrome's
// strip is untouched. Saved by title (group ids change on every browser restart)
let draggedGroupId: number | null = null; // dataTransfer is unreadable during dragover — track here

function groupRowUnder(event: DragEvent): HTMLElement | null {
  const row = closest(event.target, ".win-row[data-tab-group-id]");
  return row && draggedGroupId != null && Number(row.dataset.tabGroupId) !== draggedGroupId ? row : null;
}

export function initGroupReorder(): void {
  winPop.addEventListener("dragstart", (event) => {
    const row = closest(event.target, ".win-row[data-tab-group-id]");
    draggedGroupId = row ? Number(row.dataset.tabGroupId) : null;
  });

  winPop.addEventListener("dragover", (event) => {
    const row = groupRowUnder(event);
    if (!row) {
      clearDropTarget();
      return; // not a valid target — the browser shows the no-drop cursor
    }
    event.preventDefault();
    markDropTarget(row);
  });

  winPop.addEventListener("drop", (event) => {
    const row = groupRowUnder(event);
    if (row) {
      event.preventDefault();
      const ids = [...winPop.querySelectorAll<HTMLElement>(".win-row[data-tab-group-id]")].map((el) =>
        Number(el.dataset.tabGroupId),
      );
      const quickLaunchGroupOrder = reorderedGroupTitles(
        ids,
        draggedGroupId!, // groupRowUnder only returns a row while a group drag is tracked
        Number(row.dataset.tabGroupId),
        state.tabGroups,
        state.ui.quickLaunchGroupOrder ?? [],
      );
      state.ui = { ...state.ui, quickLaunchGroupOrder };
      persistUiPrefs();
      fillWindowsPopover();
    }
    draggedGroupId = null;
    clearDropTarget();
  });

  winPop.addEventListener("dragend", () => {
    draggedGroupId = null;
    clearDropTarget();
  });
}
