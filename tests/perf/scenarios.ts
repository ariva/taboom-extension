// The nine measurements, each returning its samples. Order matters: it is the HISTORY.md column order.
import type { PerfWorld } from "./world.ts";
import { installFrameRecorder, scrollGesture, startFrames, stopFrames, timed } from "./probes.ts";
import { percentile, summarize, type Summary } from "./stats.ts";

export interface Scenario {
  name: string;
  what: string;
  run: (world: PerfWorld, repeat: number, log: (line: string) => void) => Promise<Summary>;
}

// a filler tab in a window other than the panel's, by position — never the panel's own tab
async function fillerTab(world: PerfWorld, position: number): Promise<{ id: number; windowId: number }> {
  return world.browser.worker.evaluate(
    async ({ panelWindowId, position }) => {
      const tabs = (await chrome.tabs.query({})).filter((tab) => tab.windowId !== panelWindowId && !tab.active);
      const tab = tabs[position % tabs.length];
      return { id: tab?.id ?? -1, windowId: tab?.windowId ?? -1 };
    },
    { panelWindowId: world.world.panelWindowId, position },
  );
}

const repeatTimed = async (
  world: PerfWorld,
  repeat: number,
  act: () => Promise<unknown>,
  unit = "ms",
): Promise<Summary> => {
  const samples: number[] = [];
  for (let i = 0; i < repeat; i++) {
    samples.push(await timed(world.panel, act));
  }
  return summarize(samples, unit);
};

export const SCENARIOS: Scenario[] = [
  {
    name: "boot",
    what: "panel reload → first list paint",
    run: async (world, repeat) => {
      const samples: number[] = [];
      for (let i = 0; i < repeat; i++) {
        const started = performance.now();
        await world.panel.reload();
        await world.panel.locator("#tab-list .row").first().waitFor({ state: "visible" });
        samples.push(performance.now() - started);
      }
      await world.panel.waitForTimeout(500);
      return summarize(samples);
    },
  },
  {
    name: "refresh",
    what: "a tab in another window navigates → the list has re-rendered (debounce included)",
    run: async (world, repeat) => {
      const samples: number[] = [];
      for (let i = 0; i < repeat; i++) {
        const tab = await fillerTab(world, 17 + i * 31);
        samples.push(
          await timed(world.panel, () =>
            world.browser.worker.evaluate(
              ({ id, i }) => chrome.tabs.update(id, { url: `http://tick-${i}.example.test/refresh/${i}` }),
              { id: tab.id, i },
            ),
          ),
        );
        await world.panel.waitForTimeout(300);
      }
      return summarize(samples);
    },
  },
  {
    name: "search",
    what: "typing a 4-letter query → filtered list, then clearing it",
    run: async (world, repeat) => {
      const search = world.panel.locator("#search");
      const samples: number[] = [];
      for (let i = 0; i < repeat; i++) {
        samples.push(await timed(world.panel, () => search.fill("docs")));
        await timed(world.panel, () => search.fill(""));
      }
      return summarize(samples);
    },
  },
  {
    name: "scroll",
    what: "frame interval (p95) over five synthesized wheel gestures down the list",
    run: async (world, repeat) => {
      const cdp = await world.browser.context.newCDPSession(world.panel);
      await installFrameRecorder(world.panel);
      const p95s: number[] = [];
      for (let i = 0; i < repeat; i++) {
        await world.panel.locator("#tab-list").evaluate((list) => {
          list.scrollTop = 0;
        });
        await startFrames(world.panel);
        for (let gesture = 0; gesture < 5; gesture++) {
          await scrollGesture(cdp, world.panel, 2500);
        }
        const { frames } = await stopFrames(world.panel);
        p95s.push(percentile(frames, 0.95));
      }
      await cdp.detach();
      return summarize(p95s, "ms/frame p95");
    },
  },
  {
    name: "sort",
    what: "sort switch recent → window grouping → title → recent",
    run: async (world, repeat) => {
      const sort = world.panel.locator("#sort");
      const samples: number[] = [];
      for (let i = 0; i < repeat; i++) {
        samples.push(await timed(world.panel, () => sort.selectOption("window")));
        await timed(world.panel, () => sort.selectOption("title"));
        await timed(world.panel, () => sort.selectOption("recent"));
      }
      return summarize(samples);
    },
  },
  {
    name: "scope",
    what: "scope switch all windows → current window → all windows",
    run: async (world, repeat) => {
      const scope = world.panel.locator("#scope");
      const samples: number[] = [];
      for (let i = 0; i < repeat; i++) {
        samples.push(await timed(world.panel, () => scope.selectOption("current-window")));
        await timed(world.panel, () => scope.selectOption("all-windows"));
      }
      return summarize(samples);
    },
  },
  {
    name: "selectAll",
    what: "select all shown tabs → bulk bar, then unselect",
    run: async (world, repeat) =>
      repeatTimed(world, repeat, async () => {
        await world.panel.locator("#select-all").check();
        await world.panel.locator("#bulk-clear").click();
      }),
  },
  {
    name: "settings",
    what: "Settings page reload → tagged-page rules table painted",
    run: async (world, repeat) => {
      const samples: number[] = [];
      for (let i = 0; i < repeat; i++) {
        const started = performance.now();
        await world.settings.reload();
        await world.settings.locator("#rules li, #tag-page-rows tr").first().waitFor({ state: "visible" });
        samples.push(performance.now() - started);
      }
      return summarize(samples);
    },
  },
  {
    name: "worker",
    what: "tab switch in another window → the worker's history write lands",
    run: async (world, repeat) => {
      const samples: number[] = [];
      for (let i = 0; i < repeat; i++) {
        const tab = await fillerTab(world, 5 + i * 13);
        samples.push(
          await world.browser.worker.evaluate(
            ({ id }) =>
              new Promise<number>((resolve) => {
                const started = performance.now();
                const done = (changes: { [key: string]: unknown }) => {
                  if ("tabHistory" in changes) {
                    chrome.storage.onChanged.removeListener(done);
                    resolve(performance.now() - started);
                  }
                };
                chrome.storage.onChanged.addListener(done);
                chrome.tabs.update(id, { active: true }).catch(() => resolve(Number.NaN));
              }),
            { id: tab.id },
          ),
        );
        // past the worker's 400 ms profile debounce: the fingerprint pass over 2000 tabs that this
        // switch queued must not land inside the next measurement
        await world.panel.waitForTimeout(600);
      }
      return summarize(samples.filter((value) => !Number.isNaN(value)));
    },
  },
];
