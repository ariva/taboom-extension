import type { Scene } from "./index.ts";

// the on-demand snooze: the Settings button and the ☰ item run one auto-snooze pass right
// away, every rule but the inactivity clock. It snoozes most of the world — the tabs it
// discards are reloaded at the end, so the scenes after it find their awake rows
export const snoozeNow: Scene = {
  id: "snooze-now",
  settings: "#snooze-now",
  title: "New: snooze inactive tabs now",
  newIn: "1.0.6",
  covers: /snooze now/i,
  async run(stage) {
    await stage.caption("New in 1.0.6 — snooze every inactive tab right now, no waiting for the timer", 1800);
    await stage.caption("Settings → Automatic Snooze: the button runs the check at once", 1200);
    await stage.pause(600);
    await stage.still("settings-snooze-now", "settings");
    const awakeBefore = await stage.worker.evaluate(async () =>
      (await chrome.tabs.query({ discarded: false })).map((tab) => tab.id ?? -1),
    );
    await stage.caption("Or from the panel: ☰ → Snooze inactive tabs now", 1200);
    await stage.click(stage.panel.locator("#quick-actions-btn"));
    await stage.pause(600);
    await stage.still("quick-actions-snooze-now");
    const countBefore = await stage.panel.locator('#filters button[data-filter="awake"] .count').textContent();
    await stage.click(stage.menuItem("Snooze inactive tabs now"));
    await stage.pause(1200);
    const toast = (await stage.panel.locator("#toast").textContent()) ?? "";
    stage.check(/^Snoozed \d+ tabs?$/.test(toast), `snooze-now: no count toast (got "${toast}")`);
    await stage.still("snooze-now-toast"); // the toast shows for five seconds: shoot it before the caption runs
    const countAfter = await stage.panel.locator('#filters button[data-filter="awake"] .count').textContent();
    stage.check(
      countBefore !== countAfter,
      `snooze-now: the Awake count did not drop (${countBefore} → ${countAfter})`,
    );
    await stage.caption(
      "Active, pinned, audible, protected and kept-alive tabs stay awake — the toast says how many went",
      2200,
    );
    // put the world back: wake what this pass snoozed, so the next scenes find their awake tabs
    await stage.worker.evaluate(async (ids) => {
      const snoozed = (await chrome.tabs.query({ discarded: true })).filter((tab) => ids.includes(tab.id ?? -1));
      await Promise.all(snoozed.map((tab) => chrome.tabs.reload(tab.id ?? -1).catch(() => {})));
      for (let i = 0; i < 100; i++) {
        if ((await chrome.tabs.query({ status: "loading" })).length === 0) {
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
    }, awakeBefore);
    await stage.pause(800);
    await stage.caption("", 300);
  },
};
