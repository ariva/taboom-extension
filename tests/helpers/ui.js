// Shared UI-test harness: happy-dom window loaded with a real page's HTML
// plus a minimal chrome.* stub. Each test file gets its own node process
// (node --test), so one setup per file is safe.
import { readFileSync } from "node:fs";
import { Window } from "happy-dom";
import { applyExperimental } from "../../core/core.js";

// capturing event: tests can fire() to invoke everything the code registered
function makeEvent() {
  const fns = [];
  return {
    addListener: (fn) => fns.push(fn),
    removeListener: () => {},
    fire: (...args) => Promise.all(fns.map((fn) => fn(...args))),
  };
}

// calls: flat log of stubbed chrome calls, e.g. ["tabs.reload 3", "storage.set {...}"]
// tests fetch the real features.json (single source of truth for flags)
const featuresJson = readFileSync(new URL("../../features.json", import.meta.url), "utf8");

// The suite runs three times (see justfile):
//  1. flags as shipped;
//  2. TEST_EXPERIMENTAL=1 — experimental flags count as enabled, so
//     experimental functionality is tested, not skipped until promotion
//     (makeChrome injects ui.showExperimental so the code under test resolves
//     the flags the same way the skip decisions do);
//  3. TEST_ALL_DISABLED=1 — every flag off, proving disabled-state behavior
//     (the fetch stub serves the disabled set to the code under test).
export const TEST_EXPERIMENTAL = process.env.TEST_EXPERIMENTAL === "1";
export const TEST_ALL_DISABLED = process.env.TEST_ALL_DISABLED === "1";
export const RAW_FEATURES = (() => {
  const parsed = JSON.parse(featuresJson);
  if (TEST_ALL_DISABLED) {
    for (const value of Object.values(parsed)) {
      value.enabled = false;
    }
  }
  return parsed;
})();
export const TEST_FEATURES = applyExperimental(RAW_FEATURES, TEST_EXPERIMENTAL);

const changesMd = readFileSync(new URL("../../CHANGES.md", import.meta.url), "utf8");

globalThis.fetch = async (url) => {
  if (String(url).endsWith("features.json")) return { json: async () => structuredClone(RAW_FEATURES) };
  if (String(url).endsWith("CHANGES.md")) return { text: async () => changesMd };
  throw new Error(`unmocked fetch ${url}`);
};

