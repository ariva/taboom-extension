// Keyboard navigation of the panel: "/" focuses search, Esc clears it, arrows move
// the row cursor (and take the focus out of the search; Up from the first row gives it back),
// Enter activates the row under it, Space ticks it, Left / Right step through the filter chips.
import { featureEnabled } from "../../../app/core.ts";
import { parkedRef } from "../../../app/parked.ts";
import { closest } from "../../../lib/dom.ts";
import { activate } from "../ops/actions.ts";
import { openMenuAtCursor } from "./row-menu-keys.ts";
import { filterBar, listEl, searchInput } from "../foundation/elements.ts";
import { isPopoverOpen } from "../history/history-nav.ts";
import { render } from "../foundation/scheduler.ts";
import { state } from "../foundation/state.ts";
import { clearSearch, setFilter } from "./toolbar-events.ts";

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
      clearSearch();
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
      // Up from the first row is the way back to the search; with a query its first result keeps
      // the cursor, as while typing (Enter opens it)
      const toSearch = event.key === "ArrowUp" && state.cursor <= 0;
      const next = toSearch
        ? Math.min(searchInput.value ? 0 : -1, state.cursor)
        : event.key === "ArrowDown"
          ? Math.min(state.cursor + 1, state.visible.length - 1)
          : state.cursor - 1;
      // move the cursor class directly — a full render per keypress is ~90ms on big lists
      const rows = listEl.querySelectorAll(".row");
      rows[state.cursor]?.classList.remove("cursor");
      state.cursor = next;
      rows[next]?.classList.add("cursor");
      rows[next]?.scrollIntoView({ block: "nearest" });
      if (toSearch) {
        searchInput.focus();
        searchInput.setSelectionRange(searchInput.value.length, searchInput.value.length);
      } else {
        // list mode: with the focus out of the field the keys are the list's — Space ticks, "."
        // opens the menu — and none of them lands in the query
        searchInput.blur();
      }
      return;
    }
    const cursorTab = keyboardNav && state.cursor >= 0 ? state.visible[state.cursor] : undefined;
    const modified = event.ctrlKey || event.altKey || event.metaKey;
    // a focused field, button, header, dialog or menu keeps its own Space and arrows
    const ownKeys = closest(event.target, "input, textarea, select, button, a, [contenteditable], [role], dialog");
    const listKeys = keyboardNav && !modified && ownKeys === null;
    if (listKeys && (event.key === "ArrowLeft" || event.key === "ArrowRight")) {
      // the chips shown, in their order; no wrap, so holding a key ends on All or on the last one.
      // Tags reached this way filters without opening its picker — that is the click's
      const chips = [...filterBar.querySelectorAll<HTMLElement>("button[data-filter]")].filter((chip) => !chip.hidden);
      const at = chips.findIndex((chip) => chip.dataset.filter === state.filter);
      const next = chips[at + (event.key === "ArrowRight" ? 1 : -1)]?.dataset.filter;
      event.preventDefault();
      if (at >= 0 && next !== undefined) {
        setFilter(next);
      }
      return;
    }
    if (event.key === " " && cursorTab && listKeys) {
      event.preventDefault(); // no page scroll
      if (!state.selected.delete(cursorTab.id)) {
        state.selected.add(cursorTab.id);
      }
      render(false);
      return;
    }
    if (event.key === "Enter" && cursorTab) {
      if (parkedRef(cursorTab.id)) {
        openMenuAtCursor(); // a snapshot row has no tab to activate: its menu is the way in, as for a click
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
  // The cursor belongs to one stretch of keyboard use: focus leaving the panel (the page, another
  // window) ends it. Left in place, its outline reads as a second selection next to the active
  // tab's, and the next arrow press would resume from a row the user no longer has in mind.
  window.addEventListener("blur", () => {
    if (state.cursor < 0) {
      return;
    }
    state.cursor = -1;
    listEl.querySelector(".row.cursor")?.classList.remove("cursor");
  });
}
