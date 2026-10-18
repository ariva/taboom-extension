import type { Scene } from "./index.ts";

export const tour: Scene = {
  id: "tour",
  settings: "#page-title",
  title: "Every window, every tab, one panel",
  gif: [0, 6],
  async run(stage) {
    await stage.caption("Taboom — 10 windows, 500 tabs, one side panel", 1800);
    await stage.hover(stage.panel.locator("#search")); // off the window header: no hover tip in the still
    await stage.still("panel-overview");
    await stage.scrollList(900);
    await stage.scrollList(900);
    await stage.caption("Each window is a group with its name and color; snoozed tabs are dimmed", 1600);
    await stage.scrollList(-1800);
    const row = stage.row("Invoice");
    await stage.hover(row);
    await stage.caption("Hover a row: the full address, its states and tags", 1800);
    await stage.still("row-hover-tip");
    await stage.hover(stage.panel.locator("#search"));
    await stage.caption("", 300);
  },
};
