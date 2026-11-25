import { highlightText } from "../../src/app/release-highlights.ts";
import type { Scene } from "./index.ts";

// a selection without the mouse: an arrow takes the keys from the search, the first stop is the
// group's header (Space ticks its tabs, Left folds, Right unfolds), Space ticks the cursor
// row, Left / Right step through the filter chips, Up from the first row goes back to the search
export const keyboardSelect: Scene = {
  id: "keyboard-select",
  title: "Select and filter from the keyboard",
  feature: highlightText("1.1.1", "keyboard-select"),
  settings: "#page-title",
  newIn: "1.1.1",
  covers: /Space|filter chips|select rows/i,
  async run(stage) {
    const ticked = () =>
      stage.panel.evaluate(() => document.querySelectorAll('.row input[type="checkbox"]:checked').length);
    const filter = () =>
      stage.panel.evaluate(() => document.querySelector('#filters button[aria-pressed="true"]')?.textContent?.trim());
    await stage.caption(`${stage.release} — tick rows and switch filters without the mouse`, 1800);
    await stage.click(stage.panel.locator("#search"));
    await stage.caption("↓ leaves the search: from here the keys belong to the list", 600);
    // the stops: the current window's header, its one tab, then the Media window's header
    await stage.press("ArrowDown");
    await stage.press("ArrowDown");
    await stage.press("ArrowDown");
    await stage.pause(500);
    const onHeader = () => stage.panel.evaluate(() => document.querySelector(".group-header.cursor") !== null);
    const rowCount = () => stage.panel.evaluate(() => document.querySelectorAll(".row").length);
    stage.check(await onHeader(), "keyboard-select: the first stop is not the group header");
    await stage.caption("A window's header is a stop too — Space ticks all its tabs", 600);
    await stage.press("Space");
    await stage.pause(800);
    stage.check((await ticked()) > 0, "keyboard-select: Space on the header ticked nothing");
    await stage.still("keyboard-select-header");
    await stage.press("Space");
    await stage.pause(500);
    stage.check((await ticked()) === 0, "keyboard-select: Space on the header did not untick");
    await stage.caption("← folds the window, → unfolds it", 600);
    const unfolded = await rowCount();
    await stage.press("ArrowLeft");
    await stage.pause(800);
    stage.check((await rowCount()) < unfolded, "keyboard-select: ← did not fold the group");
    await stage.press("ArrowRight");
    await stage.pause(700);
    stage.check((await rowCount()) === unfolded, "keyboard-select: → did not unfold the group");
    await stage.caption("Shift+F10 or . opens the window's menu", 600);
    await stage.press("Shift+F10");
    await stage.pause(900);
    const menuOpen = await stage.panel.evaluate(() => document.getElementById("ctx-menu")?.hidden === false);
    stage.check(menuOpen, "keyboard-select: Shift+F10 on the header opened no menu");
    await stage.press("Escape");
    await stage.pause(400);
    await stage.press("ArrowDown");
    await stage.pause(500);
    await stage.caption("Space ticks the cursor row — ↓ Space ↓ Space ticks a run", 600);
    await stage.press("Space");
    await stage.press("ArrowDown");
    await stage.press("Space");
    await stage.press("ArrowDown");
    await stage.press("Space");
    await stage.pause(700);
    stage.check((await ticked()) === 3, "keyboard-select: Space did not tick three rows");
    await stage.still("keyboard-select");
    await stage.caption("Space again unticks", 500);
    await stage.press("Space");
    await stage.pause(600);
    await stage.caption("→ and ← step through the filters: All, Awake, Snoozed, Protected…", 600);
    await stage.press("ArrowRight");
    await stage.pause(700);
    stage.check(!(await filter())?.startsWith("All"), "keyboard-select: → did not change the filter");
    await stage.press("ArrowRight");
    await stage.pause(700);
    await stage.press("ArrowLeft");
    await stage.pause(500);
    await stage.press("ArrowLeft");
    await stage.pause(500);
    stage.check((await filter())?.startsWith("All") === true, "keyboard-select: ← did not return to All");
    await stage.caption("↑ on the first row goes back to the search", 600);
    for (let step = 0; step < 8; step++) {
      await stage.press("ArrowUp");
    }
    await stage.pause(700);
    // the next scene starts clean: nothing ticked, no cursor
    await stage.click(stage.panel.locator("#bulk-clear"));
    await stage.press("Escape");
    await stage.caption("", 300);
  },
};
