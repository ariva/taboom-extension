import type { Scene } from "./index.ts";

export const snoozeProtect: Scene = {
  id: "snooze-protect",
  settings: "#autoSnoozeEnabled",
  title: "Snooze, protect, bulk actions",
  async run(stage) {
    await stage.caption("Snooze a tab by hand: it frees its memory and reloads on click", 1600);
    const row = stage.awakeRow("Morning briefing");
    await stage.hover(row);
    await stage.still("row-actions-hover");
    await stage.click(row.locator('[data-action="snooze"]'));
    await stage.pause(1200);
    await stage.settings("#rules");
    await stage.caption("Protect a site: Taboom never auto-snoozes it", 1200);
    const other = stage.awakeRow("Standing desk");
    await stage.hover(other);
    await stage.click(other.locator('[data-action="toggle-protect"]'));
    await stage.pause(1200);
    await stage.caption("Tick rows for bulk Snooze / Protect / Close", 1200);
    const rows = stage.panel.locator("#tab-list .row:not(.snoozed)");
    await stage.click(rows.nth(1).locator('input[type="checkbox"]'));
    await stage.click(rows.nth(2).locator('input[type="checkbox"]'));
    await stage.click(rows.nth(3).locator('input[type="checkbox"]'));
    await stage.pause(600);
    await stage.still("bulk-snooze-selection");
    await stage.click(stage.panel.locator("#bulk-snooze"));
    await stage.pause(1500);
    await stage.caption("", 300);
  },
};

export const duplicates: Scene = {
  id: "duplicates",
  settings: "#page-title",
  title: "Duplicates",
  async run(stage) {
    await stage.caption("The same page open in several windows? Quick launch lists the dupes", 1600);
    await stage.click(stage.panel.locator("#win-list-btn"));
    await stage.pause(600);
    await stage.click(stage.panel.locator("#windows-pop .win-view", { hasText: "Dupes" }));
    stage.check(
      (await stage.panel.locator("#windows-pop .win-view.on").textContent())?.startsWith("Dupes") === true,
      "duplicates: the Dupes view did not open",
    );
    await stage.still("quick-launch-dupes");
    await stage.pause(1800);
    await stage.press("Escape");
    await stage.caption("Cleanup Duplicates keeps one copy of each page", 1200);
    await stage.click(stage.panel.locator("#quick-actions-btn"));
    await stage.pause(500);
    await stage.still("quick-actions-menu");
    const before = await stage.panel.locator('#filters button[data-filter="all"] .count').textContent();
    await stage.click(stage.menuItem("Cleanup Duplicates"));
    const ok = stage.panel.locator("#ask-dialog .ask-ok");
    await ok.waitFor({ state: "visible", timeout: 4000 }).catch(() => {});
    if (await ok.isVisible()) {
      await stage.click(ok);
    }
    await stage.pause(1500);
    const after = await stage.panel.locator('#filters button[data-filter="all"] .count').textContent();
    stage.check(before !== after, `duplicates: the All count did not drop (${before} → ${after})`);
    await stage.caption("", 300);
  },
};
