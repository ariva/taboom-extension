import assert from "node:assert/strict";
import { test } from "node:test";
import { makeChrome, loadPage, tick, RAW_FEATURES, TEST_EXPERIMENTAL, TEST_FEATURES } from "./helpers/ui.js";

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

test("UI - Options - External rule change re-renders the protection list", async () => {
  stored.protectionRules = [{ id: "r9", type: "host", pattern: "elsewhere.example.com" }];
  await chrome.storage.onChanged.fire({ protectionRules: {} }, "local");
  await tick();
  await tick();
  assert.match(document.querySelector("#rules li").textContent, /elsewhere\.example\.com/);
});

test("UI - Options - History-nav dropdown persists the mode", async () => {
  const { resolveNavMode, applyExperimental } = await import("../core/core.js");
  const select = document.getElementById("historyNav");
  // adaptive: fresh install shows whatever the flags resolve the default to,
  // with experimental applied exactly the way the app does (stored ui)
  const effective = applyExperimental(RAW_FEATURES, stored.ui?.showExperimental ?? false);
  const expected = resolveNavMode(effective, stored.ui);
  assert.equal(select.value, expected === "off" ? "disabled" : expected, "shows resolved default");
  select.value = "compact";
  select.dispatchEvent(new window.Event("change", { bubbles: true }));
  await tick();
  await tick();
  assert.ok(calls.some((c) => c.startsWith("storage.set") && c.includes('"historyNav":"compact"')));
  select.value = "traditional";
  select.dispatchEvent(new window.Event("change", { bubbles: true }));
  await tick();
  await tick();
});

test("UI - Options - Experimental toggle visible (ALLOW_EXPERIMENTAL) and persists ui.showExperimental", async () => {
  await tick();
  const allowOn = TEST_FEATURES.ALLOW_EXPERIMENTAL?.enabled === true;
  assert.equal(document.getElementById("showExperimental-label").hidden, !allowOn, "visible iff allowed");
  const box = document.getElementById("showExperimental");
  assert.equal(box.checked, TEST_EXPERIMENTAL, "reflects the scenario's injected default");
  box.checked = true;
  box.dispatchEvent(new window.Event("change", { bubbles: true }));
  await tick();
  assert.ok(calls.some((c) => c.startsWith("storage.set") && c.includes('"showExperimental":true')));
});

test("UI - Options - History-nav checkbox visibility follows OPTIONS_NAVIGATION_STACK", async () => {
  const flagOn = TEST_FEATURES.OPTIONS_NAVIGATION_STACK?.enabled === true;
  assert.equal(document.getElementById("historyNav-label").hidden, !flagOn);
});

test("UI - Options - Performance section visibility follows SHOW_PERFORMANCE_INFO", async () => {
  const flagOn = TEST_FEATURES.SHOW_PERFORMANCE_INFO?.enabled === true;
  assert.equal(document.getElementById("perf-section").hidden, !flagOn);
});

test("UI - Options - Show performance stores a timestamped snapshot; reset clears both keys", async () => {
  stored.perfMetrics = { "sidepanel.render": { count: 2, avg: 4, min: 3, max: 5, last: 5 } };
  document.getElementById("perf-show").click();
  await tick();
  await tick();
  assert.equal(stored.perfSnapshots.length, 1, "snapshot stored");
  assert.ok(stored.perfSnapshots[0].at > 0, "timestamped");
  assert.match(document.getElementById("perf-out").textContent, /sidepanel\.render: count 2/);

  document.getElementById("perf-reset-snapshot").click();
  await tick();
  await tick();
  assert.equal(stored.perfMetrics, undefined, "running metrics cleared");
  assert.equal(stored.perfSnapshots.length, 1, "snapshot history survives");

  document.getElementById("perf-reset").click();
  await tick();
  await tick();
  assert.equal(stored.perfSnapshots, undefined, "reset all clears history too");
  assert.equal(document.getElementById("perf-out").textContent, "");
});

