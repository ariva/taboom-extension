import assert from "node:assert/strict";
import { test } from "vitest";
import type { LocalStorageSchema, ProtectionRule } from "../../../src/app/types.ts";
import { byId, q, qa } from "../../helpers/dom.ts";
import { makeChrome, loadPage, tick, RAW_FEATURES, TEST_EXPERIMENTAL, TEST_FEATURES } from "../../helpers/ui.ts";

const calls: string[] = [];
// the slice of chrome.storage.local this page reads and writes (the mock mutates it in place);
// the rules carry no createdAt — the page never reads it
const stored: Pick<LocalStorageSchema, "settings" | "ui"> &
  Partial<Pick<LocalStorageSchema, "perfMetrics" | "perfSnapshots">> & {
    protectionRules: Omit<ProtectionRule, "createdAt">[];
  } = {
  settings: { autoSnoozeEnabled: false, inactivityMinutes: 45 },
  protectionRules: [{ id: "r1", type: "domain", pattern: "*.github.com" }],
  ui: { fontSize: 1.2, density: "compact", theme: "light" },
};
const chrome = makeChrome({ calls, stored });
loadPage("src/pages/options/index.html", chrome);
await import("../../../src/pages/options/main.ts");
await tick();
await tick();

test("UI - Options - Renders stored settings into inputs", () => {
  assert.equal(byId<HTMLInputElement>("autoSnoozeEnabled").checked, false);
  assert.equal(byId<HTMLInputElement>("inactivityMinutes").value, "45");
  assert.equal(byId<HTMLInputElement>("fontSize-custom").value, "1.2", "non-preset value lands in the custom input");
  assert.equal(byId<HTMLSelectElement>("density").value, "compact");
  assert.equal(byId<HTMLSelectElement>("theme").value, "light");
  assert.match(byId("about").textContent, /0\.0\.0-test/);
});

test("UI - Options - Stored theme forced onto the page", () => {
  assert.equal(document.documentElement.style.colorScheme, "light");
});

test("UI - Options - Protection rules render as removable entries", async () => {
  const li = q(document, "#rules li");
  assert.match(li.textContent, /\*\.github\.com/);
  calls.length = 0;
  q(li, "button").click();
  await tick();
  await tick();
  assert.ok(
    calls.some((c) => c.startsWith("storage.set") && !c.includes("github")),
    "rule removed via saveState",
  );
  assert.match(q(document, "#rules li").textContent, /No protected sites yet/);
});

test("UI - Options - Adding a rule saves it and clears the input", async () => {
  const input = byId<HTMLInputElement>("new-rule");
  input.value = "*.Example.org";
  byId("add-rule").click();
  await tick();
  await tick();
  const saved = calls.find((c) => c.includes("example.org"));
  assert.ok(saved, "normalized rule persisted");
  assert.equal(input.value, "");
  assert.match(q(document, "#rules li").textContent, /\*\.example\.org/);
});

test("UI - Options - Changing a setting persists and flashes Saved", async () => {
  const box = byId<HTMLInputElement>("autoSnoozeEnabled");
  box.checked = true;
  box.dispatchEvent(new window.Event("change", { bubbles: true }));
  await tick();
  assert.ok(calls.some((c) => c.startsWith("storage.set") && c.includes('"autoSnoozeEnabled":true')));
  assert.equal(byId("saved").hidden, false, "Saved pill visible");
});

test("UI - Options - Theme change applies immediately and saves", async () => {
  const select = byId<HTMLSelectElement>("theme");
  select.value = "dark";
  select.dispatchEvent(new window.Event("change", { bubbles: true }));
  await tick();
  assert.equal(document.documentElement.style.colorScheme, "dark");
  assert.ok(calls.some((c) => c.includes('"theme":"dark"')));
});

