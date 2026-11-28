import { highlightText } from "../../src/app/release-highlights.ts";
import type { Scene } from "./index.ts";

// Tabs with sound: a music page of the world starts playing (its address gets #play — the fake
// pages hum while it is there, demo/fixture.ts), ":audio" finds it, the 🔊 chip lists it, the 🔊
// after the host mutes it, the row menu unmutes, and when the sound stops the chip goes and the
// list is back on the filter the chip replaced. A browser that reports no sound for the hum is
// filmed with the tab muted through the API instead: the chip and 🔇 show all the same.
export const tabAudio: Scene = {
  id: "tab-audio",
  title: "Mute tabs, find the ones with sound",
  feature: highlightText("1.1.1", "tab-audio"),
  settings: "#page-title",
  newIn: "1.1.1",
  covers: /\bmute\b|\baudio\b/i,
  async run(stage) {
    const player = stage.world.tabs.find((tab) => tab.host === "music.example.test" && !tab.snoozed && !tab.pinned);
    if (!player) {
      stage.check(false, "tab-audio: the world has no awake music tab");
      return;
    }
    // the tab is found by its address without the fragment: #play comes and goes
    const update = (props: { url?: string; muted?: boolean }) =>
      stage.panel.evaluate(
        async ({ page, props }) => {
          const tab = (await chrome.tabs.query({})).find((candidate) => candidate.url?.split("#")[0] === page);
          if (tab?.id !== undefined) {
            await chrome.tabs.update(tab.id, props);
          }
        },
        { page: player.url, props },
      );
    const sound = () =>
      stage.panel.evaluate(async (page) => {
        const tab = (await chrome.tabs.query({})).find((candidate) => candidate.url?.split("#")[0] === page);
        return { audible: tab?.audible === true, muted: tab?.mutedInfo?.muted === true };
      }, player.url);
    const until = async (ok: (state: { audible: boolean; muted: boolean }) => boolean, ms = 5000): Promise<boolean> => {
      for (let waited = 0; waited < ms; waited += 250) {
        if (ok(await sound())) {
          return true;
        }
        await stage.pause(250);
      }
      return false;
    };
    const chip = (name: string) => stage.panel.locator(`#filters button[data-filter="${name}"]`);
    const rowCount = () => stage.panel.evaluate(() => document.querySelectorAll("#tab-list .row").length);
    const icon = () => stage.panel.evaluate(() => document.querySelector("#tab-list .row .audio")?.textContent ?? "");

    await stage.caption(`${stage.release} — mute a tab from the panel, find the tabs with sound`, 1800);
    await update({ url: `${player.url}#play` });
    const playing = await until((state) => state.audible);
    stage.check(playing, "tab-audio: the music tab never became audible — filmed with a tab muted through the API");
    if (!playing) {
      await update({ muted: true });
      await until((state) => state.muted);
    }
    await stage.pause(600);

    await stage.caption(":audio in the search finds the tabs that play or are muted", 700);
    await stage.click(stage.panel.locator("#search"));
    await stage.type(":audio");
    await stage.pause(1200);
    stage.check((await rowCount()) === 1, "tab-audio: :audio did not find exactly the playing tab");
    await stage.still("tab-audio-search");
    await stage.press("Escape");

    await stage.caption("While a tab has sound, a 🔊 chip joins the filters — one click lists them", 800);
    await stage.click(chip("audio"));
    await stage.pause(900);
    stage.check((await rowCount()) === 1, "tab-audio: the 🔊 chip did not narrow the list to the playing tab");
    await stage.still("tab-audio-chip");

    if (playing) {
      await stage.caption("The 🔊 after the host is a button: click it to mute the tab", 800);
      await stage.click(stage.panel.locator("#tab-list .row .audio").first());
      await until((state) => state.muted);
      await stage.pause(700);
    }
    stage.check((await icon()) === "🔇", "tab-audio: the muted tab's row does not show 🔇");
    // off the row for the shot: its hover tip would cover the list with the page's #play address
    await stage.hover(stage.panel.locator("#search"));
    await stage.caption("🔇 — the page keeps playing, silently; click again to unmute", 1200);
    await stage.still("tab-audio-muted");

    await stage.caption("Mute and Unmute are in the row menu too — for a selection as well", 700);
    await stage.click(stage.panel.locator("#tab-list .row").first(), { button: "right" });
    await stage.pause(700);
    await stage.still("tab-audio-menu");
    await stage.click(stage.menuItem("Unmute"));
    stage.check(await until((state) => !state.muted), "tab-audio: Unmute from the row menu left the tab muted");
    await stage.pause(700);

    await stage.caption("The sound stops: the chip goes, the list is back on the filter it replaced", 600);
    await update({ url: player.url });
    await until((state) => !state.audible, 8000);
    await stage.pause(1500);
    const allPressed = await stage.panel.evaluate(
      () => document.querySelector('#filters button[data-filter="all"]')?.getAttribute("aria-pressed") === "true",
    );
    stage.check(allPressed, "tab-audio: the list did not return to All when the sound stopped");
    await stage.caption("", 300);
  },
};
