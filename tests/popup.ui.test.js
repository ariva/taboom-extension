import assert from "node:assert/strict";
import { test } from "node:test";
import { makeChrome, loadPage, tick } from "./helpers/ui.js";

const NOW = Date.now();
const tabs = [
  { id: 1, windowId: 1, active: true, discarded: false, url: "https://gist.github.com/x", title: "A Gist", lastAccessed: NOW },
  { id: 2, windowId: 1, active: false, discarded: true, url: "https://old.example.com/", title: "Old", lastAccessed: NOW },
];

const calls = [];
const chrome = makeChrome({
  tabs,
  calls,
  stored: {
    protectionRules: [{ id: "r1", type: "domain", pattern: "*.github.com" }],
    ui: { theme: "dark" },
  },
});
loadPage("../../popup/index.html", chrome);
await import("../popup/popup.js");
await tick();
await tick();

test("UI - Popup - Shows current tab, stats, and protect label for a protected site", () => {
  assert.match(document.getElementById("current").textContent, /A Gist/);
  const stats = document.getElementById("stats").textContent;
  assert.match(stats, /Open: 2/);
  assert.match(stats, /Snoozed: 1/);
  assert.match(stats, /Protected: 1/);
  assert.match(document.getElementById("protect-label").textContent, /^Unprotect gist\.github\.com/);
});

test("UI - Popup - Keeps the protect button icon (svg not wiped by label update)", () => {
  assert.ok(document.querySelector("#protect-site svg"), "shield svg still present");
});

test("UI - Popup - Theme applied from stored ui prefs", () => {
  assert.equal(document.documentElement.style.colorScheme, "dark");
});

test("UI - Popup - Snooze button messages the service worker", async () => {
  calls.length = 0;
  document.getElementById("snooze").click();
  await tick();
  assert.ok(calls.includes("sendMessage snooze-tab"));
});

test("UI - Popup - Open manager opens the side panel", async () => {
  calls.length = 0;
  document.getElementById("open-manager").click();
  await tick();
  assert.ok(calls.includes("sidePanel.open"));
});
