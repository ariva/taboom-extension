import type { Scene } from "./index.ts";

// tagged pages keep their #fragment (T-0153): a wiki tab navigates to an anchor, Tag URL… stores
// the address with it (one page per route), the hover tip and the Settings table show it
export const tagFragment: Scene = {
  id: "tag-fragment",
  settings: "#tagPagesKeepFragment",
  title: "New: tagged pages keep their #fragment",
  newIn: "1.1.0",
  covers: /fragment/i,
  async run(stage) {
    await stage.caption("New in 1.1.0 — a tag can sit on one route of a hash-routed page", 1800);
    // an awake wiki tab moves to an anchor: the row keeps its title, the address gains #review
    const tabId = await stage.worker.evaluate(async () => {
      const [tab] = await chrome.tabs.query({ url: "http://wiki.example.test/*", discarded: false });
      if (tab?.id !== undefined && tab.url && !tab.url.includes("#")) {
        await chrome.tabs.update(tab.id, { url: `${tab.url}#review` });
      }
      return tab?.id ?? -1;
    });
    await stage.pause(1200);
    // that very tab's row (several wiki tabs share a title)
    const row = stage.panel.locator(`#tab-list .row[data-tab-id="${tabId}"]`);
    await stage.click(row, { button: "right" });
    await stage.pause(400);
    await stage.click(stage.menuItem("Tag URL…"));
    await stage.pause(500);
    await stage.click(stage.panel.locator("#tag-assign-pop .tag-pick input").first());
    await stage.click(stage.panel.locator("#tag-assign-pop .tag-pick-actions button", { hasText: "Apply" }));
    await stage.pause(900);
    await stage.hover(row);
    await stage.caption("The tag is stored with the #review fragment — the hover tip shows the address", 1800);
    await stage.still("tags-fragment-tip");
    await stage.caption("Settings → Tags: Keep the #fragment is on by default; off, the hash is dropped", 1200);
    await stage.settings("#tagPagesKeepFragment");
    await stage.pause(1200);
    await stage.still("settings-tag-fragment", "settings");
    await stage.caption("An entry with a # is exact; one without covers every fragment", 1200);
    await stage.aside.settings
      .locator("#tag-page-table")
      .evaluate((element) => element.scrollIntoView({ block: "center" }));
    await stage.pause(900);
    stage.check(
      (await stage.aside.settings.locator("#tag-page-rows tr[data-key*='#review']").count()) === 1,
      "tag-fragment: no tagged page rule carries #review",
    );
    await stage.hover(stage.panel.locator("#search"));
    await stage.caption("", 300);
  },
};
