// TAGS surfaces only a real browser can judge: the New tag… dialog's swatches and focus, and
// the Tags chip's picker — a light-dismiss popover opened by the same click that sets the filter.
import { expect, test } from "vitest";
import { userEvent } from "vitest/browser";
import { byText, DEFAULT_FIXTURE, mountSidePanel, settle } from "./mount.ts";

// the flag ships experimental: the opt-in turns it on
await mountSidePanel({ ...DEFAULT_FIXTURE, stored: { ui: { showExperimental: true } } });
const picker = () => document.getElementById("tags-pop") as HTMLElement;
const pickerOpen = () => picker().matches(":popover-open");
const dialog = () => document.getElementById("ask-dialog") as HTMLDialogElement;
const shown = () => [...document.querySelectorAll<HTMLElement>(".row")].map((row) => row.dataset.tabId);

test("New tag…: the input is focused, a swatch click picks the color, Enter adds the tag to the row", async () => {
  await userEvent.click(document.querySelector('.row[data-tab-id="1"]') as HTMLElement, { button: "right" });
  const menuRect = (document.getElementById("ctx-menu") as HTMLElement).getBoundingClientRect();
  await userEvent.click(byText("#ctx-menu .ctx-item", "New tag…"));
  expect(dialog().open).toBe(true);
  expect(document.activeElement).toBe(dialog().querySelector(".ask-input"));
  const dialogRect = dialog().getBoundingClientRect();
  expect(Math.abs(dialogRect.top - menuRect.top) < menuRect.height + 80).toBe(true); // near the menu, not under the toolbar
  await userEvent.click(dialog().querySelector('.ask-swatch[data-color="green"]') as HTMLElement);
  expect(dialog().querySelector('.ask-swatch[aria-pressed="true"]')?.getAttribute("data-color")).toBe("green");
  await userEvent.click(dialog().querySelector(".ask-input") as HTMLElement);
  await userEvent.keyboard("work{Enter}");
  await settle();
  expect(dialog().open).toBe(false);
  const badge = document.querySelector('.row[data-tab-id="1"] .badge.tag') as HTMLElement;
  expect(badge.textContent).toBe("work");
  expect(getComputedStyle(badge).backgroundColor).toBe("rgb(24, 128, 56)");
});

test("the Tags chip sets the filter and opens its picker; a tick keeps it open; Esc closes it, the filter stays", async () => {
  const chip = document.querySelector('#filters button[data-filter="tags"]') as HTMLElement;
  await userEvent.click(chip);
  await settle();
  expect(pickerOpen()).toBe(true);
  expect(chip.getAttribute("aria-pressed")).toBe("true");
  expect(shown()).toEqual(["1"]);
  await userEvent.click(picker().querySelector(".tag-pick input") as HTMLElement);
  await settle();
  expect(pickerOpen()).toBe(true);
  expect(chip.querySelector(".chip-label")?.textContent).toBe("work");
  expect(picker().querySelector(".tag-pick-clear")).not.toBeNull();
  await userEvent.keyboard("{Escape}");
  await settle();
  expect(pickerOpen()).toBe(false);
  expect(chip.getAttribute("aria-pressed")).toBe("true");
  expect(shown()).toEqual(["1"]);
});

test("a second click on the Tags chip closes the picker (toggle), the filter stays", async () => {
  const chip = document.querySelector('#filters button[data-filter="tags"]') as HTMLElement;
  if (!pickerOpen()) {
    await userEvent.click(chip);
    await settle();
  }
  expect(pickerOpen()).toBe(true);
  await userEvent.click(chip);
  await settle();
  expect(pickerOpen()).toBe(false);
  expect(chip.getAttribute("aria-pressed")).toBe("true");
  await userEvent.click(chip);
  await settle();
  expect(pickerOpen()).toBe(true);
  await userEvent.keyboard("{Escape}");
  await settle();
});

