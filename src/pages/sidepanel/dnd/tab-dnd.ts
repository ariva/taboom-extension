// Drag & drop on the tab list: move tabs between windows, reorder inside a window, join
// or leave a tab group. What a drop means is decided by dnd-model.ts.
import { closest } from "../../../lib/dom.ts";
import { actionIds } from "../ops/actions.ts";
import { dropSpecFor } from "./dnd-model.ts";
import type { DropSpec } from "./dnd-model.ts";
import { clearDropTarget, markDropTarget } from "./drop-target.ts";
import { listEl } from "../foundation/elements.ts";
import { refresh } from "../foundation/scheduler.ts";
import { effectiveSort, reorderActive, state, tabGroupsActive } from "../foundation/state.ts";
import { moveTabsToGroup, ungroupTabs } from "../ops/tab-group-ops.ts";
import type { TabIdList } from "../ops/tab-group-ops.ts";
import { moveTabsToWindow } from "../ops/window-ops.ts";

// ---------- move tabs between windows (drag & drop + context menu) ----------

let draggedTabId: number | null = null; // dataTransfer is unreadable during dragover — track here

// reads what dropSpecFor decides on: the dragged tab, what is under the pointer, the flags
function dropSpec(target: EventTarget | null): DropSpec | null {
  const source = state.allTabs.find((tab) => tab.id === draggedTabId);
  const row = closest(target, ".row");
  const targetTab = row ? state.allTabs.find((tab) => tab.id === Number(row.dataset.tabId)) : null;
  const tgHeader = closest(target, "[data-tab-group-id]");
  const header = closest(target, ".group-header");
  return dropSpecFor(
    source,
    {
      targetTab,
      tabGroupHeaderId: tgHeader ? Number(tgHeader.dataset.tabGroupId) : null,
      headerWindowId: header?.dataset.windowId ? Number(header.dataset.windowId) : null,
    },
    {
      tabGroups: tabGroupsActive(),
      reorder: reorderActive(),
      tabGroupSort: effectiveSort() === "group-tabgroup",
    },
  );
}

export function initTabDnd(): void {
  listEl.addEventListener("dragstart", (event) => {
    const row = closest(event.target, ".row");
    if (!row) {
      return;
    }
    draggedTabId = Number(row.dataset.tabId);
    event.dataTransfer?.setData("text/plain", String(draggedTabId));
    if (event.dataTransfer) {
      event.dataTransfer.effectAllowed = "move";
    }
  });

  listEl.addEventListener("dragover", (event) => {
    if (draggedTabId == null) {
      return;
    }
    const spec = dropSpec(event.target);
    if (!spec) {
      clearDropTarget();
      return; // not a valid target — the browser shows the no-drop cursor
    }
    event.preventDefault();
    if (event.dataTransfer) {
      event.dataTransfer.dropEffect = "move";
    }
    const el = closest(event.target, ".group-header, .tabgroup-header, .row");
    markDropTarget(el);
  });

  listEl.addEventListener("drop", (event) => {
    if (draggedTabId == null) {
      return;
    }
    const spec = dropSpec(event.target);
    if (!spec) {
      return;
    }
    event.preventDefault();
    if (spec.tabGroupId != null) {
      const ids = actionIds(draggedTabId);
      if (spec.tabGroupId === -1) {
        ungroupTabs(ids);
      } else {
        moveTabsToGroup(ids, spec.tabGroupId);
      }
      draggedTabId = null;
      clearDropTarget();
      return;
    }
    const movedIds = actionIds(draggedTabId);
    const movePromise = moveTabsToWindow(movedIds, spec.windowId, spec.index);
    if (spec.regroupId != null) {
      // restore group membership the move just stripped, then repaint
      movePromise
        .then(() =>
          chrome.tabs
            // actionIds never returns an empty list; regroupId!: checked != null above (closure drops the narrowing)
            .group({ tabIds: movedIds as TabIdList, groupId: spec.regroupId! })
            .catch(() => {}),
        )
        .then(() => refresh(true));
    }
    draggedTabId = null;
    clearDropTarget();
  });

  listEl.addEventListener("dragend", () => {
    draggedTabId = null;
    clearDropTarget();
  });
}
