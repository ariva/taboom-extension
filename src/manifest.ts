// The extension manifest as code. One source, emitted as manifest.json by
// tooling/manifest-plugin.ts. `target` exists so a second browser would be a second
// branch here (multi-browser readiness) — today there is exactly one: chrome.
export type BuildTarget = "chrome";

export function manifest(version: string, _target: BuildTarget = "chrome"): chrome.runtime.ManifestV3 {
  return {
    manifest_version: 3,
    name: "Taboom - Tabs Manager by ariva-tools",
    description:
      "Taboom - Privacy-first smart Tabs Manager to search, snooze, and protect Chrome tabs. Saves memory, runs fully locally.",
    version,
    minimum_chrome_version: "121",

    permissions: ["tabs", "tabGroups", "storage", "alarms", "contextMenus", "sidePanel", "favicon"],

    background: {
      service_worker: "background/service-worker.js",
      type: "module",
    },

    action: {
      default_title: "Taboom - Smart Tabs Manager",
      default_icon: {
        16: "icons/icon16.png",
        32: "icons/icon32.png",
      },
    },

    icons: {
      16: "icons/icon16.png",
      32: "icons/icon32.png",
      48: "icons/icon48.png",
      128: "icons/icon128.png",
    },

    side_panel: {
      default_path: "sidepanel/index.html",
    },

    options_page: "options/index.html",

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
}
