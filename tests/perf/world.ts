// The world the performance tier measures: the BUILT extension in headless Chromium with the demo's
// synthetic tabs, scaled to the wanted count (the six filler windows absorb the difference), the
// panel page open, the Settings page open in a popup window.
import { resolve } from "node:path";
import { buildWorld, launch, PANEL_VIEWPORT, SETTINGS_VIEWPORT, type World } from "../../demo/browser.ts";
import { buildTabs, WINDOWS } from "../../demo/fixture.ts";
import type { BrowserName, DemoBrowser, DemoPage } from "../../demo/page-api.ts";

export const DEFAULT_EXTENSION_DIR = resolve(import.meta.dirname, "../../dist/chrome");
export const DEFAULT_FIREFOX_EXTENSION_DIR = resolve(import.meta.dirname, "../../dist/firefox");

export interface PerfWorld {
  browser: DemoBrowser;
  world: World;
  panel: DemoPage;
  settings: DemoPage;
  tabCount: number;
  close: () => Promise<void>;
}

// the stage windows keep their curated tabs; every filler window gets the same share of the rest
export function fillerPerWindow(wantedTabs: number): number {
  const stage = WINDOWS.filter((window) => window.stage).reduce((sum, window) => sum + window.tabCount, 0);
  const fillers = WINDOWS.filter((window) => !window.stage).length;
  return Math.max(1, Math.ceil((wantedTabs - stage) / fillers));
}

// `extensionDir`: another build of the extension (a worktree of an older commit) measured with THESE
// scenarios; `browserName`: the browser that runs it (T-0152: Firefox measured like Chrome)
export async function launchWorld(
  wantedTabs: number,
  log: (line: string) => void,
  extensionDir = DEFAULT_EXTENSION_DIR,
  browserName: BrowserName = "chrome",
): Promise<PerfWorld> {
  process.env.DEMO_FILLER = String(fillerPerWindow(wantedTabs)); // buildTabs reads it per call
  const tabs = buildTabs();
  const browser = await launch(extensionDir, tabs, new Map(), browserName, log);
  const world = await buildWorld(browser, tabs, log);
  const panel = await browser.openPanel();
  await panel.setViewportSize(PANEL_VIEWPORT);
  const settings = await browser.openAside(`${browser.extensionOrigin}/options/index.html`, SETTINGS_VIEWPORT);
  await panel.waitForTimeout(1500); // names, badges and counts settle, like the demo does
  return { browser, world, panel, settings: settings.page, tabCount: tabs.length, close: () => browser.close() };
}
