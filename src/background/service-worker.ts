// Service-worker ENTRY (the manifest path): registers every chrome event
// listener synchronously at module evaluation — MV3 only wakes the worker for
// listeners registered that way — and hands each event to its feature module.
// Same-event listeners run in registration order; keep the order below.
import type { Message } from "../app/messages.ts";
import { runCommand, runMenuClick } from "./gestures.ts";
import { onKeepAliveAlarm, syncKeepAliveMenu, syncKeepAliveMenuOnNavigation } from "./keep-alive.ts";
import { init, noteUpdateAvailable } from "./lifecycle.ts";
import { handleMessage } from "./messages.ts";
import { reprotectOnNavigation, syncProtectMenu } from "./protection.ts";
import { onAlarm } from "./snooze.ts";
import { onStorageChanged } from "./storage-changes.ts";
import { dropClosedTabs, recordActivation, recordWindowFocus, replaceTabId } from "./tab-history.ts";
import { refreshOnTabChange, scheduleProfileRefresh, trackPanelPort } from "./window-profiles.ts";

// ---------- lifecycle ----------

chrome.runtime.onInstalled.addListener(init);
chrome.runtime.onStartup.addListener(init);

chrome.runtime.onUpdateAvailable.addListener(noteUpdateAvailable);

// ---------- auto snooze ----------

chrome.alarms.onAlarm.addListener(onAlarm);

// ---------- keep-it-alive sweep ----------

chrome.alarms.onAlarm.addListener(onKeepAliveAlarm);

// ---------- messages from side panel / options ----------

chrome.runtime.onMessage.addListener((message: Message, _sender, sendResponse) => {
  handleMessage(message)
    .then((result) => sendResponse(result ?? { ok: true }))
    .catch((error) => sendResponse({ error: String(error) }));
  return true;
});

// ---------- settings / rules changes ----------

chrome.storage.onChanged.addListener(onStorageChanged);

chrome.tabs.onActivated.addListener(async ({ tabId }) => {
  const tab = await chrome.tabs.get(tabId).catch(() => null);
  syncProtectMenu(tab);
  syncKeepAliveMenu(tab);
});

// ---------- tab history (back/forward across tabs) ----------

chrome.tabs.onActivated.addListener(({ tabId }) => recordActivation(tabId));
chrome.windows.onFocusChanged.addListener(recordWindowFocus);
chrome.tabs.onRemoved.addListener(dropClosedTabs);
chrome.tabs.onReplaced.addListener(replaceTabId);

chrome.tabs.onUpdated.addListener(reprotectOnNavigation);
chrome.tabs.onUpdated.addListener(syncKeepAliveMenuOnNavigation);

// ---------- keyboard commands + context menus ----------

chrome.commands.onCommand.addListener(runCommand);
chrome.contextMenus.onClicked.addListener(runMenuClick);

// ---------- window identity ----------

// membership + placement changes: create/close/rearrange/move between windows
for (const identityEvent of [
  chrome.tabs.onCreated,
  chrome.tabs.onRemoved,
  chrome.tabs.onMoved,
  chrome.tabs.onAttached,
  chrome.tabs.onDetached,
  chrome.windows.onCreated,
  chrome.windows.onRemoved,
]) {
  identityEvent.addListener(scheduleProfileRefresh);
}
chrome.tabs.onUpdated.addListener(refreshOnTabChange);
scheduleProfileRefresh(); // worker start doubles as the restart-recovery pass

// ---------- panel-open tracking + restore ----------

chrome.runtime.onConnect.addListener(trackPanelPort);
