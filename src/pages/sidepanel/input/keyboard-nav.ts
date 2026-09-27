// Keyboard navigation of the panel: "/" focuses search, Esc clears it, arrows move
// the row cursor, Enter activates the row under it.
import { featureEnabled } from "../../../app/core.ts";
import { activate } from "../ops/actions.ts";
import { listEl, searchInput } from "../foundation/elements.ts";
import { isPopoverOpen } from "../history/history-nav.ts";
import { state } from "../foundation/state.ts";
import { setQuery } from "./toolbar-events.ts";

export function initKeyboardNav(): void {
  document.addEventListener("keydown", (event) => {
    if (event.key === "/" && document.activeElement !== searchInput) {
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
    if (event.key === "Enter" && keyboardNav && state.cursor >= 0 && state.visible[state.cursor]) {
      activate(state.visible[state.cursor]!); // checked in the condition above
      // activated tab jumps to the top of the list — put the cursor back on it
      state.cursor = 0;
    }
  });
}