test("UI - Options - Zoom: presets dropdown, +/- stepping, custom rem input, page zoom", async () => {
  const { FONT_SIZE_STEPS } = await import("../../../src/pages/options/model.ts");
  const select = byId<HTMLSelectElement>("fontSize");
  const custom = byId<HTMLInputElement>("fontSize-custom");
  const customBox = byId("fontSize-custom-box");
  assert.deepEqual(
    [...select.options].map((o) => o.value),
    [...FONT_SIZE_STEPS.map(String), "custom"],
    "dropdown offers the presets plus Custom",
  );
  assert.equal(select.value, "custom", "stored 1.2 is not a preset");
  assert.equal(customBox.hidden, false, "custom input shown for a non-preset value");
  assert.equal(custom.value, "1.2");
  assert.equal(document.documentElement.style.zoom, "1.2", "options page zooms by the stored value");

  calls.length = 0;
  byId("fontSize-inc").click();
  await tick();
  await tick();
  assert.equal(select.value, "1.25", "steps from the custom value to the next preset");
  assert.equal(customBox.hidden, true);
  assert.ok(
    calls.some((c) => c.startsWith("storage.set") && c.includes('"fontSize":1.25')),
    "persisted",
  );
  assert.equal(document.documentElement.style.zoom, "1.25", "page follows immediately");

  select.value = "3";
  select.dispatchEvent(new window.Event("change", { bubbles: true }));
  await tick();
  assert.equal(byId<HTMLButtonElement>("fontSize-inc").disabled, true, "at max: no further zoom in");
  assert.equal(byId<HTMLButtonElement>("fontSize-dec").disabled, false);
  byId("fontSize-dec").click();
  await tick();
  await tick();
  assert.equal(select.value, "2.5");
  assert.equal(byId<HTMLButtonElement>("fontSize-inc").disabled, false);

  calls.length = 0;
  select.value = "custom";
  select.dispatchEvent(new window.Event("change", { bubbles: true }));
  await tick();
  assert.equal(customBox.hidden, false, "Custom reveals the input");
  assert.equal(custom.value, "2.5", "prefilled with the current value");
  assert.equal(calls.length, 0, "choosing Custom alone writes nothing");
  custom.value = "9";
  custom.dispatchEvent(new window.Event("change", { bubbles: true }));
  await tick();
  assert.equal(custom.value, "3", "clamped to max");
  assert.equal(select.value, "3", "a clamped value that is a preset shows as that preset");
  custom.value = "1.05";
  select.value = "custom";
  customBox.hidden = false;
  custom.dispatchEvent(new window.Event("change", { bubbles: true }));
  await tick();
  assert.ok(
    calls.some((c) => c.startsWith("storage.set") && c.includes('"fontSize":1.05')),
    "custom persisted",
  );
  assert.equal(select.value, "custom");
  assert.equal(document.documentElement.style.zoom, "1.05");
});
test("UI - Options - External rule change re-renders the protection list", async () => {
  stored.protectionRules = [{ id: "r9", type: "host", pattern: "elsewhere.example.com" }];
  await chrome.storage.onChanged.fire({ protectionRules: {} }, "local");
  await tick();
  await tick();
  assert.match(q(document, "#rules li").textContent, /elsewhere\.example\.com/);
});

test("UI - Options - History-nav dropdown persists the mode", async () => {
  const { resolveNavMode, applyExperimental } = await import("../../../src/app/core.ts");
  const select = byId<HTMLSelectElement>("historyNav");
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
  assert.equal(byId("showExperimental-label").hidden, !allowOn, "visible iff allowed");
  const box = byId<HTMLInputElement>("showExperimental");
  assert.equal(box.checked, TEST_EXPERIMENTAL, "reflects the scenario's injected default");
  box.checked = true;
  box.dispatchEvent(new window.Event("change", { bubbles: true }));
  await tick();
  assert.ok(calls.some((c) => c.startsWith("storage.set") && c.includes('"showExperimental":true')));
});

