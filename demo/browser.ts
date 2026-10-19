// Boots the BUILT extension in headless Chromium and builds the synthetic world through the
// worker: windows, tabs, groups, discards, pins, and the extension's own storage (names,
// colors, protection rules, keep-alive marks, tags, a parked window). Same recipe as
// tests/e2e/fixtures.ts, with one difference that matters: Playwright's default `--no-sandbox`
// makes Chromium 153 crash on chrome.tabs.discard (the e2e FIXME) — leaving the sandbox on
// keeps every discard alive.
import { mkdtempSync, rmSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type BrowserContext, chromium, type Page, type Worker } from "@playwright/test";
import { type DemoTab, GROUPS, KEEP_ALIVE, PARKED, PROTECTED_HOSTS, TAGS, WINDOWS, pageHtml } from "./fixture.ts";

export interface Browser {
  context: BrowserContext;
  worker: Worker;
  extensionId: string;
  blocked: string[]; // network requests refused during the run (the routed *.test pages excepted)
  close: () => Promise<void>;
}

// the panel film: the 600×820 app plus a band below it where the captions go (stage.ts
// paints them there, never over the panel); stills clip the band away
export const CAPTION_BAND = 72;
export const PANEL_VIEWPORT = { width: 600, height: 820 + CAPTION_BAND };
export const WINDOW_VIEWPORT = { width: 920, height: 620 };
// the two aside pages of the MP4's right column (encode.sh lays them out 1:1)
export const STORY_VIEWPORT = { width: 768, height: 300 };
export const SETTINGS_VIEWPORT = { width: 768, height: 496 };
export const STORY_URL = "http://story.test/";
// the film is shot at this device scale (frames are DEVICE_SCALE × the viewports) so encode.sh
// can cut a sharp 1080p film; the pages still see devicePixelRatio 1 — Playwright's viewport
// emulation pins it — so layout, the stills (page.screenshot, 1:1) and the scenes are untouched
export const DEVICE_SCALE = 2;

