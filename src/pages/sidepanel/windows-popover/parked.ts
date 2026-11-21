// Parked rows of the quick launch's Windows view: under the live windows, one row per
// parked window (newest first) — click restores it (confirmed), ⋯ / right-click opens the
// parked window menu.
import { parkedNewestFirst, parkedWindowId, parkedWindowLabel } from "../../../app/parked.ts";
import { winPop } from "../foundation/elements.ts";
import { state } from "../foundation/state.ts";
import { parkedOf, restoreParkedPrompt } from "../ops/parked-ops.ts";
import { pluralize } from "../../../app/plural.ts";

// parked windows, newest first, as the synthetic ids their menu works on
export function parkedRowsNewestFirst(): number[] {
  return parkedNewestFirst(state.parked).map(parkedWindowId);
}

export function fillParkedRows(onMenu: (event: MouseEvent, windowId: number) => void): void {
  const rows = parkedRowsNewestFirst();
  if (rows.length === 0) {
    return;
  }
  const heading = document.createElement("div");
  heading.className = "win-section muted";
  heading.textContent = `Parked (${rows.length})`;
  winPop.append(heading);
  for (const id of rows) {
    const parked = parkedOf(id);
    if (!parked) {
      continue;
    }
    const row = document.createElement("button");
    row.type = "button";
    row.className = "win-row parked";
    row.dataset.windowId = String(id); // right-click → parked window menu (negative id)
    const dot = document.createElement("span");
    dot.className = "win-dot";
    const name = document.createElement("span");
    name.className = "win-title";
    name.textContent = parkedWindowLabel(parked);
    const tabs = parked.tabs.length;
    const groups = parked.groups.length;
    const stats = document.createElement("span");
    stats.className = "win-stats muted";
    stats.textContent = [
      `${pluralize(tabs, "tab")}`,
      ...(groups > 0 ? [`${pluralize(groups, "group")}`] : []),
      `parked ${new Date(parked.parkedAt).toLocaleString()}`,
    ].join(" · ");
    row.append(dot, name, stats);
    // native title like the live rows (the popover is in the top layer, above #hover-tip)
    row.title = [name.textContent, stats.textContent, ...parked.tabs.map((tab) => tab.title || tab.url)].join("\n");
    row.addEventListener("click", async () => {
      if (await restoreParkedPrompt(id)) {
        winPop.hidePopover?.(); // the window is back — same exit as focusing a live one
      }
    });
    const menuBtn = document.createElement("button");
    menuBtn.type = "button";
    menuBtn.className = "win-menu-btn";
    menuBtn.title = menuBtn.ariaLabel = "Window actions";
    menuBtn.textContent = "⋯";
    menuBtn.addEventListener("click", (event) => {
      event.stopPropagation();
      onMenu(event, id);
    });
    const item = document.createElement("div");
    item.className = "win-item";
    item.append(row, menuBtn);
    winPop.append(item);
  }
}
