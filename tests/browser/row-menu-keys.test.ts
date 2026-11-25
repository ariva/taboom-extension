// The row menu driven from the keyboard: where real focus goes when it opens, which element the
// arrows reach, and that a key the menu took never also acts on the list behind it.
import { expect, test } from "vitest";
import { userEvent } from "vitest/browser";
import { mountSidePanel, settle } from "./mount.ts";

const panel = await mountSidePanel();

const menu = () => document.getElementById("ctx-menu") as HTMLElement;
const search = () => document.getElementById("search") as HTMLElement;
const focused = () => document.activeElement as HTMLElement;
const cursorTitle = () => document.querySelector(".row.cursor .title")?.textContent;
const activated = () => panel.calls.filter((call) => /^windows\.update|"active":true/.test(call));

test("Shift+F10 after arrowing from the search opens the cursor row's menu, focus on its first item; Escape closes only the menu", async () => {
  await userEvent.click(search());
  await userEvent.keyboard("{ArrowDown}{ArrowDown}");
  const title = cursorTitle();
  expect(title).toBeTruthy();
  await userEvent.keyboard("{Shift>}{F10}{/Shift}");
  await settle();
  expect(menu().matches(":popover-open")).toBe(true);
  // the row's title may carry a state mark ("⏸ " on a snoozed tab) the menu's does not
  expect(title).toContain(menu().querySelector(".ctx-title")?.textContent);
  const first = focused();
  expect(first.matches("#ctx-menu > .ctx-item")).toBe(true);
  expect(first.matches(":focus-visible")).toBe(true); // the highlight the user steers by
  await userEvent.keyboard("{ArrowDown}");
  expect(focused()).not.toBe(first);
  expect(focused().matches("#ctx-menu > .ctx-item")).toBe(true);
  expect(cursorTitle()).toBe(title); // the arrow went to the menu, not to the list
  await userEvent.keyboard("{Escape}");
  expect(menu().matches(":popover-open")).toBe(false);
  expect(focused()).not.toBe(search()); // the arrows left the search: the keys stay the list's
  expect(cursorTitle()).toBe(title); // Escape closed the menu only
});

test("Right enters a submenu and Left leaves it", async () => {
  await userEvent.click(search());
  await userEvent.keyboard("{ArrowDown}{Shift>}{F10}{/Shift}");
  await settle();
  for (let step = 0; step < 30 && !focused().matches(".ctx-move"); step++) {
    await userEvent.keyboard("{ArrowDown}");
  }
  const toggle = focused();
  expect(toggle.matches(".ctx-move")).toBe(true);
  await userEvent.keyboard("{ArrowRight}");
  expect(focused().matches(".ctx-submenu .ctx-item")).toBe(true);
  expect(toggle.getAttribute("aria-expanded")).toBe("true");
  await userEvent.keyboard("{ArrowLeft}");
  expect(focused()).toBe(toggle);
  expect(toggle.getAttribute("aria-expanded")).toBe("false");
  await userEvent.keyboard("{Escape}");
});

test("Period outside a text field opens the menu; Enter runs the focused item and nothing else", async () => {
  await userEvent.click(search());
  await userEvent.keyboard("{ArrowDown}{ArrowDown}"); // the group's header, then its first row
  await userEvent.keyboard(".");
  await settle();
  expect(menu().matches(":popover-open")).toBe(true);
  panel.calls.length = 0;
  await userEvent.keyboard("{Enter}");
  await settle();
  expect(menu().matches(":popover-open")).toBe(false);
  expect(activated()).toEqual([]); // Enter was the item's, not "activate the cursor row"
  await userEvent.keyboard("{Escape}"); // whatever the item opened (a rename prompt) is not this test's
  await settle();
});

test("A period typed into the search is a character", async () => {
  await userEvent.click(search());
  await userEvent.keyboard(".");
  await settle();
  expect((search() as HTMLInputElement).value).toBe(".");
  expect(menu().matches(":popover-open")).toBe(false);
});

test("Arrows leave the search: Space ticks the cursor row once, typing stays out of the query, Left / Right step the filter, Up from the top returns", async () => {
  const field = search() as HTMLInputElement;
  field.value = "";
  field.dispatchEvent(new Event("input", { bubbles: true }));
  await settle();
  await userEvent.click(field);
  await userEvent.keyboard("{ArrowDown}{ArrowDown}");
  expect(focused()).not.toBe(field);
  const box = () => document.querySelector('.row.cursor input[type="checkbox"]') as HTMLInputElement;
  const title = cursorTitle();
  await userEvent.keyboard(" ");
  await settle();
  expect(box().checked).toBe(true);
  expect(cursorTitle()).toBe(title);
  await userEvent.keyboard("x");
  expect(field.value).toBe("");
  const pressed = () => document.querySelector('#filters button[aria-pressed="true"]')?.getAttribute("data-filter");
  await userEvent.keyboard("{ArrowRight}");
  await settle();
  expect(pressed()).toBe("awake");
  await userEvent.keyboard("{ArrowLeft}");
  await settle();
  expect(pressed()).toBe("all");
  expect(cursorTitle()).toBe(title);
  await userEvent.keyboard(" ");
  await settle();
  expect(box().checked).toBe(false);
  await userEvent.keyboard("{ArrowUp}{ArrowUp}");
  expect(focused()).toBe(field);
  expect(document.querySelector(".row.cursor")).toBeNull();
  await userEvent.keyboard("ab cd");
  expect(field.value).toBe("ab cd");
  await userEvent.keyboard("{Escape}");
});

test("The cursor on a group header: Space ticks its tabs, Left folds, Right unfolds", async () => {
  await userEvent.click(search());
  await userEvent.keyboard("{ArrowDown}");
  const header = () => document.querySelector(".group-header.cursor") as HTMLElement;
  expect(header()).toBeTruthy();
  expect(focused()).not.toBe(search());
  const rows = () => document.querySelectorAll(".row").length;
  const ticks = () => document.querySelectorAll('.row input[type="checkbox"]:checked').length;
  const before = rows();
  await userEvent.keyboard(" ");
  await settle();
  expect(ticks()).toBeGreaterThan(0);
  expect((header().querySelector(".group-select") as HTMLInputElement).checked).toBe(true);
  await userEvent.keyboard(" ");
  await settle();
  expect(ticks()).toBe(0);
  if (header().getAttribute("aria-expanded") !== null) {
    await userEvent.keyboard("{ArrowLeft}");
    await settle();
    expect(rows()).toBeLessThan(before);
    expect(header()).toBeTruthy(); // the cursor stays on the folded header
    await userEvent.keyboard("{ArrowRight}");
    await settle();
    expect(rows()).toBe(before);
  }
  await userEvent.keyboard("{ArrowUp}");
  expect(focused()).toBe(search());
});