// The fake sites come from a local HTTP server, not from Playwright's route interception:
// interception attaches per page after the page exists, and 500 tabs created in a tight loop
// fire their first request before it does. Two Chromium flags make every *.test host land on
// the server while the urls stay clean (`http://docs.example.test/...`, no port in sight).
// `pages` are whole pages by url (the story pane); every other url is a fake site.
async function serveFakeSites(tabs: DemoTab[], pages: Map<string, string>): Promise<{ server: Server; port: number }> {
  const server = createServer((request, response) => {
    const url = `http://${request.headers.host ?? "unknown.test"}${request.url ?? "/"}`;
    response.setHeader("content-type", "text/html; charset=utf-8");
    response.end(pages.get(url) ?? pageHtml(url, tabs));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  return { server, port: (server.address() as AddressInfo).port }; // listen(0): the OS picked the port
}

export async function launch(extensionDir: string, tabs: DemoTab[], pages: Map<string, string>): Promise<Browser> {
  const profile = mkdtempSync(join(tmpdir(), "taboom-demo-"));
  const { server, port } = await serveFakeSites(tabs, pages);
  // Playwright's default flags are dropped wholesale (ignoreDefaultArgs: true): with them,
  // Chromium 153 dies with SEGV_MAPERR on the first chrome.tabs.discard — the e2e FIXME —
  // and no single flag could be blamed. The few that matter are passed back by hand.
  const context = await chromium.launchPersistentContext(profile, {
    channel: "chromium",
    ignoreDefaultArgs: true,
    viewport: WINDOW_VIEWPORT,
    args: [
      "--headless=new",
      "--no-first-run",
      "--no-default-browser-check",
      "--disable-background-networking",
      "--disable-component-update",
      "--disable-sync",
      "--metrics-recording-only",
      "--mute-audio",
      `--force-device-scale-factor=${DEVICE_SCALE}`,
      "--remote-debugging-pipe",
      "--host-resolver-rules=MAP *.test 127.0.0.1",
      `--testing-fixed-http-port=${port}`,
      `--user-data-dir=${profile}`,
      `--disable-extensions-except=${extensionDir}`,
      `--load-extension=${extensionDir}`,
    ],
  });
  // anything that looks like the real network is refused and remembered (`blocked`): the
  // recording must never need it, and the run reports what Chromium tried
  const blocked: string[] = [];
  await context.route(/^(https?|wss?):\/\/(?![a-z0-9.-]+\.test\/)/, (route) => {
    blocked.push(route.request().url());
    return route.abort("blockedbyclient");
  });
  const worker = await extensionWorker(context);
  const extensionId = worker.url().split("/")[2] ?? "";
  if (!extensionId) {
    throw new Error(`cannot read the extension id from ${worker.url()}`);
  }
  return {
    context,
    worker,
    extensionId,
    blocked,
    close: async () => {
      await context.close();
      server.close();
      rmSync(profile, { recursive: true, force: true });
    },
  };
}

// the extension's worker, not a component extension's
async function extensionWorker(context: BrowserContext): Promise<Worker> {
  const ours = (worker: Worker) => worker.url().endsWith("/background/service-worker.js");
  const existing = context.serviceWorkers().find(ours);
  if (existing) {
    return existing;
  }
  return context.waitForEvent("serviceworker", { predicate: ours });
}

export interface World {
  tabs: DemoTab[];
  windowIds: Map<string, number>; // fixture window key → chrome window id
  panelWindowId: number;
  panelTabId: number; // the panel page's own tab: hidden from the list it renders
}

// Builds the world in the order Chrome needs: windows and tabs first (loading in parallel),
// then groups, then discards (a discard replaces the tab id — never keep ids across it),
// then the extension's storage.
export async function buildWorld(browser: Browser, tabs: DemoTab[], log: (line: string) => void): Promise<World> {
  const { worker } = browser;
  const panelWindowId = await worker.evaluate(async () => (await chrome.windows.getLastFocused()).id ?? -1);
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

async function waitForLoads(worker: Worker, log: (line: string) => void): Promise<void> {
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
async function writeStorage(worker: Worker, tabs: DemoTab[]): Promise<void> {
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
async function nameWindows(worker: Worker, windowIds: Map<string, number>, log: (line: string) => void): Promise<void> {
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

// the side panel page in a tab of the first (otherwise empty) window: Playwright cannot open
// the real side panel surface, the same page runs the same code (tests/e2e does the same)
export async function openPanel(browser: Browser): Promise<Page> {
  const [first] = browser.context.pages();
  const page = first ?? (await browser.context.newPage());
  await page.setViewportSize(PANEL_VIEWPORT);
  await page.goto(`chrome-extension://${browser.extensionId}/sidepanel/index.html`);
  await page.locator("#tab-list .row").first().waitFor({ state: "visible", timeout: 30_000 });
  return page;
}

export interface Aside {
  page: Page;
  windowId: number;
  tabId: number;
}

// a page of its own window, sized for its slot in the composite: the story pane and the
// Settings page. Its window and tab are hidden from the panel by the overlay (stage.ts).
export async function openAside(
  browser: Browser,
  url: string,
  size: { width: number; height: number },
): Promise<Aside> {
  const pageShown = browser.context.waitForEvent("page", { predicate: (page) => page.url() === url, timeout: 15_000 });
  const ids = await browser.worker.evaluate(
    async ({ url, size }) => {
      const created = await chrome.windows.create({ url, focused: false, type: "popup", ...size });
      return { windowId: created?.id ?? -1, tabId: created?.tabs?.[0]?.id ?? -1 };
    },
    { url, size },
  );
  const page = browser.context.pages().find((candidate) => candidate.url() === url) ?? (await pageShown);
  await page.setViewportSize(size);
  await page.waitForLoadState("domcontentloaded");
  return { page, ...ids };
}
