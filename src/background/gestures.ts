// User gestures outside the pages — keyboard commands and context-menu clicks —
// routed to the feature modules.
import { isSupportedUrl } from "../app/core.ts";
import { openPanel } from "../lib/platform/panel.ts";
import { toggleSiteProtection } from "./protection.ts";
import { autoSnoozePass, snoozeTab } from "./snooze.ts";
import { historyJump } from "./tab-history.ts";

// commands.onCommand
export async function runCommand(command: string): Promise<void> {
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  if (!tab) {
    return;
  }
  switch (command) {
    case "open-tab-manager":
      await openPanel(tab.windowId);
      break;
    case "snooze-current-tab":
      await snoozeTab(tab.id!); // tabs from tabs.query always carry an id (only sessions-API tabs lack one)
      break;
    case "toggle-protection":
      await toggleSiteProtection(tab);
      break;
  }
}

// contextMenus.onClicked
export async function runMenuClick(info: chrome.contextMenus.OnClickData, tab?: chrome.tabs.Tab): Promise<void> {
  if (typeof info.menuItemId === "string" && info.menuItemId.startsWith("hist-")) {
    return historyJump(Number(info.menuItemId.slice(5)));
  }
  switch (info.menuItemId) {
    case "show-manager":
      if (tab) {
        await openPanel(tab.windowId);
      }
      break;
    case "snooze-this-tab":
      if (tab) {
        await snoozeTab(tab.id!); // the clicked page's tab always carries an id (only sessions-API tabs lack one)
      }
      break;
    case "protect-this-site":
      if (tab && isSupportedUrl(tab.url)) {
        await toggleSiteProtection(tab);
      }
      break;
    case "snooze-all-inactive":
      await autoSnoozePass();
      break;
  }
}
