// Keyboard navigation of the panel: "/" focuses search, Esc clears it, arrows move
// the row cursor, Enter activates the row under it.
import { featureEnabled } from "../../../app/core.ts";
import { parkedRef } from "../../../app/parked.ts";
import { closest } from "../../../lib/dom.ts";
import { activate } from "../ops/actions.ts";
import { openParkedTabMenu } from "../menus/parked-menus.ts";
import { listEl, searchInput } from "../foundation/elements.ts";
import { isPopoverOpen } from "../history/history-nav.ts";
import { state } from "../foundation/state.ts";
import { setQuery } from "./toolbar-events.ts";

export function initKeyboardNav(): void {
  document.addEventListener("keydown", (event) => {
    // `/` jumps to the search from anywhere but a text field, where it is a character (the
    // dialog's input, a picker's new-tag name)
    if (
      event.key === "/" &&
      document.activeElement !== searchInput &&
      !closest(event.target, "input, textarea, select, [contenteditable]")
    ) {
      event.preventDefault();
      searchInput.focus();
      return;
    }
    if (event.key === "Escape") {
      // open history popover: the browser closes it on this same Esc (native
      // light dismiss) — don't also clear the search underneath
      if (isPopoverOpen()) {
        return;
      }
      searchInput.value = "";
      setQuery("");
      searchInput.focus();
      return;
    }
    const keyboardNav = featureEnabled(state.features, "SIDEBAR_KEYBOARD_NAVIGATION");
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      if (!keyboardNav) {
        return;
      }
      event.preventDefault();
      if (state.visible.length === 0) {
        return;
      }
      const next =
        event.key === "ArrowDown"
          ? Math.min(state.cursor + 1, state.visible.length - 1)
          : Math.max(state.cursor - 1, 0);
      // move the cursor class directly — a full render per keypress is ~90ms on big lists
      const rows = listEl.querySelectorAll(".row");
      rows[state.cursor]?.classList.remove("cursor");
      state.cursor = next;
      rows[next]?.classList.add("cursor");
      rows[next]?.scrollIntoView({ block: "nearest" });
      return;
    }
    const cursorTab = keyboardNav && state.cursor >= 0 ? state.visible[state.cursor] : undefined;
    if (event.key === "Enter" && cursorTab) {
      if (parkedRef(cursorTab.id)) {
        // a snapshot row has no tab to activate: its menu is the way in, as for a click
        const rect = listEl.querySelectorAll(".row")[state.cursor]?.getBoundingClientRect();
        // `as`: the menu reads only the coordinates
        openParkedTabMenu({ clientX: rect?.left ?? 0, clientY: rect?.bottom ?? 0 } as MouseEvent, cursorTab.id);
        return;
      }
      activate(cursorTab);
      // the recent sort moves the activated tab to the top: the cursor follows; every other sort
      // keeps the row where it is, and so does the cursor
      if (state.sort === "recent") {
        state.cursor = 0;
      }
    }
  });
}
