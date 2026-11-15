import assert from "node:assert/strict";
import { test } from "vitest";
import { capabilities } from "../../../src/lib/platform/capabilities.ts";
import { faviconUrl } from "../../../src/lib/platform/favicon.ts";
import { openPanel, openPanelOnActionClick, toggleSidebarOnActionClick } from "../../../src/lib/platform/panel.ts";

// hand-rolled fake — `as`: a partial stand-in for the chrome global
function fakeChrome(fake: object): void {
  globalThis.chrome = fake as unknown as typeof chrome;
}

test("Lib - Platform - Capabilities: tabGroups follows the API's presence, detected at the point of use", () => {
  fakeChrome({});
  assert.equal(capabilities.tabGroups, false);
  fakeChrome({ tabGroups: {} });
  assert.equal(capabilities.tabGroups, true);
});

test("Lib - Platform - Favicon: _favicon/ URL of the extension with pageUrl and size encoded", () => {
  fakeChrome({
    runtime: {
      getURL: (path: string) => `chrome-extension://abc${path}`,
      getManifest: () => ({ permissions: ["favicon"] }),
    },
  });
  assert.equal(
    faviconUrl("https://example.com/a?b=1&c=2", 16),
    "chrome-extension://abc/_favicon/?pageUrl=https%3A%2F%2Fexample.com%2Fa%3Fb%3D1%26c%3D2&size=16",
  );
});

test("Lib - Platform - Panel: open targets the window, action click is wired to open the panel", async () => {
  const calls: unknown[][] = [];
  fakeChrome({
    sidePanel: {
      open: async (options: unknown) => {
        calls.push(["open", options]);
      },
      setPanelBehavior: async (options: unknown) => {
        calls.push(["setPanelBehavior", options]);
      },
    },
  });

  await openPanel(7);
  await openPanelOnActionClick();

  assert.deepEqual(calls, [
    ["open", { windowId: 7 }],
    ["setPanelBehavior", { openPanelOnActionClick: true }],
  ]);
});

test("Lib - Platform - Panel: a refused open (no user gesture) rejects for the caller to handle", async () => {
  fakeChrome({
    sidePanel: {
      open: async () => {
        throw new Error("may only be called in response to a user gesture");
      },
    },
  });
  await assert.rejects(openPanel(1), /user gesture/);
});

// ---------- Firefox (T-0152): no sidePanel, no _favicon, sidebarAction on `browser` ----------

type SidebarCalls = string[];
function fakeFirefox(extra: object = {}): SidebarCalls {
  const calls: SidebarCalls = [];
  const sidebarAction = {
    open: async () => void calls.push("open"),
    toggle: async () => void calls.push("toggle"),
  };
  (globalThis as { browser?: unknown }).browser = { sidebarAction };
  fakeChrome({
    runtime: {
      getURL: (path: string) => `moz-extension://abc${path}`,
      getManifest: () => ({ permissions: ["tabs", "storage"] }),
    },
    tabs: {},
    action: { onClicked: { addListener: (fn: () => void) => calls.push(`onClicked:${typeof fn}`) } },
    ...extra,
  });
  return calls;
}

test("Lib - Platform - Capabilities: side panel, sidebar, cached favicons and tab replacement follow the APIs present", () => {
  fakeChrome({
    sidePanel: {},
    tabs: { onReplaced: {} },
    runtime: { getManifest: () => ({ permissions: ["favicon"] }) },
  });
  (globalThis as { browser?: unknown }).browser = undefined;
  assert.deepEqual(
    [capabilities.sidePanel, capabilities.sidebar, capabilities.cachedFavicons, capabilities.tabReplacement],
    [true, false, true, true],
    "Chrome",
  );
  fakeFirefox();
  assert.deepEqual(
    [capabilities.sidePanel, capabilities.sidebar, capabilities.cachedFavicons, capabilities.tabReplacement],
    [false, true, false, false],
    "Firefox",
  );
});

test("Lib - Platform - Panel: Firefox opens the sidebar in the active window and ignores the window id", async () => {
  const calls = fakeFirefox();
  await openPanel(7);
  assert.deepEqual(calls, ["open"]);
  await openPanelOnActionClick(); // Chrome's setting has no Firefox equivalent: nothing to do, no rejection
  assert.deepEqual(calls, ["open"]);
});

test("Lib - Platform - Panel: on Firefox the toolbar button toggles the sidebar; on Chrome nothing is registered", async () => {
  const calls = fakeFirefox();
  let registered: (() => void) | undefined;
  (globalThis.chrome as unknown as { action: { onClicked: { addListener: (fn: () => void) => void } } }).action = {
    onClicked: {
      addListener: (fn) => {
        registered = fn;
      },
    },
  };
  toggleSidebarOnActionClick();
  assert.ok(registered, "the listener is registered at worker start");
  registered();
  await Promise.resolve();
  assert.deepEqual(calls, ["toggle"]);
  (globalThis as { browser?: unknown }).browser = undefined;
  const chromeCalls: string[] = [];
  fakeChrome({ sidePanel: {}, action: { onClicked: { addListener: () => chromeCalls.push("registered") } } });
  toggleSidebarOnActionClick();
  assert.deepEqual(chromeCalls, [], "Chrome opens the panel through setPanelBehavior, not a click listener");
});

test("Lib - Platform - Panel: without any side panel API an open rejects", async () => {
  (globalThis as { browser?: unknown }).browser = undefined;
  fakeChrome({});
  await assert.rejects(openPanel(1), /no side panel/);
});

test("Lib - Platform - Favicon: no cached favicons (Firefox) → no URL, the row shows the host initial instead", () => {
  fakeFirefox();
  assert.equal(faviconUrl("https://example.com/", 16), undefined);
});
