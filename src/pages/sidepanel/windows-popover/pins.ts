// Pins view of the windows popover: one row per pinned tab.
import { activate } from "../ops/actions.ts";
import { winPop } from "../foundation/elements.ts";
import { openRowMenu } from "../menus/menus.ts";
import type { WindowMaps } from "../model/index.ts";
import type { PanelTab } from "../foundation/state.ts";
import { windowLabel } from "../ops/window-ops.ts";

// Pins view: every pinned tab — click activates it, ⋯/right-click = row menu
export function fillPinRows(pinnedTabs: PanelTab[], maps: WindowMaps): void {
  const sorted = [...pinnedTabs].sort((a, b) => a.windowId - b.windowId || (a.index ?? 0) - (b.index ?? 0));
  for (const tab of sorted) {
    const row = document.createElement("button");
    row.type = "button";
    row.className = "win-row";
    row.dataset.tabId = String(tab.id);
    const dot = document.createElement("span");
    dot.className = "win-dot";
    const color = maps.dotColors.get(tab.windowId);
    if (color) {
      dot.style.background = color;
    } else {
      dot.classList.add("current");
    }
    const name = document.createElement("span");
    name.className = "win-title";
    name.textContent = tab.title || tab.url || "(tab)";
    const stats = document.createElement("span");
    stats.className = "win-stats muted";
    stats.textContent = windowLabel(tab.windowId);
    row.append(dot, name, stats);
    row.title = [tab.title, tab.url, `In ${windowLabel(tab.windowId)}`].filter(Boolean).join("\n");
    row.addEventListener("click", () => {
      winPop.hidePopover?.();
      activate(tab);
    });
    const menuBtn = document.createElement("button");
    menuBtn.type = "button";
    menuBtn.className = "win-menu-btn";
    menuBtn.title = menuBtn.ariaLabel = "Tab actions";
    menuBtn.textContent = "⋯";
    menuBtn.addEventListener("click", (event) => {
      event.stopPropagation();
      openRowMenu(event, tab.id);
    });
    const item = document.createElement("div");
    item.className = "win-item";
    item.append(row, menuBtn);
    winPop.append(item);
  }
}
