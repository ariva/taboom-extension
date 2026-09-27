// The generic <dialog>-based prompt, driven through its real entry point
// (row menu ▸ Move to group ▸ New group…): focus, Enter, Esc and backdrop are browser behaviour.
import { expect, test } from "vitest";
import { userEvent } from "vitest/browser";
import { byText, mountSidePanel, settle } from "./mount.ts";

const panel = await mountSidePanel();
const dialog = () => document.getElementById("ask-dialog") as HTMLDialogElement;
const grouped = () => panel.calls.filter((call) => /^(tabs\.group|tabGroups\.update)/.test(call));

async function openNewGroupDialog() {
  panel.calls.length = 0;
  await userEvent.click(document.querySelector('.row[data-tab-id="1"]') as HTMLElement, { button: "right" });
  await userEvent.click(byText("#ctx-menu .ctx-item", "Move to group"));
  await userEvent.click(byText("#ctx-menu .ctx-item", "New group"));
  expect(dialog().open).toBe(true);
}

test("opens modal with the input focused; Enter confirms", async () => {
  await openNewGroupDialog();
  expect(document.activeElement).toBe(dialog().querySelector(".ask-input"));
  await userEvent.keyboard("reading{Enter}");
  await settle();
  expect(dialog().open).toBe(false);
  expect(grouped()).toEqual(["tabs.group 1 new", 'tabGroups.update 900 {"title":"reading"}']);
});

test("Esc closes it and nothing is grouped", async () => {
  await openNewGroupDialog();
  await userEvent.keyboard("nope{Escape}");
  await settle();
  expect(dialog().open).toBe(false);
  expect(grouped()).toEqual([]);
});

test("a click on the backdrop cancels", async () => {
  await openNewGroupDialog();
  // the backdrop belongs to the dialog element: a click outside its box lands on it
  await userEvent.click(dialog(), { position: { x: -40, y: -40 }, force: true });
  await settle();
  expect(dialog().open).toBe(false);
  expect(grouped()).toEqual([]);
});