test("UI - Options - Restore defaults resets settings/ui but keeps protected sites", async () => {
  stored.settings = { autoSnoozeEnabled: false, inactivityMinutes: 45 };
  stored.ui = { fontSize: 1.2, theme: "light" };
  stored.protectionRules = [{ id: "r1", type: "domain", pattern: "*.github.com" }];
  document.getElementById("restore-defaults").click();
  await tick();
  await tick();
  assert.equal(stored.settings.autoSnoozeEnabled, true, "settings back to defaults");
  assert.equal(stored.settings.inactivityMinutes, 60);
  assert.equal(stored.ui.theme, "auto", "ui back to defaults");
  assert.deepEqual(
    stored.protectionRules,
    [{ id: "r1", type: "domain", pattern: "*.github.com" }],
    "protected sites untouched",
  );
});

test("UI - Options - Clear protected sites empties rules but keeps settings", async () => {
  stored.settings.inactivityMinutes = 45;
  document.getElementById("clear-protected").click();
  await tick();
  await tick();
  assert.deepEqual(stored.protectionRules, [], "all rules removed");
  assert.equal(stored.settings.inactivityMinutes, 45, "settings untouched");
});

test("UI - Options - Dropdown shows the effective mode when the stored one is flag-disabled", async () => {
  const { resolveNavMode, applyExperimental } = await import("../core/core.js");
  stored.ui = { ...stored.ui, historyNav: "compact" };
  await chrome.storage.onChanged.fire({ ui: {} }, "local"); // re-render
  await tick();
  await tick();
  // adaptive: compact flag off → traditional; both off → disabled; resolved
  // with experimental applied the way the app does (stored ui)
  const mode = resolveNavMode(
    applyExperimental(RAW_FEATURES, stored.ui?.showExperimental ?? false),
    stored.ui,
  );
  assert.equal(
    document.getElementById("historyNav").value,
    mode === "off" ? "disabled" : mode,
    "dropdown shows the resolver's effective mode, stored value not rewritten",
  );
  assert.equal(stored.ui.historyNav, "compact", "stored preference untouched");
});

test("UI - Options - What's new paginates: initial count, then a page per click until done", async () => {
  const { SHOW_INITIAL_CHANGES, SHOW_MORE_PAGE } = await import("../options/model.js");
  const { readFileSync } = await import("node:fs");
  const md = readFileSync(new URL("../CHANGES.md", import.meta.url), "utf8");
  const total = md.split(/^## /m).length - 1;
  const box = document.getElementById("whats-new");
  const details = box.querySelectorAll("details");
  assert.equal(details.length, total, "every release section rendered");
  const visibleCount = () => [...box.querySelectorAll("details")].filter((d) => !d.hidden).length;
  assert.equal(visibleCount(), Math.min(SHOW_INITIAL_CHANGES, total), "initial count visible up front");
  assert.ok(
    [...details].every((d, index) => d.open === (index < SHOW_INITIAL_CHANGES)),
    "initial page expanded, later releases folded",
  );

  if (total <= SHOW_INITIAL_CHANGES) {
    assert.equal(box.querySelector("button"), null, "no button at the initial count or fewer releases");
    return;
  }
  let clicks = 0;
  let button;
  while ((button = box.querySelector("button"))) {
    const hidden = total - visibleCount();
    assert.equal(button.textContent, `Show ${Math.min(SHOW_MORE_PAGE, hidden)} more`, "label = next page size");
    button.click();
    clicks++;
    assert.equal(visibleCount(), Math.min(total, total - hidden + Math.min(SHOW_MORE_PAGE, hidden)), "one page revealed");
    assert.ok(clicks <= total, "terminates");
  }
  assert.equal(visibleCount(), total, "everything visible at the end");
  assert.equal(clicks, Math.ceil((total - SHOW_INITIAL_CHANGES) / SHOW_MORE_PAGE), "page count");
});

test("UI - Options - Hidden-matches dropdown visible only with SEARCH_AUTO_SELECT_ALL", async () => {
  const { applyExperimental, featureEnabled } = await import("../core/core.js");
  const effective = applyExperimental(RAW_FEATURES, stored.ui?.showExperimental ?? false);
  assert.equal(
    document.getElementById("searchEmptyFilter-label").hidden,
    !featureEnabled(effective, "SEARCH_AUTO_SELECT_ALL"),
    "label visibility follows the resolved flag",
  );
  assert.equal(
    document.getElementById("searchEmptyFilter").value,
    stored.ui?.searchEmptyFilter ?? "keep",
    "defaults to keeping the filter",
  );
});
