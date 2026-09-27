// Quick-launch (windows popover) behaviours that only a real browser can judge.
// Each of these was a shipped bug that the happy-dom tier could not see.
import { expect, test } from "vitest";
import { userEvent } from "vitest/browser";
import { byText, mountSidePanel, popoverOpen, settle } from "./mount.ts";

const panel = await mountSidePanel();

async function openGroupsView() {
  if (!popoverOpen()) {
    await userEvent.click(document.getElementById("win-list-btn") as HTMLElement);
  }
  await userEvent.click(byText("#windows-pop .win-view", "Groups"));
}

async function startNewGroup(name: string) {
  await userEvent.click(document.querySelector(".win-row.win-new") as HTMLElement);
  await userEvent.keyboard(name);
  panel.calls.length = 0;
}

const created = () => panel.calls.filter((call) => /^tabs\.(create|group)/.test(call));
const navigated = () => panel.calls.filter((call) => /^windows\.update|"active":true/.test(call));

test("Enter commits a new group and the popover stays open", async () => {
  await openGroupsView();
  await startNewGroup("reading");
  await userEvent.keyboard("{Enter}");
  await settle();
  expect(created()).toEqual(['tabs.create {"windowId":1,"active":false}', "tabs.group 1000 new"]);
  expect(popoverOpen()).toBe(true);
});

test("clicking a group row to commit only commits: no navigation, popover stays open", async () => {
  // a real chrome.tabs.create is not instant: the click is released BEFORE the popover
  // refills, so it lands on the live row — the mock's instant answer would hide the bug
  const instantCreate = panel.chrome.tabs.create;
  panel.chrome.tabs.create = async (options) => {
    await settle(300);
    return instantCreate(options);
  };
  await openGroupsView();
  await startNewGroup("later");
  await userEvent.click(document.querySelector('.win-row[data-tab-group-id="7"]') as HTMLElement);
  await settle(700);
  panel.chrome.tabs.create = instantCreate;
  expect(created().length).toBe(2);
  expect(navigated()).toEqual([]);
  expect(popoverOpen()).toBe(true);
});

test("clicking near the popover's bottom edge to commit does not read as a click-away", async () => {
  await openGroupsView();
  await startNewGroup("edge");
  const pop = document.getElementById("windows-pop") as HTMLElement;
  const box = pop.getBoundingClientRect();
  // the popover shrinks once the input is gone — this spot ends up outside it on release
  await userEvent.click(pop, { position: { x: box.width / 2, y: box.height - 3 } });
  await settle();
  expect(created().length).toBe(2);
  expect(popoverOpen()).toBe(true);
});

test("switching view mid-edit cancels the edit, switches, and keeps the popover open", async () => {
  await openGroupsView();
  await startNewGroup("nope");
  await userEvent.click(byText("#windows-pop .win-view", "Pins"));
  await settle();
  expect(created()).toEqual([]);
  expect(document.querySelector(".rename-input")).toBeNull();
  expect(document.querySelector("#windows-pop .win-view.on")?.textContent).toMatch(/^Pins/);
  expect(popoverOpen()).toBe(true);
  // nothing left armed: the next click works normally
  await userEvent.click(byText("#windows-pop .win-view", "Windows"));
  expect(document.querySelector("#windows-pop .win-view.on")?.textContent).toMatch(/^Windows/);
});

test("Esc in an in-list rename cancels the rename, not the popover", async () => {
  await openGroupsView();
  await startNewGroup("typo");
  await userEvent.keyboard("{Escape}");
  await settle();
  expect(created()).toEqual([]);
  expect(popoverOpen()).toBe(true);
});

test("dragging a group row onto another reorders the list and saves the order by title", async () => {
  await openGroupsView();
  const titles = () =>
    [...document.querySelectorAll("#windows-pop .win-row[data-tab-group-id] .win-title")].map((el) => el.textContent);
  expect(titles()).toEqual(["alpha", "work"]); // ABC until the user reorders
  await userEvent.dragAndDrop(
    document.querySelector('.win-row[data-tab-group-id="8"]') as HTMLElement,
    document.querySelector('.win-row[data-tab-group-id="7"]') as HTMLElement,
  );
  await settle();
  expect(titles()).toEqual(["work", "alpha"]); // dragged down: lands after the target
  expect(
    panel.calls.some(
      (call) => call.startsWith("storage.set") && call.includes('"quickLaunchGroupOrder":["work","alpha"]'),
    ),
  ).toBe(true);
  expect(popoverOpen()).toBe(true);
});
