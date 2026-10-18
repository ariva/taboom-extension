import assert from "node:assert/strict";
import { test } from "vitest";
import type { KeepAliveTab, LocalStorageSchema, ProtectionRule, Removal } from "../../../src/app/types.ts";
import { byId, q, qa } from "../../helpers/dom.ts";
import { makeChrome, loadPage, tick, RAW_FEATURES, TEST_EXPERIMENTAL, TEST_FEATURES } from "../../helpers/ui.ts";

const calls: string[] = [];

// A lookup that must hit: a miss fails the test with a readable message
function must<T>(found: T | null | undefined): T {
  if (found == null) {
    throw new Error("test: expected node / value is missing");
  }
  return found;
}
// the slice of chrome.storage.local this page reads and writes (the mock mutates it in place);
// the rules carry no createdAt — the page never reads it
const stored: Pick<LocalStorageSchema, "settings" | "ui"> &
  Partial<Pick<LocalStorageSchema, "perfMetrics" | "perfSnapshots">> & {
    protectionRules: Omit<ProtectionRule, "createdAt">[];
    keepAlive?: KeepAliveTab[];
    keepAliveTrash?: Removal<KeepAliveTab>[];
    protectionTrash?: Removal<Omit<ProtectionRule, "createdAt">>[];
    parkedTrash?: LocalStorageSchema["parkedTrash"];
    parkedWindows?: LocalStorageSchema["parkedWindows"];
    tags?: LocalStorageSchema["tags"];
    tagPages?: LocalStorageSchema["tagPages"];
    tagTrash?: LocalStorageSchema["tagTrash"];
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
  assert.match(
    byId("page-title").textContent,
    /Taboom Extension v0\.0\.0-test Settings$/,
    "heading carries the version",
  );
});

test("UI - Options - Stored theme forced onto the page", () => {
  assert.equal(document.documentElement.style.colorScheme, "light");
});

test("UI - Options - 'Snooze inactive tabs now' asks the worker for a pass and reports the count", async () => {
  const original = chrome.runtime.sendMessage;
  chrome.runtime.sendMessage = async (msg: { type: string }) => {
    calls.push(`sendMessage ${msg.type}`);
    return { snoozed: 3 };
  };
  calls.length = 0;
  byId<HTMLButtonElement>("snooze-now").click();
  await tick();
  await tick();
  chrome.runtime.sendMessage = original;
  assert.deepEqual(calls, ["sendMessage snooze-all-inactive"]);
  const toast = byId("toast");
  assert.equal(toast.hidden, false);
  assert.equal(toast.textContent, "Snoozed 3 tabs");
});

test("UI - Options - Protection rules render as removable entries", async () => {
  const li = q(document, "#rules li");
  assert.match(li.textContent, /\*\.github\.com/);
  stored.protectionTrash = [];
  q(li, "button").click();
  await tick();
  await tick();
  assert.deepEqual(stored.protectionRules, [], "rule removed");
  assert.match(q(document, "#rules li").textContent, /No protected sites yet/);
  assert.deepEqual(
    stored.protectionTrash.map((action) => action.items.map((rule) => rule.pattern)),
    [["*.github.com"]],
    "the chip's ✕ is a restorable removal",
  );
  stored.protectionTrash = [];
  await chrome.storage.onChanged.fire({ protectionRules: {} }, "local");
  await tick();
  await tick();
});

