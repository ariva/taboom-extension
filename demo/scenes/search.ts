import type { Scene } from "./index.ts";

export const search: Scene = {
  id: "search",
  settings: "#experimental_fuzzySearch",
  title: "Search across every window",
  gif: [0, 7],
  async run(stage) {
    const box = stage.panel.locator("#search");
    await stage.caption("Search matches titles, addresses and tag names", 1200);
    await stage.click(box);
    await stage.type("report");
    await stage.pause(900);
    await stage.caption("Several words must all match", 800);
    await stage.type(" sheets");
    await stage.pause(1000);
    await stage.still("search-words");
    await stage.press("Escape");
    await stage.caption("#word searches tags only", 800);
    await stage.click(box);
    await stage.type("#work");
    await stage.pause(1400);
    await stage.still("search-tag");
    await stage.press("Escape");
    await stage.caption("", 300);
  },
};

export const filters: Scene = {
  id: "filters",
  settings: "#rules",
  title: "Filters with live counts",
  async run(stage) {
    const chip = (name: string) => stage.panel.locator(`#filters button[data-filter="${name}"]`);
    await stage.caption("Awake, snoozed, protected — the counts are live", 1200);
    await stage.click(chip("snoozed"));
    await stage.pause(900);
    await stage.click(chip("protected"));
    await stage.pause(900);
    await stage.still("filters-protected");
    await stage.caption("The Tags chip opens a picker: tick one or more tags", 1000);
    await stage.click(chip("tags"));
    await stage.pause(600);
    await stage.click(stage.panel.locator("#tags-pop .tag-pick").nth(1));
    await stage.pause(1000);
    await stage.still("filters-tags-picker");
    await stage.click(stage.panel.locator("#tags-pop .tag-pick-clear"));
    await stage.press("Escape");
    await stage.click(chip("all"));
    await stage.caption("", 300);
  },
};
