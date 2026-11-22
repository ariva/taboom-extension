import type { Scene } from "./index.ts";

// keep alive by domain (T-0155) and the struck-through paused mark (T-0156): a news tab's row
// menu marks the whole site, the pause shows as a struck-through badge, Settings → Customizations
// holds the switch, the Alive view's menu names the mark's kind; the mark is removed at the end
export const keepAliveDomain: Scene = {
  id: "keep-alive-domain",
  settings: "#keep-alive-section",
  title: "Keep alive by domain",
  feature: "Keep alive by domain",
  newIn: "1.1.0",
  covers: /keep alive.*domain|disabled tags|paused keep-alive|struck/i,
  async run(stage) {
    await stage.caption(`${stage.release} — keep a whole site alive, not just one page`, 1800);
    // an awake news tab: the mark will cover every news.example.test tab
    const title = await stage.worker.evaluate(
      async () =>
        (await chrome.tabs.query({ url: "http://news.example.test/*", discarded: false }))[0]?.title ?? "News",
    );
    const row = stage.awakeRow(title);
    await stage.click(row, { button: "right" });
    await stage.pause(500);
    await stage.caption("Row menu: Keep alive domain — or Keep alive URL for this page only", 1200);
    await stage.still("keep-alive-row-menu");
    await stage.click(stage.menuItem("Keep alive domain"));
    await stage.pause(1200);
    stage.check(
      (await row.locator(".badge", { hasText: "kept alive" }).count()) > 0,
      "keep-alive-domain: the row shows no kept alive badge",
    );
    await stage.caption("Every tab of news.example.test is kept alive; one of them reloads per timer", 1600);
    await stage.settings("#keep-alive-section");
    await stage.pause(1200);
    await stage.still("settings-keep-alive-domain", "settings");
    await stage.caption("The menu names the mark's kind: Pause keep-alive (domain)", 1000);
    await stage.click(row, { button: "right" });
    await stage.pause(400);
    await stage.click(stage.menuItem("Pause keep-alive (domain)"));
    await stage.pause(1000);
    await stage.hover(row);
    await stage.caption("Paused — the badge stays, struck through; a disabled tag shows the same way", 1600);
    await stage.still("keep-alive-paused-badge");
    await stage.caption("Settings → Customizations: show them struck through, or hide them", 900);
    await stage.settings("#showDisabledInPanel");
    await stage.pause(1400);
    await stage.still("settings-show-disabled", "settings");
    await stage.settings("#keep-alive-section");
    await stage.caption("Quick launch → Alive lists every mark; its menu resumes or removes it", 900);
    await stage.click(stage.panel.locator("#win-list-btn"));
    await stage.pause(500);
    await stage.click(stage.panel.locator("#windows-pop .win-view", { hasText: "Alive" }));
    await stage.pause(500);
    // the fixture's Inbox mark is open too: the paused row is the domain mark
    const mark = stage.panel.locator("#windows-pop .win-row.paused").first();
    await stage.click(mark, { button: "right" });
    await stage.pause(500);
    await stage.still("alive-mark-menu");
    await stage.click(stage.menuItem("Remove domain from keep-alive"));
    await stage.pause(800);
    await stage.press("Escape");
    await stage.pause(400);
    await stage.caption("", 300);
  },
};
