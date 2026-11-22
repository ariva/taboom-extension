import { highlightText } from "../../src/app/release-highlights.ts";
import type { Scene } from "./index.ts";

// custom tab names: Rename tab… in the row menu (before Copy URL), the dialog, the renamed row
// with the real title in its hover tip, the Settings table; the name is taken off at the end
export const tabNames: Scene = {
  id: "tab-names",
  settings: "#tab-names-table",
  title: "Name a tab yourself",
  feature: highlightText("1.1.0", "tab-names"),
  newIn: "1.1.0",
  covers: /tab name|rename/i,
  async run(stage) {
    await stage.caption(`${stage.release} — give a tab the name you want to see`, 1800);
    // an awake docs tab, whatever the world's seed snoozed
    const title = await stage.worker.evaluate(
      async ([pattern, fallback]) =>
        (await chrome.tabs.query({ url: pattern, discarded: false }))[0]?.title ?? fallback,
      ["http://docs.example.test/*", "Roadmap 2027"] as const,
    );
    const row = stage.awakeRow(title);
    await stage.click(row, { button: "right" });
    await stage.pause(600);
    await stage.caption("Rename tab… sits first in the row menu", 1200);
    await stage.still("rename-tab-menu");
    await stage.click(stage.menuItem("Rename tab…"));
    await stage.pause(600);
    // the dialog's input holds the current title, focused: replace it
    await stage.press("Control+A");
    await stage.type("Q3 roadmap");
    await stage.caption("The name is yours; the page keeps its own title underneath", 1200);
    await stage.still("rename-tab-dialog");
    await stage.press("Enter");
    await stage.pause(1200);
    const named = stage.row("Q3 roadmap");
    stage.check((await named.count()) > 0, "tab-names: no row shows the new name");
    await stage.hover(named);
    await stage.pause(1000);
    await stage.caption("The row shows the name; search finds it; the hover tip keeps the real title", 1600);
    await stage.still("tab-name-row-tip");
    await stage.caption(
      "Settings → Tab names lists every rule: pattern, name, open tabs — drag to set which wins",
      1400,
    );
    await stage.settings("#tab-names-table");
    await stage.pause(1200);
    await stage.still("settings-tab-names", "settings");
    // the docs tab back to its own title: a blank name takes the rule away
    await stage.click(named, { button: "right" });
    await stage.pause(500);
    await stage.click(stage.menuItem("Rename tab…"));
    await stage.pause(500);
    await stage.press("Control+A");
    await stage.press("Backspace");
    await stage.press("Enter");
    await stage.pause(800);
    await stage.caption("", 300);
  },
};
