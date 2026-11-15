// The browser's side panel: Chromium's chrome.sidePanel or Firefox's sidebarAction. The one
// place that knows how a panel is opened and tied to the toolbar button.
import { capabilities, sidebarAction } from "./capabilities.ts";

// Each browser's branch is guarded by its build-time constant too (build-target.d.ts): the Firefox
// bundle carries no sidePanel call (AMO's validator reads code it would otherwise never run), the
// Chrome bundle no sidebarAction. Inside a build the capability still decides at run time.

// needs a user gesture — rejects without one. Firefox's sidebar opens in the active window
// only (sidebarAction.open takes no window): a request for another window lands in this one
export function openPanel(windowId: number): Promise<void> {
  if (__CHROME__ && capabilities.sidePanel) {
    return chrome.sidePanel.open({ windowId });
  }
  const sidebar = __FIREFOX__ ? sidebarAction() : undefined;
  if (sidebar) {
    return sidebar.open();
  }
  return Promise.reject(new Error("no side panel API in this browser"));
}

// toolbar button click opens the panel. Firefox has no such setting: there the click is a
// listener (toggleSidebarOnActionClick), so this resolves with nothing to do
export function openPanelOnActionClick(): Promise<void> {
  if (__CHROME__ && capabilities.sidePanel) {
    return chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
  }
  return Promise.resolve();
}

// Firefox: the toolbar button toggles the sidebar. A listener, so it must be registered
// synchronously at worker start like every other; a browser with a side panel registers
// nothing — the panel behaviour above already answers the click there
export function toggleSidebarOnActionClick(): void {
  const sidebar = __FIREFOX__ ? sidebarAction() : undefined;
  if (!sidebar || (__CHROME__ && capabilities.sidePanel)) {
    return;
  }
  chrome.action.onClicked.addListener(() => {
    sidebar.toggle().catch(() => {});
  });
}
