// The runtime.onMessage dispatcher: one exhaustive switch over the Message
// union, delegating to the feature modules.
import { removeHistoryAt } from "../app/core.ts";
import type { Message } from "../app/messages.ts";
import { setTabsKeepAlive } from "./keep-alive.ts";
import { protectHosts, protectUrls, toggleSiteProtection, unprotectUrls } from "./protection.ts";
import { autoSnoozePass, recordWakes, snoozeTab } from "./snooze.ts";
import { historyJump, historyStep, withHistory } from "./tab-history.ts";
import { panelsToRestore, patchWindowProfiles, setPanelOpen } from "./window-profiles.ts";

export async function handleMessage(message: Message): Promise<{ protected: boolean } | { windows: number[] } | void> {
  switch (message.type) {
    case "snooze-tab":
      return snoozeTab(message.tabId);
    case "toggle-site-protection":
      return toggleSiteProtection(await chrome.tabs.get(message.tabId));
    case "protect-hosts":
      return protectHosts(message.hosts);
    case "protect-urls":
      return protectUrls(message.urls);
    case "unprotect-urls":
      return unprotectUrls(message.urls);
    case "snooze-all-inactive":
      return autoSnoozePass();
    case "history-back":
      return historyStep(-1);
    case "history-forward":
      return historyStep(1);
    case "history-jump":
      return historyJump(message.index);
    case "history-remove":
      return withHistory((hist) => removeHistoryAt(hist, message.index));
    case "panels-to-restore":
      return panelsToRestore(message.excludeWindowId);
    case "panels-restore-dismiss":
      // user declined — forget those windows so the offer doesn't come back
      return setPanelOpen(message.windowIds, false);
    case "window-rename":
      // empty name clears — undefined is dropped by the storage write
      return patchWindowProfiles([message.windowId], { name: message.name?.trim() || undefined });
    case "window-set-color":
      return patchWindowProfiles([message.windowId], { color: message.color || undefined });
    case "tabs-woken":
      return recordWakes(message.tabIds);
    case "window-pin":
      // "pinnedWindow", not "pinned" — the fingerprint already owns that key
      return patchWindowProfiles([message.windowId], { pinnedWindow: message.pinned || undefined });
    case "keep-alive-set": {
      const tabs = await Promise.all(message.tabIds.map((tabId) => chrome.tabs.get(tabId).catch(() => null)));
      return setTabsKeepAlive(
        tabs.filter((tab): tab is chrome.tabs.Tab => tab !== null),
        message.kept,
      );
    }
    case "sidebar-focused":
    case "sidebar-no-focus":
      return; // acknowledged; no behavior yet — hook points for future focus-aware features
    default:
      // every Message member is handled above, so `message` is `never` here — but
      // senders are untyped JS, so an unknown type can still arrive at runtime
      throw new Error(`unknown message ${(message as { type: string }).type}`);
  }
}
