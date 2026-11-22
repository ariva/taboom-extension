// What this browser offers, feature-detected — never a browser-name check.
// A missing capability hides the feature, like a disabled feature flag does.
// Getters, not constants: detection runs at the point of use, after test setup
// has installed its chrome global.

// Firefox's sidebar API lives on its `browser` namespace only (Chrome's `browser`, 148+,
// is an alias of `chrome` and has none); typed here because @types/chrome cannot know it
export interface SidebarAction {
  open: () => Promise<void>;
  toggle: () => Promise<void>;
}

export function sidebarAction(): SidebarAction | undefined {
  const namespaces = globalThis as { browser?: { sidebarAction?: SidebarAction } };
  return namespaces.browser?.sidebarAction ?? (chrome as unknown as { sidebarAction?: SidebarAction }).sidebarAction;
}

// Firefox 137+ on desktop: opens the browser's shortcut page for extensions (about:addons →
// Manage Extension Shortcuts), which an extension cannot open by address. Chrome and Firefox for
// Android have no such call; typed here because @types/chrome cannot know it
export function shortcutSettingsOpener(): (() => Promise<void>) | undefined {
  const commands = chrome.commands as unknown as { openShortcutSettings?: () => Promise<void> } | undefined;
  return commands?.openShortcutSettings;
}

export const capabilities = {
  get tabGroups(): boolean {
    return Boolean(chrome.tabGroups);
  },
  // Chromium's side panel (sidePanel.open / setPanelBehavior)
  get sidePanel(): boolean {
    return Boolean(chrome.sidePanel);
  },
  // Firefox's sidebar (sidebarAction.open / toggle)
  get sidebar(): boolean {
    return sidebarAction() !== undefined;
  },
  // the browser's local favicon store behind the "favicon" permission (Chromium's _favicon/);
  // without it a row shows the host's initial — a site URL in an <img> would hit the network
  get cachedFavicons(): boolean {
    return chrome.runtime.getManifest().permissions?.includes("favicon") === true;
  },
  // tabs.onReplaced: Chromium swaps a tab's id on a discard or prerender; Firefox never does
  get tabReplacement(): boolean {
    return Boolean(chrome.tabs.onReplaced);
  },
};
