import type { Scene } from "./index.ts";

// the Settings page is the pane right of the panel the whole time: this scene walks its
// sections there and flips the theme, which the panel follows live
export const settings: Scene = {
  id: "settings",
  title: "Settings",
  settings: "#page-title",
  async run(stage) {
    await stage.caption("Settings: look, automatic snooze, protected sites, keep-alive marks, tags", 1400);
    await stage.caption("Font size, density and theme — the panel follows at once", 600);
    await stage.settings("#theme");
    await stage.settingsSelect("#theme", "dark");
    await stage.pause(1600);
    await stage.still("settings-interface-dark", "settings");
    await stage.still("panel-dark-theme");
    await stage.settingsSelect("#theme", "light");
    await stage.pause(900);
    await stage.caption("Automatic snooze: how long a tab may idle, what is never touched", 600);
    await stage.settings("#autoSnoozeEnabled");
    await stage.pause(1400);
    await stage.still("settings-auto-snooze", "settings");
    await stage.caption("Sorting, window names, update behaviour, experimental features", 600);
    await stage.settings("#groupByWindowTabsOrder");
    await stage.pause(1400);
    await stage.caption("Protected sites: patterns that are never auto-snoozed", 600);
    await stage.settings("#rules");
    await stage.pause(1400);
    await stage.still("settings-protected-sites", "settings");
    await stage.caption("Keep-alive marks reload a page on a timer", 600);
    await stage.settings("#keep-alive-section");
    await stage.pause(1400);
    await stage.still("settings-keep-alive", "settings");
    await stage.caption("Tags and tagged pages, editable in place", 600);
    await stage.settings("#tags-section");
    await stage.pause(1600);
    await stage.still("settings-tags", "settings");
    await stage.caption("Every table edits in place; removals can be undone", 600);
    await stage.settings("#danger");
    await stage.pause(1400);
    await stage.settings("#page-title");
    await stage.caption("", 300);
  },
};
