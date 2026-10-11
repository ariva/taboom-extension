// ☰ in the titlebar opens the quick-actions menu (Open Settings, Cleanup Duplicates).
import { getElementById } from "../../../lib/dom.ts";
import { closeDropdown } from "../../../lib/ui/dropdown.ts";
import { winPop } from "../foundation/elements.ts";
import { openQuickActionsMenu } from "../menus/quick-actions-menu.ts";

const histPop = getElementById("history-pop");

// one popup at a time: whatever is open (quick launch, history list, a toolbar dropdown)
// goes before the menu shows. The quick launch is a manual popover, so nothing else
// would close it; the other two mostly dismiss themselves, this makes it certain
function hideOtherPopups(): void {
  for (const popup of [winPop, histPop]) {
    try {
      popup.hidePopover?.();
    } catch {} // already hidden
  }
  closeDropdown();
}

export function initQuickActions(): void {
  const button = getElementById("quick-actions-btn");
  button.addEventListener("click", (event) => {
    event.stopPropagation(); // the document click-away would close the menu this opens
    hideOtherPopups();
    // anchor under the button, not at the pointer — a keyboard "click" has no useful coordinates
    const box = button.getBoundingClientRect();
    openQuickActionsMenu({ clientX: box.left, clientY: box.bottom + 4 });
  });
}
