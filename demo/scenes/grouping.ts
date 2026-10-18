import type { Scene } from "./index.ts";

export const grouping: Scene = {
  id: "grouping",
  settings: "#groupByWindowTabsOrder",
  title: "Sort and group",
  async run(stage) {
    await stage.caption("Group by window is the default; group by domain, title, tab groups or tags", 1600);
    await stage.select("#sort", "group-domain");
    await stage.scrollList(400);
    await stage.pause(900);
    await stage.still("group-by-domain");
    await stage.scrollList(-400);
    await stage.caption("Fold them all with one click", 900);
    await stage.click(stage.panel.locator("#collapse-all"));
    await stage.pause(1200);
    await stage.click(stage.panel.locator("#collapse-all"));
    await stage.pause(600);
    await stage.caption("Tab groups from Chrome's tab strip", 900);
    await stage.select("#sort", "group-tabgroup");
    await stage.pause(1400);
    await stage.still("group-by-tabgroup");
    await stage.caption("Or a flat list, most recently used first", 900);
    await stage.select("#sort", "recent");
    await stage.pause(1200);
    await stage.still("sort-recent");
    await stage.select("#sort", "window");
    await stage.caption("", 300);
  },
};
