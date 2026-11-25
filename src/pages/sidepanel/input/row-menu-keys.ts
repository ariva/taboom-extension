// The row menu from the keyboard: "." / the Menu key / Shift+F10 inside the panel, and the Chrome
// command the worker forwards (rebindable at chrome://extensions/shortcuts — a page that takes
// no bare key, which is why "." itself is fixed).
import { featureEnabled } from "../../../app/core.ts";
import type { Message, PanelMessage } from "../../../app/messages.ts";
import { closest } from "../../../lib/dom.ts";
import { isAskDialogOpen } from "../../../lib/ui/ask-dialog.ts";
import { focusCtxMenu } from "../../../lib/ui/context-menu.ts";
import { listEl, searchInput } from "../foundation/elements.ts";
import { state } from "../foundation/state.ts";
import { openListMenu } from "../menus/list-context-menu.ts";
import { isTagAssignPickerOpen } from "./tag-assign-picker.ts";
import { isTagsPickerOpen } from "./tags-chip.ts";

const enabled = (): boolean => featureEnabled(state.features, "SIDEBAR_KEYBOARD_NAVIGATION");

// The menu of the cursor row or cursor header — or, with no cursor, of this window's active tab:
// the row the user is on before any arrow was pressed. Anchored under it, its first item focused.
export function openMenuAtCursor(): void {
  const ownWindowId = state.panelWindowId ?? state.currentWindowId;
  const index =
    state.cursor >= 0 ? state.cursor : state.visible.findIndex((tab) => tab.active && tab.windowId === ownWindowId);
  const place =
    state.cursorGroup === null ? listEl.querySelectorAll(".row")[index] : listEl.querySelector(".group-header.cursor");
  if (!place) {
    return; // the active tab is filtered out of the list: no row to hang a menu on
  }
  place.scrollIntoView({ block: "nearest" });
  const rect = place.getBoundingClientRect();
  // `as`: the menus read only the coordinates. A header without a menu (a domain group) opens none
  if (openListMenu(place, { clientX: rect.left, clientY: rect.bottom } as MouseEvent)) {
    focusCtxMenu();
  }
}

export function initRowMenuKeys(): void {
  // The browser follows the Menu key / Shift+F10 with a contextmenu event for the focused element
  // (on the key's release on Windows, on its press elsewhere) — by then a menu item, outside the
  // list's own handler: without this the native menu would open over ours.
  let nativeMenuDue = false;
  document.addEventListener("keydown", (event) => {
    const overlayOpen = isAskDialogOpen() || isTagsPickerOpen() || isTagAssignPickerOpen();
    if (!enabled() || overlayOpen) {
      return;
    }
    const field = closest(event.target, "input, textarea, select, [contenteditable]");
    const menuKey = event.key === "ContextMenu" || (event.key === "F10" && event.shiftKey);
    // the search is where the arrows are pressed from; any other field keeps its own menu
    const menuKeyHere = menuKey && (field === null || field === searchInput);
    const modified = event.ctrlKey || event.altKey || event.metaKey;
    const period = event.key === "." && !modified && field === null; // a character in a text field
    if (!menuKeyHere && !period) {
      return;
    }
    event.preventDefault();
    nativeMenuDue = menuKeyHere;
    openMenuAtCursor();
  });
  document.addEventListener(
    "contextmenu",
    (event) => {
      if (nativeMenuDue) {
        nativeMenuDue = false;
        event.preventDefault();
        event.stopPropagation();
      }
    },
    true,
  );
  // after the release's own contextmenu (Windows) had its turn: a later right-click is a real one
  document.addEventListener("keyup", () => setTimeout(() => (nativeMenuDue = false)));
  // every extension page hears every runtime message: the pages' own (for the worker) pass by
  chrome.runtime.onMessage.addListener((message: Message | PanelMessage) => {
    if (message.type === "open-row-menu" && message.windowId === state.panelWindowId && enabled()) {
      openMenuAtCursor();
    }
  });
}
