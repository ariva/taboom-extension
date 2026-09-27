// Live updates: chrome.tabs / tabGroups / windows / storage events → one debounced refresh.
import { capabilities } from "../../../lib/platform/capabilities.ts";
import { refresh } from "../foundation/scheduler.ts";
import { clearOwnUiWrite, ownUiWrite } from "./toolbar-events.ts";

// Tab/storage events → debounced refresh. Querying Chrome fresh each time
// avoids incremental-cache sync bugs; cheap for a few hundred tabs.
let refreshTimer: ReturnType<typeof setTimeout> | undefined;
function scheduleRefresh(): void {
  clearTimeout(refreshTimer);
  refreshTimer = setTimeout(refresh, 150);
}

for (const event of [
  chrome.tabs.onCreated,
  chrome.tabs.onActivated,
  chrome.tabs.onRemoved,
  chrome.tabs.onMoved,
  chrome.tabs.onAttached,
  chrome.tabs.onDetached,
  chrome.windows.onFocusChanged,
  ...(capabilities.tabGroups
    ? [chrome.tabGroups.onCreated, chrome.tabGroups.onRemoved, chrome.tabGroups.onUpdated, chrome.tabGroups.onMoved]
    : []),
]) {
  event.addListener(scheduleRefresh);
}

// onUpdated fires for every tab's loading progress — with hundreds of tabs that's
// a constant stream; only changes the list actually shows should trigger a render
const RENDERED_TAB_PROPS = ["title", "url", "favIconUrl", "discarded", "audible", "pinned", "groupId"];
chrome.tabs.onUpdated.addListener((_tabId, changeInfo) => {
  if (RENDERED_TAB_PROPS.some((prop) => prop in changeInfo)) {
    scheduleRefresh();
  }
});

// our own perf flush + history bookkeeping write storage constantly — don't
// let those echo back into renders (history buttons have their own listener)
chrome.storage.onChanged.addListener((changes) => {
  const ignored = [
    "perfMetrics",
    "perfSnapshots",
    "tabHistory",
    "updateAvailable",
    "dismissedUpdate",
    "windowProfiles",
    "windowSessionMap", // identity bookkeeping churns on every tab event
  ];
  const relevant = Object.keys(changes).filter((key) => !ignored.includes(key));
  if (relevant.length === 0) {
    return;
  }
  // this panel's own ui-prefs write echoing back — already rendered that state
  if (
    relevant.length === 1 &&
    relevant[0] === "ui" &&
    JSON.stringify(changes.ui!.newValue) === ownUiWrite() // relevant[0] === "ui": the key is present
  ) {
    clearOwnUiWrite();
    return;
  }
  scheduleRefresh();
});
