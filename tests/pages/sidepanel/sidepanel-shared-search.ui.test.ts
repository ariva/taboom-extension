import assert from "node:assert/strict";
import { test } from "vitest";
import type { ChromeMockOptions } from "../../helpers/chrome-mock.ts";
import { byId } from "../../helpers/dom.ts";
import { loadPage, makeChrome, TEST_FEATURES, tick } from "../../helpers/ui.ts";

const TAGS_ON = TEST_FEATURES.TAGS?.enabled === true;

// with the shared view (ui.panelView, Settings → Customizations toggle) the search text of one open
// panel reaches the others through storage.session.sharedSearch; an independent view shares nothing
const NOW = Date.now();
const tabs: ChromeMockOptions["tabs"] = [
  { id: 1, windowId: 1, active: true, discarded: false, url: "https://a.com/", title: "Alpha", lastAccessed: NOW },
  {
    id: 2,
    windowId: 1,
    active: false,
    discarded: false,
    url: "https://b.com/",
    title: "Beta",
    lastAccessed: NOW - 1000,
  },
  {
    id: 3,
    windowId: 1,
    active: false,
    discarded: false,
    url: "https://c.com/",
    title: "Gamma",
    lastAccessed: NOW - 2000,
  },
];

const calls: string[] = [];
const chrome = makeChrome({
  tabs,
  calls,
  // the defaults: shared view, shared search; two tags for the Tags chip
  stored: {
    tags: [
      { id: "t1", name: "work", color: "blue" },
      { id: "t2", name: "fun", color: "red" },
    ],
    tagPages: [
      { url: "https://a.com/", tagIds: ["t1"] },
      { url: "https://b.com/", tagIds: ["t2"] },
    ],
  },
});
// another panel typed and ticked these before this one opened
await chrome.storage.session.set({ sharedSearch: "beta", sharedTagFilter: ["t2"] });
calls.length = 0;
loadPage("src/pages/sidepanel/index.html", chrome);
await import("../../../src/pages/sidepanel/main.ts");
await tick();
await tick();

const search = () => byId<HTMLInputElement>("search");
const rows = () => Array.from(document.querySelectorAll(".row .title")).map((el) => el.textContent);
const published = () => calls.filter((call) => call.startsWith("storage.session.set") && call.includes("sharedSearch"));
const type = (text: string) => {
  search().value = text;
  search().dispatchEvent(new window.Event("input", { bubbles: true }));
};
const settle = () => new Promise((resolve) => setTimeout(resolve, 350)); // past the publish debounce (300 ms)
const refreshed = () => new Promise((resolve) => setTimeout(resolve, 200)); // past the refresh debounce

test("UI - Sidepanel Shared search - a new panel opens with the text another panel typed", () => {
  assert.equal(search().value, "beta");
  assert.deepEqual(rows(), ["Beta"]);
  assert.deepEqual(published(), [], "adopting the stored text writes nothing back");
});

test("UI - Sidepanel Shared search - typing publishes the text once the keystrokes settle; the echo is not written again", async () => {
  type("gam");
  type("gamma");
  assert.deepEqual(published(), [], "not before the debounce");
  await settle();
  assert.deepEqual(published(), ['storage.session.set {"sharedSearch":"gamma"}'], "the settled text, once");
  await chrome.storage.onChanged.fire({ sharedSearch: { newValue: "gamma" } }, "session"); // the own write echoing back
  await settle();
  assert.equal(published().length, 1, "an echo is not published again");
  assert.deepEqual(rows(), ["Gamma"]);
});

// T-0149: the echo of an earlier keystroke's write must not undo what was typed since
test("UI - Sidepanel Shared search - the echo of an earlier write leaves the newer keystrokes alone", async () => {
  calls.length = 0;
  type("b");
  await settle(); // "b" written
  type("be"); // typed before the echo of "b" lands
  await chrome.storage.onChanged.fire({ sharedSearch: { newValue: "b" } }, "session");
  assert.equal(search().value, "be", "the own echo does not reset the box");
  await settle();
  assert.deepEqual(published(), [
    'storage.session.set {"sharedSearch":"b"}',
    'storage.session.set {"sharedSearch":"be"}',
  ]);
  await chrome.storage.onChanged.fire({ sharedSearch: { newValue: "be" } }, "session");
  assert.equal(search().value, "be");
});

test("UI - Sidepanel Shared search - two own writes echoing late, in order, are both recognised", async () => {
  calls.length = 0;
  type("g");
  await settle();
  type("ga");
  await settle(); // both written, neither echoed yet (a busy browser delivers echoes late)
  type("gam"); // waiting for its own write
  await chrome.storage.onChanged.fire({ sharedSearch: { newValue: "g" } }, "session");
  await chrome.storage.onChanged.fire({ sharedSearch: { newValue: "ga" } }, "session");
  assert.equal(search().value, "gam", "late echoes of own writes are not foreign text");
  await settle();
  assert.deepEqual(published().at(-1), 'storage.session.set {"sharedSearch":"gam"}');
  await chrome.storage.onChanged.fire({ sharedSearch: { newValue: "gam" } }, "session");
  assert.deepEqual(rows(), ["Gamma"]);
});

