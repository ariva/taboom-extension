// Alive view of the windows popover: one row per keep-alive mark, in Settings order.
// A mark with an open tab is a Pins-style row (click activates); one without is a
// muted "not open" row whose click opens the page — a closed or navigated-away tab
// must not make the mark vanish from the list.
import { keepAliveKey } from "../../../app/keep-alive.ts";
import type { KeepAliveTab } from "../../../app/types.ts";
import { winPop } from "../foundation/elements.ts";
import type { PanelTab } from "../foundation/state.ts";
import { openMarkMenu } from "../menus/menus.ts";
import type { WindowMaps } from "../model/index.ts";
import { fillPinRows } from "./pins.ts";

export function fillAliveRows(marks: KeepAliveTab[], tabs: PanelTab[], maps: WindowMaps): void {
  for (const mark of marks) {
    const open = tabs.find((tab) => keepAliveKey(tab.url) === mark.url);
    if (open) {
      fillPinRows([open], maps, () => mark.paused ?? false);
      continue;
    }
    const row = document.createElement("button");
    row.type = "button";
    row.className = "win-row missing";
    row.dataset.keepAliveUrl = mark.url; // right-click → openMarkMenu (popover.ts)
    const name = document.createElement("span");
    name.className = "win-title";
    name.textContent = mark.title || mark.url;
    const stats = document.createElement("span");
    stats.className = "win-stats muted";
    stats.textContent = "not open"; // nothing reloads anyway — "paused" would add nothing
    row.append(name, stats);
    row.title = `${mark.url}\nNot open in any window — click to open it`;
    row.addEventListener("click", () => {
      winPop.hidePopover?.();
      chrome.tabs.create({ url: mark.url });
    });
    const menuBtn = document.createElement("button");
    menuBtn.type = "button";
    menuBtn.className = "win-menu-btn";
    menuBtn.title = menuBtn.ariaLabel = "Mark actions";
    menuBtn.textContent = "⋯";
    menuBtn.addEventListener("click", (event) => {
      event.stopPropagation();
      openMarkMenu(event, mark);
    });
    const item = document.createElement("div");
    item.className = "win-item";
    item.append(row, menuBtn);
    winPop.append(item);
  }
}
