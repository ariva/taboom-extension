import type { Scene } from "./index.ts";

// the shared view: a second panel page in a popup window off screen (its tab and window are hidden
// from the list the filmed panel renders, the way the aside pages are) clicks a chip, types a search,
// presses Esc — the filmed panel follows. Then Settings switches the sharing off and nothing follows.
export const sharedView: Scene = {
  id: "shared-view",
  settings: "#panelView",
  title: "New: open side panels share one view",
  newIn: "1.0.8",
  covers: /across side panels/i,
  async run(stage) {
    await stage.caption(
      "New in 1.0.8 — open side panels share one view: filter, scope, sort, tag ticks and the search",
      2000,
    );
    await stage.caption("Settings → Customizations: on by default; off, each panel keeps its own view", 1200);
    await stage.pause(600);
    await stage.still("settings-shared-view", "settings");

    const url = stage.panel.url();
    const context = stage.panel.context();
    // not the filmed panel itself: it has this very url
    const isOther = (page: typeof stage.panel) => page !== stage.panel && page.url() === url;
    const shown = context.waitForEvent("page", { predicate: isOther, timeout: 15_000 });
    const own = await stage.worker.evaluate(async (url) => {
      const created = await chrome.windows.create({ url, focused: false, type: "popup", width: 600, height: 820 });
      return { windowId: created?.id ?? -1, tabId: created?.tabs?.[0]?.id ?? -1 };
    }, url);
    await stage.panel.addStyleTag({
      content: `#tab-list .row[data-tab-id="${own.tabId}"], #tab-list .group-header:has(+ .row[data-tab-id="${own.tabId}"]), #windows-pop .win-row[data-window-id="${own.windowId}"], #windows-pop .win-row[data-window-id="${own.windowId}"] + .win-menu-btn { display: none !important; }`,
    });
    const other = context.pages().find(isOther) ?? (await shown);
    await other.setViewportSize({ width: 600, height: 820 });
    // the off-screen panel is driven by dispatched events, the way the UI tests drive it: a locator
    // click waits for visibility, which a page in an unfocused popup window may never report
    await other.locator("#tab-list .row").first().waitFor({ state: "attached", timeout: 30_000 });
    const clickThere = (name: string) => other.locator(`#filters button[data-filter="${name}"]`).dispatchEvent("click");
    const typeThere = (text: string) =>
      other.locator("#search").evaluate((box, value) => {
        (box as HTMLInputElement).value = value; // `as`: evaluate hands over an Element; #search is the input
        box.dispatchEvent(new Event("input", { bubbles: true }));
      }, text);
    const escapeThere = () =>
      other.evaluate(() => document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
    const chipHere = (name: string) => stage.panel.locator(`#filters button[data-filter="${name}"]`);
    const pressed = (name: string) => chipHere(name).getAttribute("aria-pressed");
    const searchHere = stage.panel.locator("#search");

    await stage.caption("A second side panel is open in another window — watch this one follow it", 1400);
    await clickThere("snoozed");
    await stage.pause(1000);
    stage.check(
      (await pressed("snoozed")) === "true",
      "shared-view: the Snoozed chip clicked elsewhere did not arrive",
    );
    await stage.caption("A chip clicked there is pressed here", 1000);
    await stage.caption("Typed there, searched here", 800);
    await typeThere("report");
    await stage.pause(1200);
    stage.check((await searchHere.inputValue()) === "report", "shared-view: the search typed elsewhere did not arrive");
    await stage.still("shared-view-search");
    await stage.caption("Esc in either panel clears both", 900);
    await escapeThere();
    await stage.pause(900);
    stage.check((await searchHere.inputValue()) === "", "shared-view: Esc elsewhere did not clear the search here");

    await stage.caption("Switched off, each panel keeps its own view and search", 1000);
    await stage.aside.settings.locator("#panelView").click();
    await stage.pause(900);
    await typeThere("sheets");
    await clickThere("all");
    await stage.pause(1200);
    stage.check(
      (await searchHere.inputValue()) === "",
      "shared-view: a search typed elsewhere arrived with sharing off",
    );
    stage.check(
      (await pressed("snoozed")) === "true",
      "shared-view: a chip clicked elsewhere arrived with sharing off",
    );
    await stage.caption("Back on, every open panel follows again", 900);
    await stage.aside.settings.locator("#panelView").click();
    await stage.pause(600);

    // put the world back: the second panel gone, this one on All with an empty search
    await stage.worker.evaluate((windowId) => chrome.windows.remove(windowId), own.windowId);
    await stage.click(chipHere("all"));
    await stage.press("Escape");
    await stage.caption("", 300);
  },
};