test("UI - Sidepanel Shared search - another panel's text fills the box and filters the list, and is not written back", async () => {
  calls.length = 0;
  await chrome.storage.onChanged.fire({ sharedSearch: { newValue: "alpha" } }, "session");
  assert.equal(search().value, "alpha");
  assert.deepEqual(rows(), ["Alpha"]);
  await settle();
  assert.deepEqual(published(), [], "a foreign text is adopted, not re-published");
});

test("UI - Sidepanel Shared search - Escape clears the shared text for every panel", async () => {
  calls.length = 0;
  document.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  assert.equal(search().value, "");
  await settle();
  assert.deepEqual(published(), ['storage.session.set {"sharedSearch":""}']);
});

test("UI - Sidepanel Shared search - an independent panel view shares nothing", async () => {
  const { ui } = await chrome.storage.local.get("ui");
  const independent = { ...ui, panelView: "independent" };
  await chrome.storage.local.set({ ui: independent });
  await chrome.storage.onChanged.fire({ ui: { oldValue: ui, newValue: independent } }, "local");
  await refreshed(); // the panel takes the new ui on its debounced refresh
  calls.length = 0;
  await chrome.storage.onChanged.fire({ sharedSearch: { newValue: "beta" } }, "session");
  assert.equal(search().value, "", "a foreign text is ignored");
  type("gamma");
  await settle();
  assert.deepEqual(published(), [], "own typing stays in this panel");
  await chrome.storage.local.set({ ui });
  await chrome.storage.onChanged.fire({ ui: { oldValue: independent, newValue: ui } }, "local");
  await refreshed();
  document.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  await settle();
});

// the Tags chip's ticks are a filter too: with the shared view they travel like the search
const tagBoxes = () =>
  Array.from(document.querySelectorAll<HTMLInputElement>("#tags-pop .tag-pick input")).map((box) => [
    box.closest(".tag-pick")?.querySelector(".tag-name")?.textContent,
    box.checked,
  ]);
const openTagsPicker = () => document.querySelector<HTMLElement>('#filters button[data-filter="tags"]')?.click();
const tagPublished = () =>
  calls.filter((call) => call.startsWith("storage.session.set") && call.includes("sharedTagFilter"));

test("UI - Sidepanel Shared search - the ticked tags another panel chose are ticked here at boot", {
  skip: !TAGS_ON,
}, () => {
  calls.length = 0;
  openTagsPicker();
  assert.deepEqual(tagBoxes(), [
    ["work", false],
    ["fun", true],
  ]);
  assert.deepEqual(tagPublished(), [], "adopting the stored ticks writes nothing back");
});

test("UI - Sidepanel Shared search - a tick publishes the tag set; the echo is not written again", {
  skip: !TAGS_ON,
}, async () => {
  calls.length = 0;
  const work = document.querySelector<HTMLInputElement>("#tags-pop .tag-pick input");
  assert.ok(work);
  work.checked = true;
  work.dispatchEvent(new window.Event("change", { bubbles: true }));
  assert.deepEqual(tagPublished(), ['storage.session.set {"sharedTagFilter":["t2","t1"]}']);
  await chrome.storage.onChanged.fire({ sharedTagFilter: { newValue: ["t2", "t1"] } }, "session");
  assert.equal(tagPublished().length, 1, "an echo is not published again");
});

test("UI - Sidepanel Shared search - another panel's ticks narrow this list and are not written back", {
  skip: !TAGS_ON,
}, async () => {
  calls.length = 0;
  await chrome.storage.onChanged.fire({ sharedTagFilter: { newValue: ["t1"] } }, "session");
  assert.deepEqual(rows(), ["Alpha"], "the Tags filter is on: only the work-tagged tab stays");
  openTagsPicker(); // happy-dom never reports the popover open, so the render's refill is skipped: refill by hand
  assert.deepEqual(
    tagBoxes(),
    [
      ["work", true],
      ["fun", false],
    ],
    "an open picker follows",
  );
  assert.deepEqual(tagPublished(), []);
});

test("UI - Sidepanel Shared search - Reset selection clears the ticks for every panel", { skip: !TAGS_ON }, () => {
  calls.length = 0;
  document.querySelector<HTMLButtonElement>("#tags-pop .tag-pick-clear")?.click();
  assert.deepEqual(tagPublished(), ['storage.session.set {"sharedTagFilter":[]}']);
  assert.deepEqual(rows(), ["Alpha", "Beta"], "no ticks = any tagged tab");
});
