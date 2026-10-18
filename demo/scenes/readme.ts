import type { Scene } from "./index.ts";

// The README's screenshots: the same panel and Settings page in the dark theme, stills only —
// this scene is never filmed. `just demo scene=readme` retakes them on their own.
export const readme: Scene = {
  id: "readme",
  settings: "#page-title",
  title: "README screenshots",
  stillsOnly: true,
  async run(stage) {
    await stage.settingsSelect("#theme", "dark");
    await stage.pause(900);
    await stage.hover(stage.panel.locator("#search"));
    await stage.still("readme-panel");
    await stage.click(stage.panel.locator("#win-list-btn"));
    await stage.pause(700);
    await stage.still("readme-quick-launch");
    await stage.press("Escape");
    await stage.pause(400);
    await stage.click(stage.panel.locator("#quick-actions-btn"));
    await stage.pause(500);
    await stage.still("readme-quick-actions");
    await stage.press("Escape");
    await stage.pause(400);
    await stage.still("readme-settings", "settings", 1180); // Interface → Protected Sites
    await stage.settingsSelect("#theme", "light");
    await stage.pause(900);
  },
};
