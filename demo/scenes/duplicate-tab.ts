import { highlightText } from "../../src/app/release-highlights.ts";
import type { Scene } from "./index.ts";

// Duplicate tab from the row menu, by keyboard as the scenes around it: the menu of the cursor
// row, down to the item, Enter — the browser's own duplicate puts the copy beside the original
export const duplicateTab: Scene = {
  id: "duplicate-tab",
  title: "Duplicate tab from the row menu",
  feature: highlightText("1.1.1", "duplicate-tab"),
  settings: "#page-title",
  newIn: "1.1.1",
  covers: /duplicate tab/i,
  async run(stage) {
    const tabIds = () => stage.panel.evaluate(async () => (await chrome.tabs.query({})).map((tab) => tab.id ?? -1));
    await stage.caption(`${stage.release} — a copy of a tab without leaving the panel`, 1800);
    await stage.click(stage.panel.locator("#search"));
    // headers are stops too: the current window's header and tab, the next header, its first row
    for (let step = 0; step < 4; step++) {
      await stage.press("ArrowDown");
    }
    await stage.caption("A row's menu — right-click, or Shift+F10 on the cursor row", 600);
    await stage.press("Shift+F10");
    await stage.pause(600);
    const before = await tabIds();
    for (let step = 0; step < 6; step++) {
      const onDuplicate = await stage.panel.evaluate(
        () => document.activeElement?.textContent?.startsWith("Duplicate") === true,
      );
      if (onDuplicate) {
        break;
      }
      await stage.press("ArrowDown");
    }
    await stage.caption("Duplicate tab, under Copy URL — a selection's menu duplicates every ticked tab", 900);
    await stage.still("duplicate-tab-menu");
    await stage.press("Enter");
    await stage.pause(1200);
    const copies = (await tabIds()).filter((id) => !before.includes(id));
    stage.check(copies.length === 1, "duplicate-tab: Duplicate tab made no copy");
    await stage.caption("The copy opens beside the original, in the same window and group", 1800);
    // the copy goes again: the scenes after this one count on the world as it was
    await stage.panel.evaluate((ids) => chrome.tabs.remove(ids), copies);
    await stage.pause(600);
    await stage.press("Escape");
    await stage.caption("", 300);
  },
};
