// The browser's side panel (Chromium: chrome.sidePanel). The one place that
// knows how a panel is opened and tied to the toolbar button.

// needs a user gesture — rejects without one
export function openPanel(windowId: number): Promise<void> {
  return chrome.sidePanel.open({ windowId });
}

// toolbar button click opens the panel
export function openPanelOnActionClick(): Promise<void> {
  return chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
}
