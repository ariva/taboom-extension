import type { Scene } from "./index.ts";

const popover = (stage: Parameters<Scene["run"]>[0]) => stage.panel.locator("#windows-pop");

export const windows: Scene = {
  id: "windows",
  settings: "#windowNamesEnabled",
  title: "Windows: names, colors, pins",
  gif: [0, 8],
  async run(stage) {
    await stage.caption("Quick launch: every window with its counts", 1200);
    await stage.click(stage.panel.locator("#win-list-btn"));
    await stage.pause(700);
    await stage.still("quick-launch-windows");
    const research = popover(stage).locator(".win-row[data-window-id]", { hasText: "Research" }).first();
    await stage.hover(research);
    await stage.caption("Rename a window from its ⋯ menu", 900);
    await stage.click(research.locator("xpath=following-sibling::button[contains(@class,'win-menu-btn')][1]"));
    await stage.pause(400);
    await stage.click(stage.menuItem("Rename window…"));
    await stage.pause(300);
    await stage.type("Research · ML"); // the old name opens selected: typing replaces it (End would go to the list's last row)
    await stage.press("Enter");
    await stage.pause(800);
    stage.check(
      (await popover(stage).locator(".win-title", { hasText: "Research · ML" }).count()) > 0,
      "windows: the rename did not land",
    );
    await stage.caption("…and give it a color", 800);
    const renamed = popover(stage).locator(".win-row[data-window-id]", { hasText: "Research · ML" }).first();
    await stage.click(renamed.locator("xpath=following-sibling::button[contains(@class,'win-menu-btn')][1]"));
    await stage.pause(300);
    await stage.hover(stage.menuItem("Window color"));
    await stage.pause(500);
    await stage.still("window-color-menu");
    await stage.click(stage.panel.locator("#ctx-menu .ctx-item", { hasText: "Pink" }).first());
    await stage.pause(900);
    await stage.caption("Click a window to bring it to the front", 900);
    const shopping = popover(stage).locator(".win-row[data-window-id]", { hasText: "Shopping" }).first();
    await stage.click(shopping);
    await stage.pause(1200);
    await stage.caption("", 300);
  },
};

export const moveTab: Scene = {
  id: "move-tab",
  settings: "#page-title",
  title: "Move tabs between windows",
  async run(stage) {
    await stage.caption("Move a tab to another window from its menu", 1200);
    const row = stage.awakeRow("Noise-cancelling");
    await stage.click(row, { button: "right" });
    await stage.pause(400);
    await stage.hover(stage.menuItem("Move tab to"));
    await stage.pause(600);
    await stage.still("move-tab-menu");
    await stage.click(stage.panel.locator("#ctx-menu .ctx-item", { hasText: "Media" }).first());
    await stage.pause(1500);
    const moved = await stage.worker.evaluate(async (windowId) => {
      const tabs = await chrome.tabs.query({ windowId });
      return tabs.some((tab) => tab.title?.startsWith("Noise-cancelling"));
    }, stage.world.windowIds.get("media") ?? -1);
    stage.check(moved, "move-tab: the tab is not in the Media window");
    await stage.caption("Tick several rows and the menu moves them all", 1200);
    const rows = stage.panel.locator("#tab-list .row");
    await stage.click(rows.nth(2).locator('input[type="checkbox"]'));
    await stage.click(rows.nth(3).locator('input[type="checkbox"]'));
    await stage.pause(800);
    await stage.still("bulk-bar-selection");
    await stage.click(stage.panel.locator("#bulk-clear"));
    await stage.caption("", 300);
  },
};

export const parked: Scene = {
  id: "parked",
  settings: "#askBeforePark",
  title: "New: park a window, restore it later",
  newIn: "1.0.5",
  covers: /park/i,
  async run(stage) {
    await stage.caption("New in 1.0.5 — park a whole window: its tabs wait, closed, until you need them", 2000);
    const header = stage.panel.locator("#tab-list .group-header", { hasText: "Shopping" }).first();
    await stage.hover(header);
    await stage.click(header.locator(".group-menu-btn"));
    await stage.pause(400);
    await stage.click(stage.menuItem("Park window…"));
    await stage.pause(900);
    await stage.click(stage.panel.locator("#ask-dialog .ask-ok"));
    await stage.pause(1500);
    await stage.caption("Parked windows are a scope of their own", 1000);
    await stage.select("#scope", "parked-windows");
    await stage.pause(1500);
    await stage.still("parked-scope");
    await stage.caption("Restore brings it back with its groups, name and color", 1000);
    const parkedHeader = stage.panel.locator("#tab-list .group-header", { hasText: "Shopping" }).first();
    await stage.hover(parkedHeader);
    await stage.click(parkedHeader.locator(".group-menu-btn"));
    await stage.pause(400);
    await stage.click(stage.menuItem("Restore window"));
    await stage.pause(1200);
    const ok = stage.panel.locator("#ask-dialog .ask-ok");
    if (await ok.isVisible()) {
      await stage.click(ok);
    }
    await stage.pause(1500);
    await stage.select("#scope", "all-windows");
    await stage.caption("", 300);
  },
};