test("UI - Options - Protected site chip: click the pattern to edit it in place; blur / Enter save, Escape cancels", async () => {
  stored.protectionRules = [
    { id: "r1", type: "domain", pattern: "*.github.com" },
    { id: "r2", type: "host", pattern: "mail.google.com" },
  ];
  await chrome.storage.onChanged.fire({ protectionRules: {} }, "local");
  await tick();
  await tick();
  const chip = () => qa(document, "#rules li")[0]!;
  const key = (name: string) => new window.KeyboardEvent("keydown", { key: name, bubbles: true });
  assert.equal(chip().querySelector("input"), null, "pattern shown as text at first");
  assert.equal(
    q(chip(), "span").title,
    "Domain and its subdomains: *.github.com\nClick to edit the pattern",
    "tooltip names the kind and the full pattern, like a keep-alive row",
  );
  assert.equal(
    q(qa(document, "#rules li")[1]!, "span").title,
    "Exact host: mail.google.com\nClick to edit the pattern",
  );
  q(chip(), "span").click();
  const input = q<HTMLInputElement>(chip(), "input.rename-input");
  assert.equal(input.value, "*.github.com");
  assert.equal(qa(chip(), "button").length, 1, "the ✕ stays while editing");

  input.value = " https://App.Example.com/board ";
  input.dispatchEvent(new window.Event("blur"));
  await tick();
  await tick();
  assert.deepEqual(
    stored.protectionRules[0],
    { id: "r1", type: "url", pattern: "https://app.example.com/board" },
    "normalized through makeRule, id kept, type follows",
  );
  assert.equal(q(chip(), "span").textContent, "https://app.example.com/board", "chip re-rendered as text");

  q(chip(), "span").click();
  const second = q<HTMLInputElement>(chip(), "input.rename-input");
  second.value = "*.github.com";
  second.dispatchEvent(key("Enter"));
  await tick();
  await tick();
  assert.equal(stored.protectionRules[0]?.pattern, "*.github.com", "Enter saves");

  for (const [value, how] of [
    ["changed.example.com", "Escape"],
    ["mail.google.com", "blur"],
    ["   ", "blur"],
    ["*.github.com", "blur"],
  ] as const) {
    q(chip(), "span").click();
    const editing = q<HTMLInputElement>(chip(), "input.rename-input");
    editing.value = value;
    calls.length = 0;
    editing.dispatchEvent(how === "Escape" ? key("Escape") : new window.Event("blur"));
    await tick();
    await tick();
    assert.ok(!calls.some((c) => c.startsWith("storage.set")), `${value} via ${how}: no write`);
    assert.equal(q(chip(), "span").textContent, "*.github.com", `${value} via ${how}: text back`);
  }
  stored.protectionRules = []; // as the removal test above left it — the add test expects its rule first
  await chrome.storage.onChanged.fire({ protectionRules: {} }, "local");
  await tick();
  await tick();
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

test("UI - Options - Restore defaults resets settings/ui but keeps protected sites, keep-alive marks and parked windows", async () => {
  stored.settings = { autoSnoozeEnabled: false, inactivityMinutes: 45 };
  stored.ui = { fontSize: 1.2, theme: "light" };
  stored.protectionRules = [{ id: "r1", type: "domain", pattern: "*.github.com" }];
  stored.keepAlive = [{ url: "https://keep.example.com/", title: "Keep", minutes: 5, nextReload: 1 }];
  stored.parkedWindows = [{ id: "p1", parkedAt: 1, tabs: [{ url: "https://p.example.com/", title: "P" }], groups: [] }];
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
  assert.equal(stored.keepAlive?.length, 1, "keep-alive marks untouched");
  assert.equal(stored.parkedWindows?.length, 1, "parked windows untouched");
  assert.match(
    byId("restore-defaults").previousElementSibling?.textContent ?? "",
    /Protected sites, keep-alive marks, parked windows and tags stay unchanged/,
    "card says what is kept",
  );
  stored.keepAlive = [];
  stored.parkedWindows = [];
});

test("UI - Options - Delete restore data: disabled while both undo stacks are empty, otherwise clears them without a prompt", async () => {
  const button = byId<HTMLButtonElement>("delete-restore-data");
  assert.ok(button.closest("section")?.contains(byId("danger")), "lives in the Data card");
  stored.keepAliveTrash = [];
  stored.protectionTrash = [];
  stored.parkedTrash = [];
  await chrome.storage.onChanged.fire({ protectionRules: {} }, "local");
  await tick();
  await tick();
  assert.equal(button.disabled, true, "nothing to forget: disabled");

  // a removed parked window alone enables it, and goes with the rest
  stored.parkedTrash = [
    { at: 1, items: [{ id: "p1", parkedAt: 1, tabs: [{ url: "https://p.example.com/", title: "P" }], groups: [] }] },
  ];
  await chrome.storage.onChanged.fire({ protectionRules: {} }, "local");
  await tick();
  await tick();
  assert.equal(button.disabled, false, "removed parked data counts as restore data");
  // the side panel's Undo remove empties that trash: the page follows the storage event alone
  stored.parkedTrash = [];
  await chrome.storage.onChanged.fire({ parkedTrash: { newValue: [] } }, "local");
  await tick();
  await tick();
  assert.equal(button.disabled, true, "re-rendered on a trash-only change");
  stored.parkedTrash = [
    { at: 1, items: [{ id: "p1", parkedAt: 1, tabs: [{ url: "https://p.example.com/", title: "P" }], groups: [] }] },
  ];
  await chrome.storage.onChanged.fire({ parkedTrash: { newValue: stored.parkedTrash } }, "local");
  await tick();
  await tick();
  assert.equal(button.disabled, false);

  stored.protectionTrash = [{ at: 1, items: [{ id: "x", type: "host", pattern: "x.example.com" }] }];
  stored.keepAliveTrash = [
    { at: 1, items: [{ url: "https://x.example.com/", title: "X", minutes: 5, nextReload: 1 }] },
  ];
  await chrome.storage.onChanged.fire({ protectionRules: {} }, "local");
  await tick();
  await tick();
  assert.equal(button.disabled, false, "something to forget: enabled");
  assert.equal(byId("restore-protected").hidden, false);

  // `as`: the harness installs confirm on globalThis (helpers/ui.ts); the page must not call it here
  const globals = globalThis as { confirm: () => boolean };
  const confirmBefore = globals.confirm;
  let prompted = false;
  globals.confirm = () => {
    prompted = true;
    return false;
  };
  button.click();
  await tick();
  await tick();
  globals.confirm = confirmBefore;
  assert.equal(prompted, false, "no confirm dialog");
  assert.deepEqual(stored.protectionTrash, []);
  assert.deepEqual(stored.keepAliveTrash, []);
  assert.deepEqual(stored.parkedTrash, []);
  assert.equal(button.disabled, true, "disabled again");
  assert.equal(byId("restore-protected").hidden, true, "restore buttons gone with the data");

  calls.length = 0;
  button.click();
  await tick();
  assert.ok(!calls.some((c) => c.startsWith("storage.set")), "disabled: no write");
});

test("UI - Options - Clear protected sites empties rules but keeps settings; Restore brings removals back newest first", async () => {
  stored.settings.inactivityMinutes = 45;
  stored.protectionRules = [
    { id: "r1", type: "domain", pattern: "*.github.com" },
    { id: "r2", type: "host", pattern: "mail.google.com" },
  ];
  stored.protectionTrash = [];
  await chrome.storage.onChanged.fire({ protectionRules: {} }, "local");
  await tick();
  await tick();
  const restore = byId<HTMLButtonElement>("restore-protected");
  assert.equal(restore.hidden, true, "nothing removed yet: no button");
  assert.ok(
    byId("clear-protected").closest("section")?.contains(byId("rules")),
    "Clear all lives in the Protected Sites card",
  );

  q(qa(document, "#rules li")[1]!, "button").click(); // mail chip ✕
  await tick();
  await tick();
  assert.equal(restore.hidden, false);
  assert.equal(restore.textContent, "Restore last removal (1 site)");
  assert.equal(restore.title, "Restore:\nmail.google.com");

  byId("clear-protected").click();
  await tick();
  await tick();
  assert.equal(stored.protectionRules.length, 0, "all rules removed"); // not deepEqual([]): narrows to never[]
  assert.equal(stored.settings.inactivityMinutes, 45, "settings untouched");
  assert.equal(stored.protectionTrash.length, 2, "two actions on the stack");
  assert.equal(restore.textContent, "Restore last removal (1 site)", "newest action counted");

  calls.length = 0;
  byId("clear-protected").click();
  await tick();
  await tick();
  assert.ok(!calls.some((c) => c.startsWith("storage.set")), "already empty: no write");

  restore.click();
  await tick();
  await tick();
  assert.deepEqual(
    stored.protectionRules.map((rule) => rule.pattern),
    ["*.github.com"],
    "Clear all undone first",
  );
  restore.click();
  await tick();
  await tick();
  assert.deepEqual(
    stored.protectionRules.map((rule) => rule.pattern),
    ["*.github.com", "mail.google.com"],
  );
  assert.equal(restore.hidden, true, "stack empty: button gone");
  assert.equal(qa(document, "#rules li").length, 2, "chips re-rendered");

  // a many-rule action: tooltip lists 10 patterns then an ellipsis line
  const patterns = Array.from({ length: 12 }, (_, index) => `s${index}.example.com`);
  stored.protectionTrash = [
    { at: 1, items: patterns.map((pattern, index) => ({ id: `p${index}`, type: "host", pattern })) },
  ];
  await chrome.storage.onChanged.fire({ protectionRules: {} }, "local");
  await tick();
  await tick();
  assert.equal(restore.textContent, "Restore last removal (12 sites)");
  assert.equal(restore.title, ["Restore:", ...patterns.slice(0, 10), "…"].join("\n"));
  stored.protectionTrash = [];
  stored.protectionRules = [{ id: "r1", type: "domain", pattern: "*.github.com" }];
  await chrome.storage.onChanged.fire({ protectionRules: {} }, "local");
  await tick();
  await tick();
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

// ---------- keep-it-alive (T-0002) ----------

test("UI - Options - Keep-alive card visible iff KEEP_ALIVE resolves on; enabled by default, body follows the toggle", async () => {
  const { applyExperimental, featureEnabled } = await import("../../../src/app/core.ts");
  await chrome.storage.onChanged.fire({ protectionRules: {} }, "local"); // re-render with the ui prior tests left
  await tick();
  await tick();
  const flagOn = featureEnabled(applyExperimental(RAW_FEATURES, stored.ui?.showExperimental ?? false), "KEEP_ALIVE");
  assert.equal(byId("keep-alive-section").hidden, !flagOn, "card visible iff flag resolves on");
  if (!flagOn) {
    return;
  }
  const box = byId<HTMLInputElement>("keepAliveEnabled");
  assert.equal(box.checked, true, "default: on — the experimental opt-in is the only gate");
  assert.equal(byId("keep-alive-body").hidden, false, "table + default interval shown while on");
  const minutes = byId<HTMLSelectElement>("keepAliveMinutes");
  assert.deepEqual(
    qa<HTMLOptionElement>(minutes, "option").map((option) => option.value),
    ["1", "5", "10", "15", "20", "25", "30", "45", "60", "90"],
  );
  assert.equal(minutes.value, "20", "default interval");
  calls.length = 0;
  box.checked = false;
  box.dispatchEvent(new window.Event("change", { bubbles: true }));
  await tick();
  await tick();
  assert.ok(
    calls.some((c) => c.startsWith("storage.set") && c.includes('"keepAliveEnabled":false')),
    "setting persisted",
  );
  await chrome.storage.onChanged.fire({ settings: {} }, "local");
  await tick();
  await tick();
  assert.equal(byId("keep-alive-body").hidden, true, "body hidden once disabled");
  box.checked = true;
  box.dispatchEvent(new window.Event("change", { bubbles: true }));
  await tick();
  await tick();
  await chrome.storage.onChanged.fire({ settings: {} }, "local");
  await tick();
  await tick();
  assert.equal(byId("keep-alive-body").hidden, false, "body back once re-enabled");
  assert.match(byId("keep-alive-rows").textContent, /No tabs marked yet/);

  minutes.value = "10";
  minutes.dispatchEvent(new window.Event("change", { bubbles: true }));
  await tick();
  assert.ok(
    calls.some((c) => c.startsWith("storage.set") && c.includes('"keepAliveMinutes":10')),
    "default interval persisted as a number",
  );
});

test("UI - Options - Keep-alive table: per-row pause, interval, countdown and remove", async () => {
  const { applyExperimental, featureEnabled } = await import("../../../src/app/core.ts");
  const flagOn = featureEnabled(applyExperimental(RAW_FEATURES, stored.ui?.showExperimental ?? false), "KEEP_ALIVE");
  if (!flagOn) {
    return;
  }
  const now = Date.now();
  stored.keepAlive = [
    { url: "https://dash.example.com/board", title: "Board", minutes: 25, nextReload: now + 5 * 60_000 + 500 },
    { url: "https://mail.example.com/", title: "Mail", minutes: 5, paused: true, nextReload: 1, reloadAll: true },
  ];
  await chrome.storage.onChanged.fire({ keepAlive: {} }, "local");
  await tick();
  await tick();
  const rows = qa(byId("keep-alive-rows"), "tr");
  assert.equal(rows.length, 2);
  const cells = qa(rows[0]!, "td");
  assert.equal(cells.length, 7, "number, enable, page, interval, tabs, next reload, remove");
  const tabsOf = (row: Element) => qa<HTMLSelectElement>(row, "select")[1]!;
  assert.equal(tabsOf(rows[0]!).value, "one", "default: one tab per reload");
  assert.equal(tabsOf(rows[1]!).value, "all", "reloadAll mark shows All tabs");
  assert.deepEqual(
    qa<HTMLOptionElement>(tabsOf(rows[0]!), "option").map((option) => option.textContent),
    ["One tab", "All tabs"],
  );
  tabsOf(rows[0]!).value = "all";
  tabsOf(rows[0]!).dispatchEvent(new window.Event("change", { bubbles: true }));
  await tick();
  await tick();
  assert.equal(stored.keepAlive[0]?.reloadAll, true, "All tabs written on the mark");
  const mailTabs = tabsOf(qa(byId("keep-alive-rows"), "tr")[1]!);
  mailTabs.value = "one";
  mailTabs.dispatchEvent(new window.Event("change", { bubbles: true }));
  await tick();
  await tick();
  assert.ok(!("reloadAll" in (stored.keepAlive[1] ?? {})), "One tab = key absent");
  assert.deepEqual(
    rows.map((row) => q(row, "td").textContent),
    ["1", "2"],
    "rows numbered",
  );
  assert.equal(q<HTMLInputElement>(rows[0]!, 'input[type="checkbox"]').checked, true, "running mark: checked");
  assert.equal(q<HTMLInputElement>(rows[1]!, 'input[type="checkbox"]').checked, false, "paused mark: unchecked");
  assert.match(cells[2]!.textContent, /Board/);
  assert.match(cells[2]!.textContent, /dash\.example\.com/);
  const first = q<HTMLSelectElement>(rows[0]!, "select");
  const second = q<HTMLSelectElement>(rows[1]!, "select");
  assert.ok(
    !qa<HTMLOptionElement>(first, "option").some((option) => option.value === ""),
    "no Default option: every mark has its own interval",
  );
  assert.equal(first.value, "25");
  assert.equal(second.value, "5");
  assert.match(q(rows[0]!, ".countdown").textContent, /^[45]:[0-5]\d$/, "time left until the next reload");
  assert.equal(q(rows[1]!, ".countdown").textContent, "paused");
  assert.equal(q<HTMLButtonElement>(rows[0]!, "button").textContent, "Remove");

  calls.length = 0;
  first.value = "45";
  first.dispatchEvent(new window.Event("change", { bubbles: true }));
  await tick();
  await tick();
  const changed = calls.find((c) => c.startsWith("storage.set") && c.includes('"keepAlive"'));
  assert.ok(changed, "interval written");
  assert.equal(stored.keepAlive[0]?.minutes, 45);
  assert.ok(
    (stored.keepAlive[0]?.nextReload ?? 0) >= now + 45 * 60_000 - 55_000,
    "re-armed from now at the new interval",
  );

  calls.length = 0;
  const pause = q<HTMLInputElement>(qa(byId("keep-alive-rows"), "tr")[0]!, 'input[type="checkbox"]');
  pause.checked = false;
  pause.dispatchEvent(new window.Event("change", { bubbles: true }));
  await tick();
  await tick();
  assert.equal(stored.keepAlive[0]?.paused, true, "unchecked = paused");
  assert.ok((stored.keepAlive[0]?.nextReload ?? 0) >= now + 45 * 60_000 - 55_000, "pause restarts the schedule");
  const resume = q<HTMLInputElement>(qa(byId("keep-alive-rows"), "tr")[1]!, 'input[type="checkbox"]');
  resume.checked = true;
  resume.dispatchEvent(new window.Event("change", { bubbles: true }));
  await tick();
  await tick();
  assert.ok(!("paused" in (stored.keepAlive[1] ?? {})), "checked = running, key absent");
  assert.ok((stored.keepAlive[1]?.nextReload ?? 0) >= now + 5 * 60_000 - 55_000, "resume re-arms from now");

  calls.length = 0;
  q<HTMLButtonElement>(qa(byId("keep-alive-rows"), "tr")[1]!, "button").click();
  await tick();
  await tick();
  assert.deepEqual(
    stored.keepAlive.map((entry) => entry.url),
    ["https://dash.example.com/board"],
    "row removed",
  );
  assert.equal(qa(byId("keep-alive-rows"), "tr").length, 1, "table re-rendered");
  stored.keepAlive = [];
});

test("UI - Options - Keep-alive add row: url + Add marks a page by hand at the Default value, like protected sites", async () => {
  const { applyExperimental, featureEnabled } = await import("../../../src/app/core.ts");
  const flagOn = featureEnabled(applyExperimental(RAW_FEATURES, stored.ui?.showExperimental ?? false), "KEEP_ALIVE");
  if (!flagOn) {
    return;
  }
  stored.keepAlive = [];
  stored.settings = { ...stored.settings, keepAliveMinutes: 15 };
  await chrome.storage.onChanged.fire({ settings: {}, keepAlive: {} }, "local");
  await tick();
  await tick();
  const input = byId<HTMLInputElement>("new-keep-alive");
  const add = byId<HTMLButtonElement>("add-keep-alive");
  assert.ok(
    byId("keep-alive-table").compareDocumentPosition(add) & 4, // DOCUMENT_POSITION_FOLLOWING; happy-dom has no Node global
    "add row sits under the table",
  );

  // junk: nothing written, input kept for correction
  calls.length = 0;
  input.value = "chrome://extensions";
  add.click();
  await tick();
  await tick();
  assert.ok(!calls.some((c) => c.startsWith("storage.set") && c.includes('"keepAlive"')), "unsupported url: no write");
  assert.equal(input.value, "chrome://extensions");

  const now = Date.now();
  input.value = "Dash.Example.com/board#tab=2";
  add.click();
  await tick();
  await tick();
  assert.deepEqual(
    (stored.keepAlive ?? []).map(({ url, title, minutes: each }) => ({ url, title, minutes: each })),
    [{ url: "https://dash.example.com/board#tab=2", title: "dash.example.com", minutes: 15 }],
    "normalized url with its fragment, hostname as title until a tab reports one, the Default value copied",
  );
  assert.ok((stored.keepAlive?.[0]?.nextReload ?? 0) >= now + 15 * 60_000 - 55_000, "armed from now");
  assert.equal(input.value, "", "input cleared");
  assert.equal(qa(byId("keep-alive-rows"), "tr").length, 1, "table shows the new mark");

  // same page again: no second entry, no write
  calls.length = 0;
  input.value = "https://dash.example.com/board#tab=2";
  add.click();
  await tick();
  await tick();
  assert.equal(stored.keepAlive?.length, 1, "duplicate ignored");
  assert.ok(!calls.some((c) => c.startsWith("storage.set") && c.includes('"keepAlive"')), "duplicate: no write");
  assert.equal(input.value, "", "input still cleared");
  stored.keepAlive = [];
});

test("UI - Options - Keep-alive url: click turns it into an input; blur / Enter save the normalized address, Escape cancels", async () => {
  const { applyExperimental, featureEnabled } = await import("../../../src/app/core.ts");
  const flagOn = featureEnabled(applyExperimental(RAW_FEATURES, stored.ui?.showExperimental ?? false), "KEEP_ALIVE");
  if (!flagOn) {
    return;
  }
  stored.keepAlive = [
    { url: "https://dash.example.com/board", title: "Board", minutes: 25, nextReload: 123 },
    { url: "https://mail.example.com/", title: "Mail", minutes: 5, nextReload: 1 },
  ];
  await chrome.storage.onChanged.fire({ keepAlive: {} }, "local");
  await tick();
  await tick();
  const row = () => qa(byId("keep-alive-rows"), "tr")[0]!;
  const key = (name: string) => new window.KeyboardEvent("keydown", { key: name, bubbles: true });
  assert.equal(row().querySelector("input.rename-input"), null, "url shown as text at first");
  qa(row(), "td")[2]!.click(); // the title text, not the url span: the whole Page cell is the handle
  const input = q<HTMLInputElement>(row(), "input.rename-input");
  assert.equal(input.value, "https://dash.example.com/board", "the input starts with the current url");
  input.click();
  assert.equal(qa(row(), "input.rename-input").length, 1, "clicking inside the open editor does not stack another");

  // blur commits: normalized, fragment allowed, everything else on the mark kept
  calls.length = 0;
  input.value = "Dash.Example.com/board#/dash ";
  input.dispatchEvent(new window.Event("blur"));
  await tick();
  await tick();
  assert.deepEqual(stored.keepAlive[0], {
    url: "https://dash.example.com/board#/dash",
    title: "Board",
    minutes: 25,
    nextReload: 123,
  });
  assert.equal(q(row(), ".url").textContent, "https://dash.example.com/board#/dash", "row re-rendered as text");

  // Enter commits too
  q(row(), ".url").click();
  const second = q<HTMLInputElement>(row(), "input.rename-input");
  second.value = "https://dash.example.com/board";
  second.dispatchEvent(key("Enter"));
  await tick();
  await tick();
  assert.equal(stored.keepAlive[0]?.url, "https://dash.example.com/board");
  assert.equal(q(row(), ".url").textContent, "https://dash.example.com/board");

  // Escape cancels; another mark's url, junk and an unchanged value write nothing
  for (const [value, how] of [
    ["https://changed.example.com/", "Escape"],
    ["https://mail.example.com/", "blur"],
    ["chrome://extensions", "blur"],
    ["https://dash.example.com/board", "blur"],
  ] as const) {
    q(row(), ".url").click();
    const editing = q<HTMLInputElement>(row(), "input.rename-input");
    editing.value = value;
    calls.length = 0;
    editing.dispatchEvent(how === "Escape" ? key("Escape") : new window.Event("blur"));
    await tick();
    await tick();
    assert.ok(!calls.some((c) => c.startsWith("storage.set")), `${value} via ${how}: no write`);
    assert.equal(q(row(), ".url").textContent, "https://dash.example.com/board", `${value} via ${how}: text back`);
  }
  stored.keepAlive = [];
});

test("UI - Options - Clear all keep-alive marks empties the list behind a confirm; no write when already empty", async () => {
  const { applyExperimental, featureEnabled } = await import("../../../src/app/core.ts");
  const flagOn = featureEnabled(applyExperimental(RAW_FEATURES, stored.ui?.showExperimental ?? false), "KEEP_ALIVE");
  if (!flagOn) {
    return;
  }
  stored.keepAlive = [
    { url: "https://dash.example.com/board", title: "Board", minutes: 25, nextReload: 1 },
    { url: "https://mail.example.com/", title: "Mail", minutes: 5, paused: true, nextReload: 1 },
  ];
  stored.settings = { ...stored.settings, inactivityMinutes: 45 };
  await chrome.storage.onChanged.fire({ keepAlive: {} }, "local");
  await tick();
  await tick();
  const clear = byId<HTMLButtonElement>("clear-keep-alive");
  assert.ok(byId("keep-alive-body").contains(clear), "button lives in the keep-alive card, hidden with it");
  byId("clear-keep-alive").click();
  await tick();
  await tick();
  assert.deepEqual(stored.keepAlive, [], "every mark removed, paused ones too");
  assert.equal(stored.settings.inactivityMinutes, 45, "settings untouched");
  assert.match(byId("keep-alive-rows").textContent, /No tabs marked yet/, "table re-rendered");

  calls.length = 0;
  byId("clear-keep-alive").click();
  await tick();
  await tick();
  assert.ok(!calls.some((c) => c.startsWith("storage.set")), "already empty: no write");
});

test("UI - Options - Restore last removal: every removal (row, Clear all) is undoable newest first; hover lists the urls", async () => {
  const { applyExperimental, featureEnabled } = await import("../../../src/app/core.ts");
  const flagOn = featureEnabled(applyExperimental(RAW_FEATURES, stored.ui?.showExperimental ?? false), "KEEP_ALIVE");
  if (!flagOn) {
    return;
  }
  const now = Date.now();
  stored.keepAlive = [
    { url: "https://dash.example.com/board", title: "Board", minutes: 25, nextReload: now + 60_000 },
    { url: "https://mail.example.com/", title: "Mail", minutes: 5, paused: true, nextReload: 1 },
  ];
  stored.keepAliveTrash = [];
  await chrome.storage.onChanged.fire({ keepAlive: {} }, "local");
  await tick();
  await tick();
  const restore = byId<HTMLButtonElement>("restore-keep-alive");
  assert.equal(restore.hidden, true, "nothing removed yet: no button");

  // row Remove → one-mark action
  q<HTMLButtonElement>(qa(byId("keep-alive-rows"), "tr")[1]!, "button").click();
  await tick();
  await tick();
  assert.equal(restore.hidden, false);
  assert.equal(restore.textContent, "Restore last removal (1 mark)");
  assert.equal(restore.title, "Restore:\nhttps://mail.example.com/", "hover says what comes back");

  // Clear all → second action with the remaining mark
  byId("clear-keep-alive").click();
  await tick();
  await tick();
  assert.equal(stored.keepAlive.length, 0); // not deepEqual([]): that narrows the array to never[]
  assert.equal(stored.keepAliveTrash.length, 2, "two actions on the stack");
  assert.equal(restore.textContent, "Restore last removal (1 mark)", "newest action counted");

  restore.click();
  await tick();
  await tick();
  assert.deepEqual(
    stored.keepAlive.map((entry) => entry.url),
    ["https://dash.example.com/board"],
    "Clear all undone first",
  );
  assert.ok((stored.keepAlive[0]?.nextReload ?? 0) >= now + 25 * 60_000 - 55_000, "restored mark re-armed from now");
  assert.equal(restore.hidden, false, "the row removal is still undoable");
  restore.click();
  await tick();
  await tick();
  assert.deepEqual(
    stored.keepAlive.map((entry) => [entry.url, entry.paused ?? false]),
    [
      ["https://dash.example.com/board", false],
      ["https://mail.example.com/", true],
    ],
    "row removal undone, paused flag kept",
  );
  assert.equal(stored.keepAliveTrash.length, 0);
  assert.equal(restore.hidden, true, "stack empty: button gone");
  assert.equal(qa(byId("keep-alive-rows"), "tr").length, 2, "table re-rendered");

  // old actions never expire; the tooltip lists at most 10 urls, then an ellipsis line
  const urls = Array.from({ length: 12 }, (_, index) => `https://n${index}.example.com/`);
  stored.keepAliveTrash = [
    {
      at: now - 400 * 24 * 60 * 60_000,
      items: [{ url: "https://x.example.com/", title: "X", minutes: 5, nextReload: 1 }],
    },
    { at: now - 60_000, items: urls.map((url) => ({ url, title: url, minutes: 5, nextReload: 1 })) },
  ];
  await chrome.storage.onChanged.fire({ keepAlive: {} }, "local");
  await tick();
  await tick();
  assert.equal(restore.textContent, "Restore last removal (12 marks)", "plural label");
  assert.equal(
    restore.title,
    ["Restore:", ...urls.slice(0, 10), "…"].join("\n"),
    "first 10 urls, one per line, then …",
  );
  stored.keepAliveTrash = [stored.keepAliveTrash[0]!];
  await chrome.storage.onChanged.fire({ keepAlive: {} }, "local");
  await tick();
  await tick();
  assert.equal(restore.hidden, false, "a year-old action is still restorable");
  assert.equal(restore.title, "Restore:\nhttps://x.example.com/");
  stored.keepAlive = [];
  stored.keepAliveTrash = [];
});

test("UI - Options - PARKED_WINDOWS: 'Ask before parking' checkbox follows the flag and persists settings.askBeforePark", async () => {
  const { applyExperimental, featureEnabled } = await import("../../../src/app/core.ts");
  const effective = applyExperimental(RAW_FEATURES, stored.ui?.showExperimental ?? false);
  const flagOn = featureEnabled(effective, "PARKED_WINDOWS");
  assert.equal(byId("askBeforePark-label").hidden, !flagOn, "visible iff the flag resolves on");
  const box = byId<HTMLInputElement>("askBeforePark");
  assert.equal(box.checked, true, "default: ask");
  box.checked = false;
  box.dispatchEvent(new window.Event("change", { bubbles: true }));
  await tick();
  assert.ok(calls.some((c) => c.startsWith("storage.set") && c.includes('"askBeforePark":false')));
  box.checked = true;
  box.dispatchEvent(new window.Event("change", { bubbles: true }));
  await tick();
});

test("UI - Options - TAGS card: tag table (add, rename, recolor, remove), tagged pages (add, toggle, remove), restore, remove all", async () => {
  const { applyExperimental, featureEnabled } = await import("../../../src/app/core.ts");
  const flagOn = featureEnabled(applyExperimental(RAW_FEATURES, stored.ui?.showExperimental ?? false), "TAGS");
  stored.tags = [];
  stored.tagPages = [];
  stored.tagTrash = [];
  await chrome.storage.onChanged.fire({ tags: {} }, "local");
  await tick();
  await tick();
  assert.equal(byId("tags-section").hidden, !flagOn, "card visible iff TAGS resolves on");
  if (!flagOn) {
    return;
  }
  const settle = () => new Promise((resolve) => setTimeout(resolve, 50));
  const rerender = async () => {
    await chrome.storage.onChanged.fire({ tags: {} }, "local");
    await tick();
    await tick();
  };
  // Add a tag: name + color
  byId<HTMLInputElement>("new-tag-name").value = " Work ";
  byId<HTMLSelectElement>("new-tag-color").value = "green";
  byId("add-tag").click();
  await settle();
  assert.deepEqual(
    stored.tags.map((tag) => [tag.name, tag.color]),
    [["Work", "green"]],
  );
  assert.equal(byId<HTMLInputElement>("new-tag-name").value, "", "input cleared");
  byId<HTMLInputElement>("new-tag-name").value = "work";
  byId("add-tag").click();
  await settle();
  assert.equal(stored.tags.length, 1, "duplicate refused");
  assert.match(byId("tag-error").textContent ?? "", /exists/, "the reason shows next to the row");
  byId<HTMLInputElement>("new-tag-name").value = "bills";
  byId<HTMLSelectElement>("new-tag-color").value = "yellow";
  byId("add-tag").click();
  await settle();
  await rerender();
  const work = stored.tags[0];
  const bills = stored.tags[1];
  assert.ok(work && bills);
  const tagRows = () => qa<HTMLTableRowElement>(document, "#tag-rows tr");
  assert.deepEqual(
    tagRows().map((row) => qa(row, "td").map((cell, index) => (index === 3 ? "(color)" : cell.textContent?.trim()))),
    [
      ["", "1", "", "(color)", "Work", "0", "Remove"],
      ["", "2", "", "(color)", "bills", "0", "Remove"],
    ],
    "grip · # · on/off · color · name · pages · Remove",
  );
  assert.ok(must(tagRows()[0]).querySelector("td:first-child .drag-grip svg"), "a grip icon says: draggable");
  // the on/off switch: off keeps the tag and its pages, the row reads muted; on again clears the key
  const onOff = q<HTMLInputElement>(must(tagRows()[1]), ".tag-enabled");
  assert.equal(onOff.checked, true);
  onOff.click();
  await settle();
  assert.equal(stored.tags[1]?.disabled, true);
  await rerender();
  assert.ok(must(tagRows()[1]).classList.contains("off"));
  q<HTMLInputElement>(must(tagRows()[1]), ".tag-enabled").click();
  await settle();
  assert.equal(stored.tags[1]?.disabled, undefined, "the key is absent when on");
  await rerender();
  // recolor through the row's select
  const colorSelect = q<HTMLSelectElement>(must(tagRows()[0]), "select");
  assert.equal(colorSelect.value, "green");
  colorSelect.value = "red";
  colorSelect.dispatchEvent(new window.Event("change", { bubbles: true }));
  await settle();
  assert.equal(stored.tags[0]?.color, "red");
  // rename in place: click the name, Enter saves; a clash is refused
  await rerender();
  q(must(tagRows()[0]), ".tag-name").click();
  await tick();
  const edit = q<HTMLInputElement>(document, "#tag-rows .rename-input");
  edit.value = "Job";
  edit.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
  await settle();
  assert.equal(stored.tags[0]?.name, "Job");
  await rerender();
  q(must(tagRows()[1]), ".tag-name").click();
  await tick();
  const clash = q<HTMLInputElement>(document, "#tag-rows .rename-input");
  clash.value = "job";
  clash.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
  await settle();
  assert.equal(stored.tags[1]?.name, "bills", "clash refused");
  // Tagged pages: add by address with a tag, toggle the other tag on it, counts follow
  await rerender();
  byId<HTMLInputElement>("new-tag-page").value = "app.example.com/board#x";
  byId<HTMLSelectElement>("new-tag-page-tag").value = work.id;
  byId("add-tag-page").click();
  await settle();
  assert.deepEqual(
    stored.tagPages,
    [{ url: "https://app.example.com/board", tagIds: [work.id] }],
    "normalized, fragment dropped",
  );
  await rerender();
  const pageRows = () => qa<HTMLTableRowElement>(document, "#tag-page-rows tr");
  assert.equal(pageRows().length, 1);
  assert.equal(q(must(pageRows()[0]), ".url").textContent, "https://app.example.com/board");
  // the page's tags as chips with a ✕ each; the Tags ▾ button opens a picker with one tick per tag
  const chips = () => qa<HTMLElement>(must(pageRows()[0]), ".tag-chip");
  assert.deepEqual(
    chips().map((chip) => q(chip, ".tag-chip-name").textContent),
    ["Job"],
  );
  const pick = byId("tag-page-pick");
  q(must(pageRows()[0]), ".tag-pick-btn").click();
  await tick();
  assert.equal(q(pick, ".tag-pick-title").textContent, "Tags");
  assert.ok(q(pick, ".tag-pick-close svg"), "a corner ✕ like the side panel's picker");
  const ticks = () => qa<HTMLInputElement>(pick, ".tag-pick input");
  assert.deepEqual(
    ticks().map((box) => `${box.closest("label")?.querySelector(".tag-name")?.textContent}:${box.checked}`),
    ["Job:true", "bills:false"],
  );
  must(ticks()[1]).click();
  await settle();
  assert.deepEqual(stored.tagPages[0]?.tagIds, [work.id, bills.id]);
  assert.deepEqual(
    ticks().map((box) => box.checked),
    [true, true],
    "the open picker follows the write",
  );
  await rerender();
  assert.deepEqual(
    tagRows().map((row) => qa(row, "td")[5]?.textContent),
    ["1", "1"],
    "pages column counts",
  );
  // past three tags the row shows three chips and a "+N" count
  stored.tags.push({ id: "tc", name: "c", color: "red" }, { id: "td", name: "d", color: "cyan" });
  stored.tagPages[0]!.tagIds.push("tc", "td");
  await rerender();
  assert.deepEqual(
    chips().map((chip) => q(chip, ".tag-chip-name").textContent),
    ["Job", "bills", "c"],
  );
  assert.equal(q(must(pageRows()[0]), ".tag-more").textContent, "+1");
  stored.tags.splice(2, 2);
  stored.tagPages[0]!.tagIds.splice(2, 2);
  await rerender();
  // ✕ on a chip takes that tag off; the last one gone drops the page (no trash — nothing to undo)
  q(must(chips()[0]), ".tag-chip-remove").click();
  await settle();
  assert.deepEqual(stored.tagPages[0]?.tagIds, [bills.id]);
  await rerender();
  q(must(chips()[0]), ".tag-chip-remove").click();
  await settle();
  assert.equal(stored.tagPages.length, 0);
  assert.equal(stored.tagTrash.length, 0);
  // Remove a page → trash → Restore last removal
  byId<HTMLInputElement>("new-tag-page").value = "https://b.test/";
  byId<HTMLSelectElement>("new-tag-page-tag").value = bills.id;
  byId("add-tag-page").click();
  await settle();
  await rerender();
  q(must(pageRows()[0]), ".remove-page").click();
  await settle();
  assert.equal(stored.tagPages.length, 0);
  assert.equal(stored.tagTrash.length, 1);
  await rerender();
  const restore = byId<HTMLButtonElement>("restore-tags");
  assert.equal(restore.hidden, false);
  assert.equal(restore.textContent, "Restore last removal (1 page)");
  restore.click();
  await settle();
  assert.deepEqual(
    stored.tagPages.map((page) => page.url),
    ["https://b.test/"],
  );
  // Remove a tag → its page ids go too; Remove all → one action; Restore brings everything back
  await rerender();
  q(must(tagRows()[1]), ".remove-tag").click();
  await settle();
  assert.deepEqual(
    stored.tags.map((tag) => tag.name),
    ["Job"],
  );
  assert.equal(stored.tagPages.length, 0, "the page carried only bills");
  await rerender();
  assert.equal(byId("restore-tags").textContent, "Restore last removal (1 tag)");
  byId("clear-tags").click(); // confirm() is stubbed to true
  await settle();
  assert.equal(stored.tags.length, 0);
  await rerender();
  assert.equal(byId("restore-tags").textContent, "Restore last removal (1 tag)");
  byId("restore-tags").click();
  await settle();
  byId("restore-tags").click();
  await settle();
  assert.deepEqual(
    stored.tags.map((tag) => tag.name),
    ["Job", "bills"],
  );
  assert.deepEqual(
    stored.tagPages.map((page) => page.url),
    ["https://b.test/"],
  );
  // the Data card names tags among what Restore defaults keeps and Delete all removes
  assert.match(byId("restore-defaults").previousElementSibling?.textContent ?? "", /tags/);
  assert.match(byId("danger").previousElementSibling?.textContent ?? "", /tags/);
  stored.tags = [];
  stored.tagPages = [];
  stored.tagTrash = [];
});

test("UI - Options - TAGS: drag a tag row onto another to reorder the list (the order drives badges and Group by tag)", async () => {
  const { applyExperimental, featureEnabled } = await import("../../../src/app/core.ts");
  if (!featureEnabled(applyExperimental(RAW_FEATURES, stored.ui?.showExperimental ?? false), "TAGS")) {
    return;
  }
  stored.tags = [
    { id: "ta", name: "alpha", color: "blue" },
    { id: "tb", name: "beta", color: "red" },
    { id: "tc", name: "gamma", color: "green" },
  ];
  await chrome.storage.onChanged.fire({ tags: {} }, "local");
  await tick();
  await tick();
  const rows = () => qa<HTMLTableRowElement>(document, "#tag-rows tr");
  assert.ok(
    rows().every((row) => row.draggable),
    "rows are drag handles",
  );
  must(rows()[0]).dispatchEvent(new window.Event("dragstart", { bubbles: true }));
  must(rows()[2]).dispatchEvent(new window.Event("dragover", { bubbles: true, cancelable: true }));
  assert.ok(must(rows()[2]).classList.contains("drop-target"), "target row highlighted");
  must(rows()[2]).dispatchEvent(new window.Event("drop", { bubbles: true, cancelable: true }));
  await tick();
  await tick();
  assert.deepEqual(
    stored.tags.map((tag) => tag.id),
    ["tb", "tc", "ta"],
    "dragged down: lands after the target",
  );
  await chrome.storage.onChanged.fire({ tags: {} }, "local");
  await tick();
  await tick();
  assert.deepEqual(
    rows().map((row) => q(row, ".tag-name").textContent),
    ["beta", "gamma", "alpha"],
  );
  must(rows()[2]).dispatchEvent(new window.Event("dragstart", { bubbles: true }));
  must(rows()[0]).dispatchEvent(new window.Event("dragover", { bubbles: true, cancelable: true }));
  must(rows()[0]).dispatchEvent(new window.Event("drop", { bubbles: true, cancelable: true }));
  await tick();
  await tick();
  assert.deepEqual(
    stored.tags.map((tag) => tag.id),
    ["ta", "tb", "tc"],
    "dragged up: lands before the target",
  );
  stored.tags = [];
});

test("UI - Options - TAGS: a switched-off tag shows struck through on its pages and is not offered in the picker", async () => {
  const { applyExperimental, featureEnabled } = await import("../../../src/app/core.ts");
  if (!featureEnabled(applyExperimental(RAW_FEATURES, stored.ui?.showExperimental ?? false), "TAGS")) {
    return;
  }
  stored.tags = [
    { id: "ta", name: "alpha", color: "blue" },
    { id: "tb", name: "beta", color: "red", disabled: true },
  ];
  stored.tagPages = [{ url: "https://p.test/", tagIds: ["ta", "tb"] }];
  stored.tagTrash = [];
  await chrome.storage.onChanged.fire({ tags: {} }, "local");
  await tick();
  await tick();
  const row = must(qa<HTMLTableRowElement>(document, "#tag-page-rows tr")[0]);
  const chips = qa<HTMLElement>(row, ".tag-chip");
  assert.deepEqual(
    chips.map((chip) => `${q(chip, ".tag-chip-name").textContent}:${chip.classList.contains("off")}`),
    ["alpha:false", "beta:true"],
  );
  q(row, ".tag-pick-btn").click();
  await tick();
  assert.deepEqual(
    qa(byId("tag-page-pick"), ".tag-pick .tag-name").map((el) => el.textContent),
    ["alpha"],
    "the picker lists enabled tags only",
  );
  stored.tags = [];
  stored.tagPages = [];
});

test("UI - Options - TAGS: click Color / Tag / Pages headers to sort the table (asc, desc, stored order); no drag while sorted", async () => {
  const { applyExperimental, featureEnabled } = await import("../../../src/app/core.ts");
  if (!featureEnabled(applyExperimental(RAW_FEATURES, stored.ui?.showExperimental ?? false), "TAGS")) {
    return;
  }
  stored.tags = [
    { id: "ta", name: "work", color: "blue" },
    { id: "tb", name: "Alpha", color: "red" },
    { id: "tc", name: "bills", color: "grey" },
  ];
  stored.tagPages = [
    { url: "https://a.test/", tagIds: ["ta", "tc"] },
    { url: "https://b.test/", tagIds: ["tc"] },
  ];
  await chrome.storage.onChanged.fire({ tags: {} }, "local");
  await tick();
  await tick();
  const names = () => qa(document, "#tag-rows .tag-name").map((el) => el.textContent);
  const header = (key: string) => q<HTMLElement>(document, `#tag-table th[data-sort="${key}"]`);
  assert.deepEqual(names(), ["work", "Alpha", "bills"]);
  assert.ok(header("name").title.length > 0, "the header says it sorts");
  assert.equal(header("stored").dataset.dir, "asc", "# marks the stored order while no column sorts");
  header("name").click();
  await tick();
  await tick();
  assert.deepEqual(names(), ["Alpha", "bills", "work"]);
  assert.equal(header("name").dataset.dir, "asc");
  assert.equal(header("stored").dataset.dir, undefined);
  assert.deepEqual(stored.ui.tagSort, { key: "name", dir: "asc" }, "the sort is saved");
  assert.ok(
    qa<HTMLTableRowElement>(document, "#tag-rows tr").every((row) => !row.draggable),
    "no drag in a sorted view",
  );
  // Tags order in pickers: stored by default; "Sorted table" and "Most used" reorder every picker list
  const dropdown = () => qa<HTMLOptionElement>(byId("new-tag-page-tag"), "option").map((option) => option.textContent);
  assert.deepEqual(dropdown(), ["work", "Alpha", "bills"], "pickers keep the stored order by default");
  const pickOrder = byId<HTMLSelectElement>("tagPickOrder");
  assert.equal(pickOrder.value, "stored");
  const setPickOrder = async (value: string) => {
    pickOrder.value = value;
    pickOrder.dispatchEvent(new window.Event("change", { bubbles: true }));
    await tick();
    await tick();
    await chrome.storage.onChanged.fire({ ui: {} }, "local");
    await tick();
    await tick();
  };
  await setPickOrder("table");
  assert.equal(stored.ui.tagPickOrder, "table");
  assert.deepEqual(dropdown(), ["Alpha", "bills", "work"], "the Add-page dropdown follows the table sort");
  await setPickOrder("used");
  assert.deepEqual(dropdown(), ["bills", "work", "Alpha"], "most used first (2, 1, 0 pages)");
  await setPickOrder("name");
  assert.deepEqual(dropdown(), ["Alpha", "bills", "work"]);
  await setPickOrder("stored");
  assert.deepEqual(dropdown(), ["work", "Alpha", "bills"]);
  header("name").click();
  await tick();
  assert.deepEqual(names(), ["work", "bills", "Alpha"]);
  assert.equal(header("name").dataset.dir, "desc");
  header("pages").click();
  await tick();
  assert.deepEqual(names(), ["Alpha", "work", "bills"], "another header starts ascending");
  assert.equal(header("name").dataset.dir, undefined, "only one header carries the arrow");
  header("pages").click();
  await tick();
  await tick();
  header("pages").click();
  await tick();
  await tick();
  assert.deepEqual(names(), ["work", "Alpha", "bills"], "third click: stored order again");
  assert.equal(stored.ui.tagSort, undefined, "no sort = the key is absent");
  assert.ok(
    qa<HTMLTableRowElement>(document, "#tag-rows tr").every((row) => row.draggable),
    "drag is back",
  );
  // the # header is the one-click way back
  header("color").click();
  await tick();
  await tick();
  assert.deepEqual(names(), ["bills", "work", "Alpha"], "palette order: grey, blue, red");
  header("stored").click();
  await tick();
  await tick();
  assert.deepEqual(names(), ["work", "Alpha", "bills"]);
  assert.equal(header("stored").dataset.dir, "asc");
  stored.tags = [];
  stored.tagPages = [];
});
