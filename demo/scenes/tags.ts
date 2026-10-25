import type { Scene } from "./index.ts";

export const tags: Scene = {
  id: "tags",
  settings: "#tags-section",
  title: "New: custom tags",
  newIn: "1.0.5",
  covers: /tag/i,
  gif: [0, 8],
  async run(stage) {
    await stage.caption("New in 1.0.5 — tag any page with your own colored labels", 1800);
    const row = stage.awakeRow("Roadmap 2027");
    await stage.click(row, { button: "right" });
    await stage.pause(400);
    await stage.click(stage.menuItem("Tag URL…"));
    await stage.pause(500);
    const ticks = stage.panel.locator("#tag-assign-pop .tag-pick input");
    await stage.click(ticks.nth(0));
    await stage.click(ticks.nth(2));
    await stage.caption("Tick as many as you like, then Apply", 900);
    await stage.still("tags-assign-popover");
    await stage.click(stage.panel.locator("#tag-assign-pop .tag-pick-actions button", { hasText: "Apply" }));
    await stage.pause(900);
    await stage.hover(row);
    await stage.caption("Tags show as pills on the row and in the hover tip", 1600);
    await stage.still("tags-row-pills");
    await stage.caption("Group by tag: one header per tag", 900);
    await stage.select("#sort", "group-tag");
    await stage.scrollList(300);
    await stage.pause(1200);
    await stage.still("tags-group-by-tag");
    await stage.scrollList(-300);
    await stage.select("#sort", "window");
    await stage.caption("", 300);
  },
};
