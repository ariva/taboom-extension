import assert from "node:assert/strict";
import { test } from "node:test";
import { makeChrome, loadPage, tick } from "./helpers/ui.js";

const calls = [];
const stored = {
  settings: { autoSnoozeEnabled: false, inactivityMinutes: 45 },
  protectionRules: [{ id: "r1", type: "domain", pattern: "*.github.com" }],
  ui: { fontSize: 1.2, density: "compact", theme: "light" },
};
const chrome = makeChrome({ calls, stored });
loadPage("../../options/index.html", chrome);
await import("../options/options.js");
await tick();
await tick();

test("UI - Options - Renders stored settings into inputs", () => {
  assert.equal(document.getElementById("autoSnoozeEnabled").checked, false);
  assert.equal(document.getElementById("inactivityMinutes").value, "45");
  assert.equal(document.getElementById("fontSize").value, "1.2");
  assert.equal(document.getElementById("density").value, "compact");
  assert.equal(document.getElementById("theme").value, "light");
  assert.match(document.getElementById("about").textContent, /0\.0\.0-test/);
});

test("UI - Options - Stored theme forced onto the page", () => {
  assert.equal(document.documentElement.style.colorScheme, "light");
});

test("UI - Options - Protection rules render as removable entries", async () => {
  const li = document.querySelector("#rules li");
  assert.match(li.textContent, /\*\.github\.com/);
  calls.length = 0;
  li.querySelector("button").click();
  await tick();
  await tick();
  assert.ok(calls.some((c) => c.startsWith("storage.set") && !c.includes("github")), "rule removed via saveState");
  assert.match(document.querySelector("#rules li").textContent, /No protected sites yet/);
});

test("UI - Options - Adding a rule saves it and clears the input", async () => {
  const input = document.getElementById("new-rule");
  input.value = "*.Example.org";
  document.getElementById("add-rule").click();
  await tick();
  await tick();
  const saved = calls.find((c) => c.includes("example.org"));
  assert.ok(saved, "normalized rule persisted");
  assert.equal(input.value, "");
  assert.match(document.querySelector("#rules li").textContent, /\*\.example\.org/);
});

test("UI - Options - Changing a setting persists and flashes Saved", async () => {
  const box = document.getElementById("autoSnoozeEnabled");
  box.checked = true;
  box.dispatchEvent(new window.Event("change", { bubbles: true }));
  await tick();
  assert.ok(calls.some((c) => c.startsWith("storage.set") && c.includes('"autoSnoozeEnabled":true')));
  assert.equal(document.getElementById("saved").hidden, false, "Saved pill visible");
});

test("UI - Options - Theme change applies immediately and saves", async () => {
  const select = document.getElementById("theme");
  select.value = "dark";
  select.dispatchEvent(new window.Event("change", { bubbles: true }));
  await tick();
  assert.equal(document.documentElement.style.colorScheme, "dark");
  assert.ok(calls.some((c) => c.includes('"theme":"dark"')));
});

test("UI - Options - FontSize is clamped to the allowed range", async () => {
  const input = document.getElementById("fontSize");
  input.value = "9";
  input.dispatchEvent(new window.Event("change", { bubbles: true }));
  await tick();
  assert.equal(input.value, "1.5", "clamped to max");
});
