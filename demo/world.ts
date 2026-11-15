// Builds the synthetic world through the extension's own chrome.*: windows, tabs, groups, discards,
// pins, and the extension's storage (names, colors, protection rules, keep-alive marks, tags, a
// parked window). Browser-agnostic: it only needs an Evaluator (demo/page-api.ts) — the worker on
// Chromium, the panel page on Firefox.
import { GROUPS, KEEP_ALIVE, PARKED, PROTECTED_HOSTS, TAGS, WINDOWS, type DemoTab } from "./fixture.ts";
import type { DemoBrowser, Evaluator, Size } from "./page-api.ts";

export const WINDOW_VIEWPORT: Size = { width: 920, height: 620 };

export interface World {
  tabs: DemoTab[];
  windowIds: Map<string, number>; // fixture window key → chrome window id
  panelWindowId: number;
  panelTabId: number; // the panel page's own tab: hidden from the list it renders
}

// Builds the world in the order the browser needs: windows and tabs first (loading in parallel),
// then groups, then discards (a discard may replace the tab id — never keep ids across it),
// then the extension's storage.
export async function buildWorld(browser: DemoBrowser, tabs: DemoTab[], log: (line: string) => void): Promise<World> {
  const { worker } = browser;
  // the window the evaluator runs in: the worker's current window on Chromium, the panel's own on Firefox
  const panelWindowId = await worker.evaluate(async () => (await chrome.windows.getCurrent()).id ?? -1);
  const windowIds = new Map<string, number>();
  for (const window of WINDOWS) {
    const specs = tabs.filter((tab) => tab.windowKey === window.key);
    const id = await worker.evaluate(
      async ({ specs, size }) => {
        const [first, ...rest] = specs;
        if (!first) {
          return -1;
        }
        const created = await chrome.windows.create({ url: first.url, focused: false, ...size });
        const windowId = created?.id ?? -1;
        for (const spec of rest) {
          await chrome.tabs.create({ windowId, url: spec.url, active: false, pinned: spec.pinned === true });
        }
        const [pinnedFirst] = await chrome.tabs.query({ windowId, index: 0 });
        if (first.pinned && pinnedFirst?.id !== undefined) {
          await chrome.tabs.update(pinnedFirst.id, { pinned: true });
        }
        return windowId;
      },
      { specs, size: WINDOW_VIEWPORT },
    );
    windowIds.set(window.key, id);
    log(`window ${window.name}: ${specs.length} tabs (#${id})`);
  }
  await waitForLoads(worker, log);
  // tab groups: by url, inside each window
  for (const group of GROUPS) {
    const urls = tabs.filter((tab) => tab.group === group.key).map((tab) => tab.url);
    const windowId = windowIds.get(group.windowKey);
    if (urls.length === 0 || windowId === undefined) {
      continue;
    }
    await worker.evaluate(
      async ({ urls, windowId, title, color }) => {
        const all = await chrome.tabs.query({ windowId });
        const [head, ...tail] = all.filter((tab) => tab.url && urls.includes(tab.url)).map((tab) => tab.id ?? -1);
        if (head === undefined) {
          return;
        }
        // the typings overload group() with a callback form and lose the promise: this is the promise form
        const groupId = await (chrome.tabs.group({
          tabIds: [head, ...tail],
          createProperties: { windowId },
        }) as Promise<number>);
        // color: chrome.tabGroups.Color is a string union the fixture spells by name
        await chrome.tabGroups.update(groupId, { title, color: color as chrome.tabGroups.Color });
      },
      { urls, windowId, title: group.title, color: group.color },
    );
  }
  // discards: snoozed tabs, after they loaded so the title survives
  const snoozed = tabs.filter((tab) => tab.snoozed).map((tab) => tab.url);
  const discarded = await worker.evaluate(async (urls) => {
    const wanted = new Set(urls);
    const all = await chrome.tabs.query({ active: false });
    let count = 0;
    for (const tab of all) {
      if (tab.url && wanted.has(tab.url) && tab.id !== undefined && !tab.discarded) {
        await chrome.tabs.discard(tab.id);
        count++;
      }
    }
    return count;
  }, snoozed);
  log(`discarded ${discarded} tabs`);
  await writeStorage(worker, tabs);
  await nameWindows(worker, windowIds, log);
  const [panelTab] = await worker.evaluate(async (windowId) => chrome.tabs.query({ windowId }), panelWindowId);
  return { tabs, windowIds, panelWindowId, panelTabId: panelTab?.id ?? -1 };
}