test("a click outside closes the Tags… picker and the New tag dialog, like the context menu", async () => {
  const assign = () => document.getElementById("tag-assign-pop") as HTMLElement;
  const dialog = () => document.getElementById("ask-dialog") as HTMLDialogElement;
  await userEvent.click(document.querySelector('#filters button[data-filter="all"]') as HTMLElement);
  await settle();
  await userEvent.click(document.querySelector('.row[data-tab-id="1"]') as HTMLElement, { button: "right" });
  await userEvent.click(byText("#ctx-menu .ctx-item", "Tags…"));
  await settle();
  expect(assign().matches(":popover-open")).toBe(true);
  const menu = document.getElementById("ctx-menu") as HTMLElement;
  expect(menu.hidden).toBe(true);
  // a tick is staged: the picker stays, nothing is written until Apply
  await userEvent.click(assign().querySelector(".tag-pick input") as HTMLElement);
  await settle();
  expect(assign().matches(":popover-open")).toBe(true);
  await userEvent.click(assign().querySelector(".tag-pick-close") as HTMLElement); // ✕ = cancel
  await settle();
  expect(assign().matches(":popover-open")).toBe(false);
  expect(menu.hidden).toBe(false); // the row menu is back
  await userEvent.keyboard("{Escape}");
  await settle();
  expect(document.querySelector('.row[data-tab-id="1"] .badge.tag')?.textContent).toBe("work");
  expect(document.querySelectorAll('.row[data-tab-id="1"] .badge.tag').length).toBe(1);
  await userEvent.click(document.querySelector('.row[data-tab-id="1"]') as HTMLElement, { button: "right" });
  await userEvent.click(byText("#ctx-menu .ctx-item", "Tags…"));
  await settle();
  await userEvent.click(document.body, { position: { x: 5, y: 5 } }); // the header under the picker takes no pointer events: the click lands on the body
  await settle();
  expect(assign().matches(":popover-open")).toBe(false);
  expect(dialog().open).toBe(false); // no ticks pending: no question
  // a pending tick + a click outside: the panel's dialog asks; Apply writes it
  await userEvent.click(document.querySelector('.row[data-tab-id="1"]') as HTMLElement, { button: "right" });
  await userEvent.click(byText("#ctx-menu .ctx-item", "Tags…"));
  await settle();
  await userEvent.click(assign().querySelector(".tag-pick input") as HTMLElement); // untick "work"
  await userEvent.click(document.body, { position: { x: 5, y: 5 } }); // the header under the picker takes no pointer events: the click lands on the body
  await settle();
  expect(assign().matches(":popover-open")).toBe(false);
  expect(dialog().open).toBe(true);
  expect(dialog().querySelector(".ask-message")?.textContent).toBe("Apply the tag change?");
  expect(dialog().getBoundingClientRect().top > 150).toBe(true); // by the row, not under the toolbar
  await userEvent.click(dialog().querySelector(".ask-ok") as HTMLElement);
  await settle();
  expect(document.querySelector('.row[data-tab-id="1"] .badge.tag')).toBeNull();
  // Esc with a pending tick: no question, nothing written
  await userEvent.click(document.querySelector('.row[data-tab-id="1"]') as HTMLElement, { button: "right" });
  await userEvent.click(byText("#ctx-menu .ctx-item", "Tags…"));
  await settle();
  await userEvent.click(assign().querySelector(".tag-pick input") as HTMLElement); // tick "work" again
  await userEvent.keyboard("{Escape}");
  await settle();
  expect(assign().matches(":popover-open")).toBe(false);
  expect(dialog().open).toBe(false);
  expect(document.querySelector('.row[data-tab-id="1"] .badge.tag')).toBeNull();
  await userEvent.click(document.querySelector('.row[data-tab-id="1"]') as HTMLElement, { button: "right" });
  await userEvent.click(byText("#ctx-menu .ctx-item", "New tag…"));
  await settle();
  expect(dialog().open).toBe(true);
  await userEvent.click(document.body, { position: { x: 5, y: 5 } });
  await settle();
  expect(dialog().open).toBe(false);
});
