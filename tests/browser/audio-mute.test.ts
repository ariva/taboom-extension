// TAB_AUDIO: the 🔊 is a control inside a row that itself activates its tab on click. Only a real
// click says that the press lands on the icon, mutes, and does not reach the row's own activation;
// only a real layout says the toggle's padding leaves the row as tall as a silent one.
import { expect, test } from "vitest";
import { userEvent } from "vitest/browser";
import { DEFAULT_FIXTURE, mountSidePanel } from "./mount.ts";

const fixture = structuredClone(DEFAULT_FIXTURE);
for (const tab of fixture.tabs ?? []) {
  if (tab.id === 2) {
    tab.audible = true;
  }
}
const { calls } = await mountSidePanel(fixture);

const icon = () => document.querySelector('.row[data-tab-id="2"] .audio') as HTMLElement;
const height = (id: number) =>
  (document.querySelector(`.row[data-tab-id="${id}"]`) as HTMLElement).getBoundingClientRect().height;

test("a click on the 🔊 mutes the tab, turns the icon into 🔇 and does not activate the row", async () => {
  expect(icon().dataset.action).toBe("toggle-mute");
  expect(height(2)).toBeCloseTo(height(3), 1);
  calls.length = 0;
  await userEvent.click(icon());
  await expect.poll(() => icon().textContent).toBe("🔇");
  expect(calls).toContain('tabs.update 2 {"muted":true}');
  expect(calls.some((call) => call.includes('"active":true'))).toBe(false);
  expect(height(2)).toBeCloseTo(height(3), 1);

  await userEvent.click(icon());
  await expect.poll(() => icon().textContent).toBe("🔊");
  expect(calls).toContain('tabs.update 2 {"muted":false}');
});

test("the 🔊 chip is in the filter bar while a tab plays, and a click on it leaves only that tab", async () => {
  const chip = document.querySelector('#filters button[data-filter="audio"]') as HTMLElement;
  expect(chip.getBoundingClientRect().width).toBeGreaterThan(0);
  await userEvent.click(chip);
  // the filter change re-renders inside a view transition: the new list is there a frame later
  await expect
    .poll(() => [...document.querySelectorAll<HTMLElement>(".row")].map((row) => row.dataset.tabId))
    .toEqual(["2"]);
  await userEvent.click(document.querySelector('#filters button[data-filter="all"]') as HTMLElement);
});
