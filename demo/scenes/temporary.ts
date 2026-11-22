import type { Scene } from "./index.ts";
import { type DragArgs, dragRows } from "./reorder.ts";

// temporary protection and keep-alive (T-0157): the row menu's duration submenu, the temporary
// badges with the time left in the hover tip, the Settings tables' Expires / Time left, the
// Protected Sites On box (struck-through badge) and drag reorder; the shop site is cleaned up at the end
export const temporaryProtection: Scene = {
  id: "temporary-protection",
  settings: "#rules-table",
  title: "Temporary protection or keep-alive",
  feature: "Temporary protection or keep-alive",
  newIn: "1.1.0",
  covers: /temporar|expir|duration|disabled protected|protected sites/i,
  async run(stage) {
    await stage.caption(`${stage.release} — protect a site for a while, not for good`, 1800);
    // an awake tab of each site, whatever the world's seed snoozed: the shop (unprotected, unmarked)
    // gets the temporary rule and mark, a docs tab shows the fixture's docs rule switched off
    const awakeTitle = (host: string, fallback: string) =>
      stage.worker.evaluate(
        async ([pattern, name]) => (await chrome.tabs.query({ url: pattern, discarded: false }))[0]?.title ?? name,
        [`http://${host}/*`, fallback] as const,
      );
    const row = stage.awakeRow(await awakeTitle("shop.example.test", "Standing desk"));
    // every duration submenu holds the same labels: the open one (hover expanded it) is the target
    const duration = (text: string) =>
      stage.panel.locator("#ctx-menu .ctx-submenu:not([hidden]) .ctx-item", { hasText: text }).first();
    await stage.click(row, { button: "right" });
    await stage.pause(500);
    // hovering the parent opens the durations after the menu's hover delay; its click is still "Always"
    await stage.hover(stage.menuItem("Protect domain"));
    await stage.pause(900);
    await stage.caption("Hover Protect domain: Always, or 1 hour to 1 week — the click itself is Always", 1400);
    await stage.still("protect-durations-menu");
    await stage.click(duration("1 day"));
    await stage.pause(1200);
    stage.check(
      (await row.locator(".badge", { hasText: "temporary protected" }).count()) > 0,
      "temporary-protection: the row shows no temporary protected badge",
    );
    await stage.caption("Keep alive the same way: Keep alive domain / URL open the durations too", 1200);
    await stage.click(row, { button: "right" });
    await stage.pause(500);
    await stage.hover(stage.menuItem("Keep alive domain"));
    await stage.pause(900);
    await stage.click(duration("2 hours"));
    await stage.pause(1200);
    await stage.hover(row);
    await stage.caption("The badges say temporary; the hover tip adds the time left", 1600);
    await stage.still("temporary-badges-tip");
    await stage.caption(
      "Settings lists every rule and mark with its Expires and Time left — pick a duration there too",
      1200,
    );
    await stage.settings("#rules-table");
    await stage.pause(1200);
    await stage.still("settings-protected-expires", "settings");
    await stage.settings("#keep-alive-table");
    await stage.pause(1200);
    await stage.still("settings-keep-alive-expires", "settings");
    // the On box: the docs rule stays listed, protects nothing — the panel strikes the badge through
    await stage.caption("Untick On: the rule stays, protects nothing, the badge is struck through", 1200);
    await stage.settings("#rules-table");
    const settings = stage.aside.settings;
    const docsOn = settings.locator("#rules tr", { hasText: "docs.example.test" }).locator("input[type=checkbox]");
    await docsOn.evaluate((element) => (element as HTMLElement).click());
    await stage.pause(1200);
    const docs = stage.awakeRow(await awakeTitle("docs.example.test", "Roadmap 2027"));
    // the first hover scrolls the row into view and the list's scroll hides the tip; a second move
    // (onto the badge) re-enters the row once the scroll has settled, so the tip is in the still
    await stage.hover(docs);
    await stage.pause(800);
    await stage.hover(docs.locator(".badge.off").first());
    await stage.pause(1200);
    stage.check(
      (await docs.locator(".badge.off", { hasText: "protected" }).count()) > 0,
      "temporary-protection: the docs row shows no struck-through protected badge",
    );
    await stage.still("protected-disabled-badge");
    await docsOn.evaluate((element) => (element as HTMLElement).click());
    await stage.pause(800);
    // drag reorder, like the keep-alive marks (reorder.ts): the last rule onto the first
    await stage.caption("…and drag the rules into any order, like the keep-alive marks", 1200);
    const keys = await settings.evaluate(() =>
      Array.from(document.querySelectorAll<HTMLElement>("#rules tr[data-key]")).map((row) => row.dataset.key ?? ""),
    );
    const from = keys[keys.length - 1] ?? "";
    const to = keys[0] ?? "";
    stage.check(keys.length >= 2 && from !== to, "temporary-protection: fewer than two rules to reorder");
    await settings.evaluate(dragRows, { rows: "rules", from, to, step: "over" } satisfies DragArgs);
    await stage.pause(1200);
    await stage.still("settings-reorder-protected", "settings");
    await settings.evaluate(dragRows, { rows: "rules", from, to, step: "drop" } satisfies DragArgs);
    await stage.pause(1000);
    // the shop site back as it was: the later scenes expect it unprotected and unmarked
    await stage.click(row, { button: "right" });
    await stage.pause(400);
    await stage.click(stage.menuItem("Remove domain from keep-alive"));
    await stage.pause(800);
    await stage.click(row, { button: "right" });
    await stage.pause(400);
    await stage.click(stage.menuItem("Unprotect"));
    await stage.pause(800);
    await stage.caption("", 300);
  },
};
