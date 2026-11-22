import type { Scene } from "./index.ts";

// Settings as six panes behind a tab strip: one pane at a time, the address names it — the
// scene walks the strip on the Settings page beside the panel
export const settingsTabs: Scene = {
  id: "settings-tabs",
  title: "Settings in tabs",
  settings: "#page-title",
  newIn: "1.1.0",
  covers: /tabbed panes/i,
  async run(stage) {
    await stage.caption(`${stage.release} — Settings is six tabs now, one pane at a time`, 1800);
    await stage.still("settings-tabs-general", "settings");
    await stage.caption("General: look, automatic snooze, customizations, useful links, data", 1400);
    await stage.caption("Protected sites — the patterns that are never auto-snoozed", 600);
    await stage.settings("#rules-table");
    await stage.pause(1200);
    await stage.still("settings-tabs-protected", "settings");
    await stage.caption("Keep alive — the marks that reload a page on a timer", 600);
    await stage.settings("#keep-alive-section");
    await stage.pause(1200);
    await stage.caption("Tags, Tab names — each list in a pane of its own", 600);
    await stage.settings("#tags-section");
    await stage.pause(1000);
    await stage.settings("#tab-names-table");
    await stage.pause(1000);
    await stage.caption("Changes — what every release brought", 600);
    await stage.settings("#whats-new");
    await stage.pause(1400);
    await stage.settings("#page-title");
    await stage.caption("", 300);
  },
};
