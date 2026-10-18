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
  await userEvent.click(byText("#ctx-menu .ctx-item", "Tags…"));
  await userEvent.click(document.querySelector("#tag-assign-pop .tag-new") as HTMLElement);
  expect(dialog().open).toBe(true);
  expect(document.activeElement).toBe(dialog().querySelector(".ask-input"));
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
  // a tick re-renders the list; the picker stays and follows the write
  await userEvent.click(assign().querySelector(".tag-pick input") as HTMLElement);
  await settle();
  expect(assign().matches(":popover-open")).toBe(true);
  await userEvent.click(assign().querySelector(".tag-pick input") as HTMLElement); // back off
  await settle();
  await userEvent.click(assign().querySelector(".tag-pick-close") as HTMLElement);
  await settle();
  expect(assign().matches(":popover-open")).toBe(false);
  await userEvent.click(document.querySelector('.row[data-tab-id="1"]') as HTMLElement, { button: "right" });
  await userEvent.click(byText("#ctx-menu .ctx-item", "Tags…"));
  await settle();
  await userEvent.click(document.querySelector("header h1") as HTMLElement);
  await settle();
  expect(assign().matches(":popover-open")).toBe(false);
  await userEvent.click(document.querySelector('.row[data-tab-id="1"]') as HTMLElement, { button: "right" });
  await userEvent.click(byText("#ctx-menu .ctx-item", "New tag…"));
  await settle();
  expect(dialog().open).toBe(true);
  await userEvent.click(document.body, { position: { x: 5, y: 5 } });
  await settle();
  expect(dialog().open).toBe(false);
});
