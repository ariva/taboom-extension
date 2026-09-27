// Capture-phase Escape: closes the context menu, else the windows popover, before the
// bubble-phase keyboard navigation sees the key.
import { isAskDialogOpen } from "../../../lib/ui/ask-dialog.ts";
import { hideCtxMenu, isCtxMenuOpen } from "../../../lib/ui/context-menu.ts";
import { winPop } from "../foundation/elements.ts";
import { winPopOpen } from "../windows-popover/popover.ts";

export function initGlobalKeys(): void {
  // capture phase: an Esc that closes the menu must not also clear the search
  document.addEventListener(
    "keydown",
    (event) => {
      if (isAskDialogOpen()) {
        return; // Esc belongs to the modal dialog — the popover behind it stays
      }
      if (event.key === "Escape" && isCtxMenuOpen()) {
        hideCtxMenu();
        event.stopPropagation();
      } else if (
        event.key === "Escape" &&
        winPopOpen() &&
        // Esc in a rename input cancels the rename (inlineEdit), popover stays
        // Partial: a key event can target the document, which has no matches()
        !(event.target as Partial<Element>).matches?.(".rename-input")
      ) {
        winPop.hidePopover?.();
        event.stopPropagation();
      }
    },
    true,
  );
}
