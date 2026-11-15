// src/manifest.ts — one manifest function, two browsers: the Chrome output is the contract the
// release snapshot pins; the Firefox output differs only where Firefox has no choice.
import assert from "node:assert/strict";
import { test } from "vitest";
import { manifest } from "../../src/manifest.ts";

const chrome = manifest("1.2.3", "chrome");
const firefox = manifest("1.2.3", "firefox");

test("Tooling - Manifest - the chrome target: service worker, side panel, Chrome-only permissions and minimum", () => {
  assert.deepEqual(chrome.background, { service_worker: "background/service-worker.js", type: "module" });
  assert.deepEqual(chrome.side_panel, { default_path: "sidepanel/index.html" });
  assert.deepEqual(chrome.permissions, [
    "tabs",
    "tabGroups",
    "storage",
    "alarms",
    "contextMenus",
    "sidePanel",
    "favicon",
  ]);
  assert.equal(chrome.minimum_chrome_version, "121");
  assert.equal("sidebar_action" in chrome, false);
  assert.equal("browser_specific_settings" in chrome, false);
  assert.deepEqual(
    chrome.options_ui,
    { page: "options/index.html", open_in_tab: true },
    "options_ui works in both browsers",
  );
  assert.equal("options_page" in chrome, false);
});

test("Tooling - Manifest - the firefox target: event page, sidebar_action, gecko settings, no Chrome-only keys", () => {
  // Firefox has no extension service workers (bug 1573659): the same bundle runs as an event page
  assert.deepEqual(firefox.background, { scripts: ["background/service-worker.js"], type: "module" });
  assert.deepEqual(firefox.sidebar_action, {
    default_panel: "sidepanel/index.html",
    default_title: "Taboom - Tabs Manager",
    default_icon: { 16: "icons/icon16.png", 32: "icons/icon32.png" },
    open_at_install: false,
  });
  // an unknown permission makes Firefox refuse the add-on: sidePanel and favicon stay out
  assert.deepEqual(firefox.permissions, ["tabs", "tabGroups", "storage", "alarms", "contextMenus"]);
  assert.deepEqual(firefox.browser_specific_settings, {
    gecko: {
      id: "taboom-tabs-manager@ariva-tools.com",
      strict_min_version: "140.0",
      data_collection_permissions: { required: ["none"] },
    },
    gecko_android: { strict_min_version: "142.0" }, // data_collection_permissions exists on Android from 142
  });
  assert.equal("side_panel" in firefox, false);
  assert.equal("minimum_chrome_version" in firefox, false);
  assert.deepEqual(firefox.options_ui, chrome.options_ui);
});

test("Tooling - Manifest - both targets share name, version, icons, action and commands", () => {
  for (const key of ["manifest_version", "name", "description", "version", "icons", "action", "commands"] as const) {
    assert.deepEqual(firefox[key], chrome[key], key);
  }
  assert.equal(chrome.version, "1.2.3");
  assert.deepEqual(manifest("1.2.3"), chrome, "chrome is the default target");
});