async function waitForLoads(worker: Evaluator, log: (line: string) => void): Promise<void> {
  const started = Date.now();
  while (Date.now() - started < 90_000) {
    const loading = await worker.evaluate(async () => (await chrome.tabs.query({ status: "loading" })).length);
    if (loading === 0) {
      log(`all tabs loaded in ${Date.now() - started} ms`);
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  log("some tabs still loading after 90 s — going on");
}

// the extension's storage, in the shapes src/app/types.ts declares (LocalStorageSchema)
async function writeStorage(worker: Evaluator, tabs: DemoTab[]): Promise<void> {
  const now = Date.now();
  const tagPages = tabs
    .filter((tab) => tab.tags && tab.tags.length > 0)
    .map((tab) => ({ url: tab.url, tagIds: tab.tags ?? [] }));
  const payload = {
    settings: { autoSnoozeEnabled: false, keepAliveEnabled: true, askBeforePark: true },
    ui: { theme: "light", sort: "window", scope: "all-windows" },
    protectionRules: PROTECTED_HOSTS.map((host, index) => ({
      id: `demo-rule-${index}`,
      type: "host",
      pattern: host,
      createdAt: now - 86_400_000 * (index + 1),
    })),
    keepAlive: KEEP_ALIVE.map((mark) => ({ ...mark, nextReload: now + mark.minutes * 60_000 })),
    tags: TAGS,
    tagPages,
    parkedWindows: [
      {
        id: "demo-parked-1",
        parkedAt: now - PARKED.daysAgo * 86_400_000,
        name: PARKED.name,
        color: PARKED.color,
        tabs: PARKED.tabs.map((tab, index) => ({ ...tab, ...(index === 0 ? { active: true } : {}) })),
        groups: PARKED.groups,
      },
    ],
  };
  await worker.evaluate((data) => chrome.storage.local.set(data), payload);
}

// window names, colors and the pin live in windowProfiles keyed by a logical id the worker
// mints per window (storage.session.windowSessionMap) — read the map, patch the profiles
async function nameWindows(
  worker: Evaluator,
  windowIds: Map<string, number>,
  log: (line: string) => void,
): Promise<void> {
  const wanted = WINDOWS.map((window) => ({
    windowId: windowIds.get(window.key) ?? -1,
    name: window.name,
    color: window.color,
    pinnedWindow: window.pinnedWindow === true,
  }));
  for (let attempt = 0; attempt < 20; attempt++) {
    const missing = await worker.evaluate(async (wanted) => {
      const { windowSessionMap = {} } = (await chrome.storage.session.get("windowSessionMap")) as {
        windowSessionMap?: Record<number, string>;
      };
      const { windowProfiles = {} } = (await chrome.storage.local.get("windowProfiles")) as {
        windowProfiles?: Record<string, Record<string, unknown>>;
      };
      const missing = wanted.filter((entry) => !windowSessionMap[entry.windowId]);
      if (missing.length > 0) {
        return missing.length;
      }
      for (const entry of wanted) {
        const logicalId = windowSessionMap[entry.windowId] ?? "";
        windowProfiles[logicalId] = {
          ...windowProfiles[logicalId],
          name: entry.name,
          color: entry.color,
          ...(entry.pinnedWindow ? { pinnedWindow: true } : {}),
        };
      }
      await chrome.storage.local.set({ windowProfiles });
      return 0;
    }, wanted);
    if (missing === 0) {
      log("window names written");
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  log("window session map never filled — windows stay unnamed");
}
