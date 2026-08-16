// Shared UI-test harness: happy-dom window loaded with a real page's HTML
// plus a minimal chrome.* stub. Each test file gets its own node process
// (node --test), so one setup per file is safe.
import { readFileSync } from "node:fs";
import { Window } from "happy-dom";

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
export function makeChrome({ tabs = [], stored = {}, calls = [] }) {
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
    },
    windows: {
      getLastFocused: async () => ({ id: 1 }),
      update: async (id) => calls.push(`windows.update ${id}`),
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
      update: (id, props) => calls.push(`contextMenus.update ${id} ${JSON.stringify(props)}`),
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
      },
      onChanged: makeEvent(),
    },
    runtime: {
      getURL: (path) => `chrome-extension://test${path}`,
      sendMessage: async (msg) => { calls.push(`sendMessage ${msg.type}`); return {}; },
      openOptionsPage: () => calls.push("openOptionsPage"),
      getManifest: () => ({ version: "0.0.0-test" }),
      onMessage: makeEvent(),
      onInstalled: makeEvent(),
      onStartup: makeEvent(),
    },
    sidePanel: {
      open: async () => calls.push("sidePanel.open"),
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
  globalThis.confirm = () => true;
  globalThis.chrome = chrome;
  return window;
}

export const tick = () => new Promise((resolve) => setTimeout(resolve, 0));
