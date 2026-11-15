// The extension manifest as code. One source, emitted as manifest.json by
// tooling/manifest-plugin.ts. `target` picks the browser: the shared body is the same,
// each tail holds only what that browser has no choice about (T-0152).
export type BuildTarget = "chrome" | "firefox";

// Firefox keys @types/chrome does not know: the event-page background (Firefox has no
// extension service workers — bug 1573659), the sidebar and the AMO settings
export interface FirefoxManifestKeys {
  background?: { scripts: string[]; type?: "module" };
  sidebar_action?: {
    default_panel: string;
    default_title?: string;
    default_icon?: Record<string, string>;
    open_at_install?: boolean;
  };
  browser_specific_settings?: {
    gecko: {
      id: string;
      strict_min_version?: string;
      // mandatory for every AMO submission since 2025-11-03; "none" = nothing is collected
      data_collection_permissions?: { required: string[]; optional?: string[] };
    };
    gecko_android?: { strict_min_version?: string };
  };
}
export type Manifest = Omit<chrome.runtime.ManifestV3, "background"> &
  Omit<FirefoxManifestKeys, "background"> & {
    background?: chrome.runtime.ManifestV3["background"] | FirefoxManifestKeys["background"];
  };

const NAME = "Taboom - Tabs Manager by ariva-tools";
const TITLE = "Taboom - Tabs Manager";
const WORKER = "background/service-worker.js";
const PANEL = "sidepanel/index.html";
const ACTION_ICON = { 16: "icons/icon16.png", 32: "icons/icon32.png" };
// what both browsers need; sidePanel and favicon are Chrome's — an unknown permission makes
// Firefox refuse to load the add-on
const PERMISSIONS = ["tabs", "tabGroups", "storage", "alarms", "contextMenus"];
// never change after the first AMO upload: it IS the extension's identity there (T-0152 D8)
export const GECKO_ID = "taboom-tabs-manager@ariva-tools.com";
// tab groups complete at 139; 140 is the ESR that carries them
export const FIREFOX_MIN_VERSION = "140.0";
// Android is not targeted (the sidebar is desktop-only), but the gecko minimum applies there too and
// data_collection_permissions arrived on Android with 142: this keeps AMO's validator quiet
export const FIREFOX_ANDROID_MIN_VERSION = "142.0";

export function manifest(version: string, target: BuildTarget = "chrome"): Manifest {
  const shared: Manifest = {
    manifest_version: 3,
    name: NAME,
    description:
      "Taboom - Privacy-first smart Tabs Manager to search, snooze, and protect Chrome tabs. Saves memory, runs fully locally.",
    version,
    action: { default_title: "Taboom - Smart Tabs Manager", default_icon: ACTION_ICON },
    icons: { ...ACTION_ICON, 48: "icons/icon48.png", 128: "icons/icon128.png" },
    // options_ui + open_in_tab opens the page in a tab in both browsers (options_page is Chrome-only)
    options_ui: { page: "options/index.html", open_in_tab: true },
    commands: {
      "open-tab-manager": {
        suggested_key: {
          default: "Ctrl+Shift+Space",
          mac: "Command+Shift+Space",
        },
        description: "Open Taboom side panel",
      },
      "snooze-current-tab": {
        description: "Snooze current tab",
      },
      "toggle-protection": {
        description: "Toggle site protection for current tab",
      },
      // "<" and ">" keys: free in Chrome on every platform and, unlike Ctrl+Shift+Arrow,
      // they steal no text-editing shortcut from web pages (commands are browser-wide).
      // Chrome allows at most 4 commands with a suggested key — this uses 3.
      "history-back": {
        suggested_key: {
          default: "Ctrl+Shift+Comma",
          mac: "Command+Shift+Comma",
        },
        description: "Tab history: back to the previous tab",
      },
      "history-forward": {
        suggested_key: {
          default: "Ctrl+Shift+Period",
          mac: "Command+Shift+Period",
        },
        description: "Tab history: forward to the next tab",
      },
    },
  };
  if (target === "firefox") {
    return {
      ...shared,
      permissions: PERMISSIONS,
      background: { scripts: [WORKER], type: "module" },
      // open_at_install: Firefox would pop the sidebar open right after the install
      sidebar_action: { default_panel: PANEL, default_title: TITLE, default_icon: ACTION_ICON, open_at_install: false },
      browser_specific_settings: {
        gecko: {
          id: GECKO_ID,
          strict_min_version: FIREFOX_MIN_VERSION,
          data_collection_permissions: { required: ["none"] },
        },
        gecko_android: { strict_min_version: FIREFOX_ANDROID_MIN_VERSION },
      },
    };
  }
  return {
    ...shared,
    minimum_chrome_version: "121",
    permissions: [...PERMISSIONS, "sidePanel", "favicon"],
    background: { service_worker: WORKER, type: "module" },
    side_panel: { default_path: PANEL },
  };
}
