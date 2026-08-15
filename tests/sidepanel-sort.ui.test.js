import assert from "node:assert/strict";
import { test } from "node:test";
import { makeChrome, loadPage, tick } from "./helpers/ui.js";

const NOW = Date.now();
const HOUR = 3_600_000;
const tabs = [
  { id: 1, windowId: 1, active: false, discarded: false, url: "https://zeta.org/x", title: "Charlie", lastAccessed: NOW - 3 * HOUR },
  { id: 2, windowId: 1, active: false, discarded: false, url: "https://alpha.dev/y", title: "Bravo", lastAccessed: NOW - 1 * HOUR },
  { id: 3, windowId: 1, active: false, discarded: false, url: "https://mid.io/z", title: "Alpha", lastAccessed: NOW - 2 * HOUR },
  { id: 4, windowId: 2, active: false, discarded: false, url: "https://bb.aa/q", title: "Delta", lastAccessed: NOW - 4 * HOUR },
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

test("UI - Sidepanel Sort - Default is Group by window on first launch", () => {
  assert.equal(document.getElementById("sort").value, "window");
  assert.equal(document.querySelectorAll(".group-header").length, 2, "grouped view by default");
  assert.equal(document.getElementById("collapse-all").hidden, false, "fold-all visible");
});

test("UI - Sidepanel Sort - Recent: most recently used first", () => {
  setSort("recent");
  assert.deepEqual(titles(), ["Bravo", "Alpha", "Charlie", "Delta"]);
});

test("UI - Sidepanel Sort - Oldest: least recently used first", () => {
  setSort("oldest");
  assert.deepEqual(titles(), ["Delta", "Charlie", "Alpha", "Bravo"]);
});

test("UI - Sidepanel Sort - Title: alphabetical", () => {
  setSort("title");
  assert.deepEqual(titles(), ["Alpha", "Bravo", "Charlie", "Delta"]);
});

test("UI - Sidepanel Sort - Domain: alphabetical by hostname", () => {
  setSort("domain");
  // alpha.dev < bb.aa < mid.io < zeta.org
  assert.deepEqual(titles(), ["Bravo", "Delta", "Alpha", "Charlie"]);
});

test("UI - Sidepanel Sort - Group by window: current window first, headers with counts", () => {
  setSort("window");
  assert.deepEqual(titles(), ["Bravo", "Alpha", "Charlie", "Delta"], "current window recent-first, then window 2");
  const headers = [...document.querySelectorAll(".group-header")].map((el) => el.textContent);
  assert.deepEqual(headers, ["▾ Window Current #1 - 3/3", "▾ Window #2 - 1/1"]);

  // filtered list → visible / total diverge
  const search = document.getElementById("search");
  search.value = "Bravo";
  search.dispatchEvent(new window.Event("input", { bubbles: true }));
  assert.deepEqual(
    [...document.querySelectorAll(".group-header")].map((el) => el.textContent),
    ["Window Current #1 - 1/3"],
  );
  search.value = "";
  search.dispatchEvent(new window.Event("input", { bubbles: true }));
  setSort("recent");
  assert.equal(document.querySelector(".group-header"), null, "headers only in window mode");
});

test("UI - Sidepanel Sort - Collapse hides a group's rows; search auto-expands", () => {
  setSort("window");
  const headerFor = (needle) =>
    [...document.querySelectorAll(".group-header")].find((el) => el.textContent.includes(needle));

  headerFor("Window Current #1").click();
  assert.equal(document.querySelectorAll(".row").length, 1, "only window 2's row left");
  assert.match(headerFor("Window Current #1").textContent, /^▸/, "collapsed indicator");
  assert.equal(document.querySelectorAll(".group-header").length, 2, "header stays visible");

  // search finds a tab inside the collapsed group → group auto-expands
  const search = document.getElementById("search");
  search.value = "Charlie";
  search.dispatchEvent(new window.Event("input", { bubbles: true }));
  assert.equal(document.querySelectorAll(".row").length, 1);
  assert.match(document.querySelector(".row .title").textContent, /Charlie/);
  assert.ok(!headerFor("Window Current #1").textContent.startsWith("▸"), "not marked collapsed during search");
  assert.ok(headerFor("Window Current #1").classList.contains("static"), "single visible group → no collapse UI");

  // clearing the search restores the collapsed state
  search.value = "";
  search.dispatchEvent(new window.Event("input", { bubbles: true }));
  assert.equal(document.querySelectorAll(".row").length, 1, "window 1 collapsed again");

  headerFor("Window Current #1").click();
  assert.equal(document.querySelectorAll(".row").length, 4, "expanded back");
  setSort("recent");
});

test("UI - Sidepanel Sort - Window dots shown on every row when multiple windows", () => {
  const dots = [...document.querySelectorAll(".win-dot")];
  assert.equal(dots.length, 4, "one dot per row");
  assert.equal(dots.filter((d) => d.classList.contains("current")).length, 3, "current-window rows use accent dot");
  const other = dots.find((d) => !d.classList.contains("current"));
  assert.ok(other.style.background, "other window dot has a palette color");
  assert.equal(other.title, "Window #2");
});

test("UI - Sidepanel Sort - Collapse-all button folds and unfolds every group", () => {
  const btn = document.getElementById("collapse-all");
  assert.equal(btn.hidden, true, "hidden outside window sort");

  setSort("window");
  assert.equal(btn.hidden, false, "visible with 2+ groups");
  assert.equal(btn.title, "Collapse all");

  btn.click();
  assert.equal(document.querySelectorAll(".row").length, 0, "all groups folded");
  assert.equal(document.querySelectorAll(".group-header").length, 2, "headers remain");
  assert.equal(btn.title, "Expand all");

  btn.click();
  assert.equal(document.querySelectorAll(".row").length, 4, "all groups unfolded");
  assert.equal(btn.title, "Collapse all");
  setSort("recent");
  assert.equal(btn.hidden, true);
});
