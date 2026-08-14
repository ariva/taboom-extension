import assert from "node:assert/strict";
import { test } from "node:test";
import { makeChrome, loadPage, tick } from "./helpers/ui.js";

const NOW = Date.now();
const tabs = [
  { id: 1, windowId: 1, active: true, discarded: false, url: "https://a.com/", title: "Alpha", lastAccessed: NOW },
  { id: 2, windowId: 1, active: false, discarded: false, url: "https://b.com/", title: "Beta", lastAccessed: NOW - 1000 },
  { id: 3, windowId: 1, active: false, discarded: false, url: "https://c.com/", title: "Gamma", lastAccessed: NOW - 2000 },
];

const calls = [];
loadPage("../../sidepanel/index.html", makeChrome({ tabs, calls, stored: {} }));
await import("../sidepanel/sidepanel.js");
await tick();
await tick();

const key = (k) => document.dispatchEvent(new window.KeyboardEvent("keydown", { key: k, bubbles: true }));
const cursorTitle = () => document.querySelector(".row.cursor .title")?.textContent;

test("UI - Sidepanel Keyboard - No window dots when all tabs share one window", () => {
  assert.equal(document.querySelectorAll(".win-dot").length, 0);
});

test("UI - Sidepanel Keyboard - Slash focuses search", () => {
  document.getElementById("search").blur();
  key("/");
  assert.equal(document.activeElement, document.getElementById("search"));
});

test("UI - Sidepanel Keyboard - Arrow keys move the cursor and clamp at both ends", () => {
  assert.equal(document.querySelector(".row.cursor"), null, "no cursor initially");
  key("ArrowDown");
  assert.equal(cursorTitle(), "Alpha");
  key("ArrowDown");
  assert.equal(cursorTitle(), "Beta");
  key("ArrowDown");
  key("ArrowDown");
  assert.equal(cursorTitle(), "Gamma", "clamped at last row");
  key("ArrowUp");
  key("ArrowUp");
  key("ArrowUp");
  assert.equal(cursorTitle(), "Alpha", "clamped at first row");
});

test("UI - Sidepanel Keyboard - Enter activates the cursor tab", async () => {
  key("ArrowDown"); // Alpha → Beta
  assert.equal(cursorTitle(), "Beta");
  calls.length = 0;
  key("Enter");
  await tick();
  assert.ok(calls.includes("windows.update 1"), "window focused");
  assert.ok(calls.some((c) => c.startsWith("tabs.update 2") && c.includes('"active":true')), "tab 2 activated");
});
