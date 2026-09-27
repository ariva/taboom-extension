// Click delegation for the tab list: row checkbox, row action buttons, row activation.
import { send } from "../../../app/messages.ts";
import { activate, closeTabs, snooze } from "../ops/actions.ts";
import { listEl } from "../foundation/elements.ts";
import { hideHoverTip } from "../render/hover-tip.ts";
import { render } from "../foundation/scheduler.ts";
import { state } from "../foundation/state.ts";

// One delegated click listener instead of ~6 listeners per row — with big
// lists that's thousands of listener allocations saved on every render.
export function initListEvents(): void {
  listEl.addEventListener("click", (event) => {
    hideHoverTip(); // toggling changes the tip text; rehover shows fresh
    const target = event.target as HTMLElement; // clicks inside the list land on elements
    const row = target.closest<HTMLElement>(".row");
    if (!row) {
      return; // group headers keep their own handlers
    }
    const tabId = Number(row.dataset.tabId);
    if (target.matches('input[type="checkbox"]')) {
      if ((target as HTMLInputElement).checked) {
        // matched input[type="checkbox"] just above
        state.selected.add(tabId);
      } else {
        state.selected.delete(tabId);
      }
      render(false); // group checkboxes + header tips reflect selection too
      return;
    }
    const button = target.closest<HTMLElement>("[data-action]");
    switch (button?.dataset.action) {
      case "snooze":
        snooze([tabId]);
        return;
      case "toggle-protect":
        send({ type: "toggle-site-protection", tabId });
        return;
      case "close":
        closeTabs([tabId]);
        return;
    }
    const tab = state.allTabs.find((t) => t.id === tabId);
    if (tab) {
      activate(tab);
    }
  });
}
