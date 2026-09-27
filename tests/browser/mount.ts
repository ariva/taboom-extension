// Mounts the REAL side panel (its HTML, CSS and entry module) inside the test page of
// Vitest Browser Mode, against the shared chrome.* mock. Real Chromium means real focus,
// blur order, click targeting, popovers and <dialog> — what happy-dom cannot judge.
// One mount per test file: the panel entry is a module-level singleton, and Browser Mode
// gives every test file its own page.
import features from "../../features.json";
import panelHtml from "../../src/pages/sidepanel/index.html?raw";
import "../../src/styles/common.css";
import "../../src/pages/sidepanel/sidepanel.css";
import { type ChromeMock, type ChromeMockOptions, makeChrome } from "../helpers/chrome-mock.ts"; // shared with the happy-dom tier

export type { ChromeMock };
export type Fixture = Pick<ChromeMockOptions, "tabs" | "groups" | "stored">;

export interface MountedPanel {
  /** flat log of stubbed chrome calls, e.g. "tabs.group 1000 new" */
  calls: string[];
  /** the mock itself — fire events, wrap methods (e.g. add latency to tabs.create) */
  chrome: ChromeMock;
}

export const NOW = Date.now();

export const DEFAULT_FIXTURE: Fixture = {
  tabs: [
    {
      id: 1,
      windowId: 1,
      index: 0,
      active: true,
      discarded: false,
      pinned: false,
      audible: false,
      url: "https://github.com/pr/1",
      title: "My Pull Request",
      lastAccessed: NOW,
    },
    {
      id: 2,
      windowId: 1,
      index: 1,
      active: false,
      discarded: true,
      pinned: false,
      audible: false,
      url: "https://youtube.com/watch",
      title: "Some Video",
      lastAccessed: NOW - 3_600_000,
    },
    {
      id: 3,
      windowId: 2,
      index: 0,
      active: true,
      discarded: false,
      pinned: true,
      audible: false,
      url: "https://mail.google.com/inbox",
      title: "Inbox",
      lastAccessed: NOW - 60_000,
    },
  ],
  groups: [
    { id: 7, title: "work", color: "blue", collapsed: false, windowId: 1 },
    { id: 8, title: "alpha", color: "red", collapsed: false, windowId: 2 },
  ],
};

export async function mountSidePanel(fixture: Fixture = DEFAULT_FIXTURE): Promise<MountedPanel> {
  const calls: string[] = [];
  const mock = makeChrome({ ...structuredClone(fixture), calls });
  // extension root = dev-server root; absolute because page code feeds it to new URL()
  mock.runtime.getURL = (path: string) => new URL(path, `${location.origin}/`).href;
  Object.defineProperty(globalThis, "chrome", { value: mock, configurable: true, writable: true });

  const realFetch = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    if (String(input).endsWith("features.json")) {
      return new Response(JSON.stringify(features));
    }
    return realFetch(input, init);
  };

  const parsed = new DOMParser().parseFromString(panelHtml, "text/html");
  for (const node of parsed.querySelectorAll("script, link")) {
    node.remove();
  }
  document.body.innerHTML = parsed.body.innerHTML;

  await import("../../src/pages/sidepanel/main.ts");
  await settle();
  return { calls, chrome: mock };
}

/** let debounced renders / refresh chains finish */
export function settle(ms = 250): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export const popover = () => document.getElementById("windows-pop") as HTMLElement;
export const popoverOpen = () => popover().matches(":popover-open");

export function byText<T extends HTMLElement>(selector: string, prefix: string): T {
  const found = [...document.querySelectorAll<T>(selector)].find((node) =>
    (node.textContent ?? "").trim().startsWith(prefix),
  );
  if (!found) {
    throw new Error(`no ${selector} starting with "${prefix}"`);
  }
  return found;
}
