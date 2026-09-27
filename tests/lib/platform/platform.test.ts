import assert from "node:assert/strict";
import { test } from "vitest";
import { capabilities } from "../../../src/lib/platform/capabilities.ts";
import { faviconUrl } from "../../../src/lib/platform/favicon.ts";
import { openPanel, openPanelOnActionClick } from "../../../src/lib/platform/panel.ts";

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
  fakeChrome({ runtime: { getURL: (path: string) => `chrome-extension://abc${path}` } });
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