test("UI - Options - History-nav checkbox visibility follows OPTIONS_NAVIGATION_STACK", async () => {
  const flagOn = TEST_FEATURES.OPTIONS_NAVIGATION_STACK?.enabled === true;
  assert.equal(byId("historyNav-label").hidden, !flagOn);
});

test("UI - Options - Performance section visibility follows SHOW_PERFORMANCE_INFO", async () => {
  const flagOn = TEST_FEATURES.SHOW_PERFORMANCE_INFO?.enabled === true;
  assert.equal(byId("perf-section").hidden, !flagOn);
});

test("UI - Options - Show performance stores a timestamped snapshot; reset clears both keys", async () => {
  stored.perfMetrics = { "sidepanel.render": { count: 2, avg: 4, min: 3, max: 5, last: 5 } };
  byId("perf-show").click();
  await tick();
  await tick();
  assert.equal(stored.perfSnapshots?.length, 1, "snapshot stored");
  assert.ok((stored.perfSnapshots?.[0]?.at ?? 0) > 0, "timestamped");
  assert.match(byId("perf-out").textContent, /sidepanel\.render: count 2/);

  byId("perf-reset-snapshot").click();
  await tick();
  await tick();
  assert.equal(stored.perfMetrics, undefined, "running metrics cleared");
  assert.equal(stored.perfSnapshots?.length, 1, "snapshot history survives");

  byId("perf-reset").click();
  await tick();
  await tick();
  assert.equal(stored.perfSnapshots, undefined, "reset all clears history too");
  assert.equal(byId("perf-out").textContent, "");
});

test("UI - Options - Restore defaults resets settings/ui but keeps protected sites", async () => {
  stored.settings = { autoSnoozeEnabled: false, inactivityMinutes: 45 };
  stored.ui = { fontSize: 1.2, theme: "light" };
  stored.protectionRules = [{ id: "r1", type: "domain", pattern: "*.github.com" }];
  byId("restore-defaults").click();
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
  byId("clear-protected").click();
  await tick();
  await tick();
  assert.deepEqual(stored.protectionRules, [], "all rules removed");
  assert.equal(stored.settings.inactivityMinutes, 45, "settings untouched");
});

test("UI - Options - Dropdown shows the effective mode when the stored one is flag-disabled", async () => {
  const { resolveNavMode, applyExperimental } = await import("../../../src/app/core.ts");
  stored.ui = { ...stored.ui, historyNav: "compact" };
  await chrome.storage.onChanged.fire({ ui: {} }, "local"); // re-render
  await tick();
  await tick();
  // adaptive: compact flag off → traditional; both off → disabled; resolved
  // with experimental applied the way the app does (stored ui)
  const mode = resolveNavMode(applyExperimental(RAW_FEATURES, stored.ui?.showExperimental ?? false), stored.ui);
  assert.equal(
    byId<HTMLSelectElement>("historyNav").value,
    mode === "off" ? "disabled" : mode,
    "dropdown shows the resolver's effective mode, stored value not rewritten",
  );
  assert.equal(stored.ui.historyNav, "compact", "stored preference untouched");
});

const CHANGES_COLLAPSABLE = TEST_FEATURES.OPTION_COLLAPSABLE_CHANGE_LOG_ITEMS?.enabled === true;