export function makeChrome({ tabs = [], stored = {}, calls = [], groups = [] }) {
  if (TEST_EXPERIMENTAL) {
    stored.ui = { ...(stored.ui ?? {}), showExperimental: true };
  }
  let nextTabId = 1000;
  return {
    tabs: {
      query: async (opts = {}) => {
        let result = tabs;
        if (opts.windowId != null) result = result.filter((t) => t.windowId === opts.windowId);
        if (opts.active) result = result.filter((t) => t.active);
        return result;
      },
      get: async (id) => {
        const tab = tabs.find((t) => t.id === id);
        if (!tab) throw new Error(`no tab ${id}`);
        return tab;
      },
      update: async (id, props) => {
        calls.push(`tabs.update ${id} ${JSON.stringify(props ?? {})}`);
        const tab = tabs.find((t) => t.id === id);
        if (tab) Object.assign(tab, props);
        return tab;
      },
      remove: async (ids) => calls.push(`tabs.remove ${[].concat(ids)}`),
      reload: async (id) => calls.push(`tabs.reload ${id}`),
      move: async (ids, props) => {
        calls.push(`tabs.move ${[].concat(ids)} ${JSON.stringify(props ?? {})}`);
        for (const id of [].concat(ids)) {
          const tab = tabs.find((t) => t.id === id);
          if (tab && props?.windowId != null) {
            if (tab.windowId !== props.windowId) tab.pinned = false; // like Chrome: a cross-window move unpins
            tab.windowId = props.windowId;
          }
        }
      },
      create: async (opts = {}) => {
        calls.push(`tabs.create ${JSON.stringify(opts)}`);
        const tab = { id: nextTabId++, active: !!opts.active, windowId: opts.windowId, url: "chrome://newtab/" };
        tabs.push(tab);
        return tab;
      },
      discard: async (id) => {
        calls.push(`tabs.discard ${id}`);
        const tab = tabs.find((t) => t.id === id);
        if (!tab) throw new Error(`no tab ${id}`);
        tab.discarded = true;
        tab.active = false;
        return { ...tab };
      },
      onCreated: makeEvent(), onUpdated: makeEvent(), onActivated: makeEvent(),
      onRemoved: makeEvent(), onMoved: makeEvent(), onAttached: makeEvent(), onDetached: makeEvent(),
      onReplaced: makeEvent(),
      group: async ({ tabIds, groupId }) => {
        calls.push(`tabs.group ${[].concat(tabIds)} ${groupId ?? "new"}`);
        const gid = groupId ?? 900;
        for (const id of [].concat(tabIds)) {
          const tab = tabs.find((t) => t.id === id);
          if (tab) tab.groupId = gid;
        }
        return gid;
      },
      ungroup: async (tabIds) => {
        calls.push(`tabs.ungroup ${[].concat(tabIds)}`);
        for (const id of [].concat(tabIds)) {
          const tab = tabs.find((t) => t.id === id);
          if (tab) tab.groupId = -1;
        }
      },
    },
    tabGroups: {
      query: async () => groups.map((g) => ({ ...g })),
      update: async (groupId, props) => {
        calls.push(`tabGroups.update ${groupId} ${JSON.stringify(props)}`);
        const group = groups.find((g) => g.id === groupId);
        if (group) Object.assign(group, props);
        return group;
      },
      onCreated: makeEvent(), onRemoved: makeEvent(), onUpdated: makeEvent(), onMoved: makeEvent(),
    },
    windows: {
      WINDOW_ID_NONE: -1,
      getLastFocused: async () => ({ id: 1 }),
      getCurrent: async () => ({ id: 1 }),
      getAll: async () =>
        [...new Set(tabs.map((t) => t.windowId))].map((id) => ({
          id, left: 0, top: 0, width: 1280, height: 800,
        })),
      onCreated: makeEvent(),
      onRemoved: makeEvent(),
      update: async (id) => calls.push(`windows.update ${id}`),
      create: async (opts = {}) => {
        calls.push(`windows.create ${JSON.stringify(opts)}`);
        const win = { id: 900 };
        if (opts.tabId != null) {
          const tab = tabs.find((t) => t.id === opts.tabId);
          if (tab) {
            tab.pinned = false; // like Chrome: a cross-window move unpins
            tab.windowId = win.id;
          }
        }
        return win;
      },
      onFocusChanged: makeEvent(),
    },
    alarms: {
      create: async (name, info) => calls.push(`alarms.create ${name} ${JSON.stringify(info)}`),
      onAlarm: makeEvent(),
    },
    commands: { onCommand: makeEvent() },
    contextMenus: {
      removeAll: async () => calls.push("contextMenus.removeAll"),
      create: (props) => calls.push(`contextMenus.create ${props.id}`),
      update: (id, props, done) => {
        calls.push(`contextMenus.update ${id} ${JSON.stringify(props)}`);
        done?.();
      },
      remove: (id, done) => {
        calls.push(`contextMenus.remove ${id}`);
        done?.();
      },
      onClicked: makeEvent(),
    },
    storage: {
      local: {
        get: async () => structuredClone(stored),
        set: async (patch) => {
          calls.push(`storage.set ${JSON.stringify(patch)}`);
          Object.assign(stored, structuredClone(patch));
        },
        clear: async () => calls.push("storage.clear"),
        remove: async (key) => {
          calls.push(`storage.remove ${key}`);
          for (const k of [].concat(key)) delete stored[k];
        },
      },
      onChanged: makeEvent(),
      session: (() => {
        const sessionStored = {};
        return {
          get: async () => structuredClone(sessionStored),
          set: async (patch) => {
            calls.push(`storage.session.set ${JSON.stringify(patch)}`);
            Object.assign(sessionStored, structuredClone(patch));
          },
        };
      })(),
    },
    runtime: {
      getURL: (path) => `chrome-extension://test${path}`,
      sendMessage: async (msg) => { calls.push(`sendMessage ${msg.type}`); return {}; },
      connect: (info) => {
        calls.push(`runtime.connect ${info?.name ?? ""}`);
        return { name: info?.name, onDisconnect: makeEvent(), disconnect: () => {} };
      },
      onConnect: makeEvent(),
      openOptionsPage: () => calls.push("openOptionsPage"),
      // update_url = store install; tests exercise the shipped (non-DEV) behaviour
      getManifest: () => ({ version: "0.0.0-test", update_url: "https://clients2.google.com/service/update2/crx" }),
      onMessage: makeEvent(),
      onInstalled: makeEvent(),
      onStartup: makeEvent(),
      onUpdateAvailable: makeEvent(),
      reload: () => calls.push("runtime.reload"),
    },
    action: {
      setBadgeText: async (opts) => calls.push(`action.setBadgeText ${JSON.stringify(opts)}`),
      setBadgeBackgroundColor: async () => {},
      setIcon: async () => {},
    },
    sidePanel: {
      open: async (opts) => calls.push(`sidePanel.open ${JSON.stringify(opts ?? {})}`),
      setPanelBehavior: async (opts) => calls.push(`sidePanel.setPanelBehavior ${JSON.stringify(opts)}`),
    },
  };
}

// Loads <page>/index.html into a happy-dom window and exposes the globals
// the page scripts expect. Import the page script AFTER calling this.
export function loadPage(htmlPath, chrome) {
  const htmlUrl = new URL(htmlPath, import.meta.url);
  const html = readFileSync(htmlUrl, "utf8")
    .replace(/<script[^>]*><\/script>/, "") // page script is imported manually
    // inline real stylesheets so tests can assert COMPUTED styles — an attribute
    // like [hidden] can be overridden by author CSS, and attribute-only asserts
    // miss that (see the bulk-bar / collapse-all always-visible regression)
    .replace(/<link rel="stylesheet" href="([^"]+)" \/>/g, (_, href) => {
      return `<style>${readFileSync(new URL(href, htmlUrl), "utf8")}</style>`;
    });
  const window = new Window();
  window.document.write(html);
  if (!window.HTMLElement.prototype.scrollIntoView) {
    window.HTMLElement.prototype.scrollIntoView = () => {};
  }
  globalThis.window = window;
  globalThis.document = window.document;
  globalThis.matchMedia = window.matchMedia.bind(window);
  globalThis.Event = window.Event; // page code dispatches synthetic events (custom dropdown)
  globalThis.KeyboardEvent = window.KeyboardEvent; // page code cancels a rename with a synthetic Esc
  globalThis.confirm = () => true;
  globalThis.chrome = chrome;
  return window;
}

export const tick = () => new Promise((resolve) => setTimeout(resolve, 0));
