import assert from "node:assert/strict";
import { test } from "node:test";
import { makeChrome, loadPage, tick } from "./helpers/ui.js";

const NOW = Date.now();
const HOUR = 3_600_000;
const tabs = [
  { id: 1, windowId: 1, active: false, discarded: false, url: "https://zeta.org/x", title: "Charlie", lastAccessed: NOW - 3 * HOUR },
  { id: 2, windowId: 1, active: false, discarded: false, url: "https://alpha.dev/y", title: "Bravo", lastAccessed: NOW - 1 * HOUR },
  { id: 3, windowId: 1, active: false, discarded: false, url: "https://mid.io/z", title: "Alpha", lastAccessed: NOW - 2 * HOUR },
];

loadPage("../../sidepanel/index.html", makeChrome({ tabs, calls: [], stored: {} }));
await import("../sidepanel/sidepanel.js");
await tick();
await tick();

const titles = () => [...document.querySelectorAll(".row .title")].map((el) => el.textContent);
function setSort(value) {
  const select = document.getElementById("sort");
  select.value = value;
  select.dispatchEvent(new window.Event("change", { bubbles: true }));
}

test("UI - Sidepanel Sort - Recent: most recently used first (default)", () => {
  assert.deepEqual(titles(), ["Bravo", "Alpha", "Charlie"]);
});

test("UI - Sidepanel Sort - Oldest: least recently used first", () => {
  setSort("oldest");
  assert.deepEqual(titles(), ["Charlie", "Alpha", "Bravo"]);
});

test("UI - Sidepanel Sort - Title: alphabetical", () => {
  setSort("title");
  assert.deepEqual(titles(), ["Alpha", "Bravo", "Charlie"]);
});

test("UI - Sidepanel Sort - Domain: alphabetical by hostname", () => {
  setSort("domain");
  // alpha.dev < mid.io < zeta.org
  assert.deepEqual(titles(), ["Bravo", "Alpha", "Charlie"]);
});
