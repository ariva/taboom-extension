// Right-click on the tab list: picks the row / tab-group / window-header menu, and hides
// an open menu when the list scrolls.
import { closest } from "../../../lib/dom.ts";
import { hideCtxMenu } from "../../../lib/ui/context-menu.ts";
import { listEl } from "../foundation/elements.ts";
import { hideHoverTip } from "../render/hover-tip.ts";
import { openRowMenu, openTabGroupMenu, openWindowHeaderMenu } from "./menus.ts";

export function initListContextMenu(): void {
  listEl.addEventListener("contextmenu", (event) => {
    const target = event.target;
    const header = closest(target, ".group-header");
    const row = closest(target, ".row");
    const tgHeaderEl = closest(target, "[data-tab-group-id]");
    // "No group" bucket (-1) is a drop target but has no menu — keep native there
    const tgHeader = tgHeaderEl && Number(tgHeaderEl.dataset.tabGroupId) !== -1 ? tgHeaderEl : null;
    if (!header?.dataset.windowId && !row && !tgHeader) {
      return; // non-window headers/empty space keep the native menu
    }
    event.preventDefault();
    hideHoverTip();
    if (tgHeader) {
      openTabGroupMenu(event, Number(tgHeader.dataset.tabGroupId));
    } else if (header?.dataset.windowId) {
      openWindowHeaderMenu(event, Number(header.dataset.windowId));
    } else if (row) {
      openRowMenu(event, Number(row.dataset.tabId));
    }
  });
  listEl.addEventListener("scroll", hideCtxMenu, { passive: true });
}