test("UI - Options - What's new paginates: initial count, then a page per click until done", async () => {
  const { SHOW_INITIAL_CHANGES, SHOW_MORE_PAGE } = await import("../../../src/pages/options/model.ts");
  const { readFileSync } = await import("node:fs");
  const md = readFileSync(new URL("../../../CHANGES.md", import.meta.url), "utf8");
  const total = md.split(/^## /m).length - 1;
  const box = byId("whats-new");
  const entries = qa<HTMLDetailsElement>(box, ".changes-entry");
  assert.equal(entries.length, total, "every release section rendered");
  const visibleCount = () => qa(box, ".changes-entry").filter((d) => !d.hidden).length;
  assert.equal(visibleCount(), Math.min(SHOW_INITIAL_CHANGES, total), "initial count visible up front");
  if (CHANGES_COLLAPSABLE) {
    assert.ok(
      [...entries].every((d, index) => d.open === index < SHOW_INITIAL_CHANGES),
      "initial page expanded, later releases folded",
    );
  }

  if (total <= SHOW_INITIAL_CHANGES) {
    assert.equal(box.querySelector("#changes-more"), null, "no Show-more at the initial count or fewer releases");
    return;
  }
  let clicks = 0;
  let button = box.querySelector<HTMLElement>("#changes-more");
  while (button) {
    const hidden = total - visibleCount();
    assert.equal(button.textContent, `Show ${Math.min(SHOW_MORE_PAGE, hidden)} more`, "label = next page size");
    button.click();
    clicks++;
    assert.equal(
      visibleCount(),
      Math.min(total, total - hidden + Math.min(SHOW_MORE_PAGE, hidden)),
      "one page revealed",
    );
    assert.ok(clicks <= total, "terminates");
    button = box.querySelector<HTMLElement>("#changes-more");
  }
  assert.equal(visibleCount(), total, "everything visible at the end");
  assert.equal(clicks, Math.ceil((total - SHOW_INITIAL_CHANGES) / SHOW_MORE_PAGE), "page count");
});

test("UI - Options - What's new fold-all toggle collapses and expands every release", {
  skip: !CHANGES_COLLAPSABLE, // OPTION_COLLAPSABLE_CHANGE_LOG_ITEMS disabled in features.json
}, () => {
  const box = byId("whats-new");
  const toggle = byId("changes-toggle");
  const allDetails = qa<HTMLDetailsElement>(box, "details");
  assert.equal(toggle.title, "Click to Collapse", "some entries open at start");
  assert.ok(toggle.querySelector("svg"), "icon button, not text");
  toggle.click();
  assert.ok(
    allDetails.every((d) => !d.open),
    "everything folded",
  );
  assert.equal(toggle.title, "Click to Expand");
  toggle.click();
  assert.ok(
    allDetails.every((d) => d.open),
    "everything expanded, hidden ones included",
  );
  assert.equal(toggle.title, "Click to Collapse");
});

test("UI - Options - What's new flag off: entries always expanded, no fold UI", {
  skip: CHANGES_COLLAPSABLE, // OPTION_COLLAPSABLE_CHANGE_LOG_ITEMS enabled in features.json
}, () => {
  const box = byId("whats-new");
  assert.equal(document.getElementById("changes-toggle"), null, "no fold-all toggle");
  assert.equal(box.querySelector("details"), null, "no collapsibles at all");
  assert.equal(box.querySelector("summary"), null, "no chevron carriers");
  const entries = qa(box, ".changes-entry");
  assert.ok(entries.length > 0, "entries rendered as plain blocks");
  assert.ok(
    entries.every((e) => e.querySelector(".changes-title") && e.querySelector("pre")),
    "every entry shows title + body unconditionally",
  );
});

test("UI - Options - Hidden-matches dropdown visible only with SEARCH_AUTO_SELECT_ALL", async () => {
  const { applyExperimental, featureEnabled } = await import("../../../src/app/core.ts");
  const effective = applyExperimental(RAW_FEATURES, stored.ui?.showExperimental ?? false);
  assert.equal(
    byId("searchEmptyFilter-label").hidden,
    !featureEnabled(effective, "SEARCH_AUTO_SELECT_ALL"),
    "label visibility follows the resolved flag",
  );
  assert.equal(
    byId<HTMLSelectElement>("searchEmptyFilter").value,
    stored.ui?.searchEmptyFilter ?? "keep",
    "defaults to keeping the filter",
  );
});

test("UI - Options - Hide update banner checkbox persists ui.hideUpdateBanner", async () => {
  const box = byId<HTMLInputElement>("hideUpdateBanner");
  assert.equal(box.checked, false, "default: banner not hidden");
  box.checked = true;
  box.dispatchEvent(new window.Event("change", { bubbles: true }));
  await tick();
  assert.ok(
    calls.some((c) => c.startsWith("storage.set") && c.includes('"hideUpdateBanner":true')),
    "preference persisted",
  );
});

test("UI - Options - On-extension-update dropdown persists ui.onExtensionUpdate", async () => {
  const select = byId<HTMLSelectElement>("onExtensionUpdate");
  assert.equal(select.value, "banner", "default: offer the restore banner");
  assert.deepEqual(
    [...select.options].map((o) => o.value),
    ["banner", "none"],
    "auto hidden until gesture-safe",
  );
  select.value = "none";
  select.dispatchEvent(new window.Event("change", { bubbles: true }));
  await tick();
  assert.ok(
    calls.some((c) => c.startsWith("storage.set") && c.includes('"onExtensionUpdate":"none"')),
    "preference persisted",
  );
});

test("UI - Options - Fuzzy-search toggle visible only while enabled AND experimental", async () => {
  const { applyExperimental, featureEnabled } = await import("../../../src/app/core.ts");
  const effective = applyExperimental(RAW_FEATURES, stored.ui?.showExperimental ?? false);
  const offered =
    (stored.ui?.showExperimental ?? false) &&
    !featureEnabled(RAW_FEATURES, "FUZZY_SEARCH") &&
    featureEnabled(effective, "FUZZY_SEARCH");
  assert.equal(byId("experimental_fuzzySearch-label").hidden, !offered);
  const box = byId<HTMLInputElement>("experimental_fuzzySearch");
  assert.equal(box.checked, true, "defaults on");
  box.checked = false;
  box.dispatchEvent(new window.Event("change", { bubbles: true }));
  await tick();
  assert.ok(
    calls.some((c) => c.startsWith("storage.set") && c.includes('"experimental_fuzzySearch":false')),
    "persisted under the experimental_ prefix",
  );
});

test("UI - Options - Window tab-order dropdown defaults to same-as-window and persists", async () => {
  const select = byId<HTMLSelectElement>("groupByWindowTabsOrder");
  assert.equal(select.value, "same-as-window", "default: mirrors the real tab strip");
  select.value = "title-asc";
  select.dispatchEvent(new window.Event("change", { bubbles: true }));
  await tick();
  assert.ok(
    calls.some((c) => c.startsWith("storage.set") && c.includes('"groupByWindowTabsOrder":"title-asc"')),
    "preference persisted",
  );
  select.value = "same-as-window";
  select.dispatchEvent(new window.Event("change", { bubbles: true }));
  await tick();
});

test("UI - Options - Window-names toggle visible only with WINDOW_NAMES; persists ui.windowNamesEnabled", async () => {
  const { applyExperimental, featureEnabled } = await import("../../../src/app/core.ts");
  await chrome.storage.onChanged.fire({ protectionRules: {} }, "local"); // re-render with the ui prior tests left
  await tick();
  await tick();
  // adaptive like the fuzzy-search test: visibility follows the STORED
  // showExperimental (earlier tests reset it), not the scenario's injection
  const effective = applyExperimental(RAW_FEATURES, stored.ui?.showExperimental ?? false);
  const flagOn = featureEnabled(effective, "WINDOW_NAMES");
  assert.equal(byId("windowNamesEnabled-label").hidden, !flagOn, "visible iff flag resolves on");
  const box = byId<HTMLInputElement>("windowNamesEnabled");
  assert.equal(box.checked, true, "default: names shown");
  box.checked = false;
  box.dispatchEvent(new window.Event("change", { bubbles: true }));
  await tick();
  assert.ok(
    calls.some((c) => c.startsWith("storage.set") && c.includes('"windowNamesEnabled":false')),
    "preference persisted",
  );
});
