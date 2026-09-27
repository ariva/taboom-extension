// Shared UI-test harness: happy-dom window loaded with a real page's HTML
// plus a minimal chrome.* stub. Each test file gets its own node process
// (node --test), so one setup per file is safe.
import { readFileSync } from "node:fs";
import { Window } from "happy-dom";
import { applyExperimental } from "../../src/app/core.ts";
import type { Features, LocalStorageSchema, SessionStorageSchema } from "../../src/app/types.ts";
import {
  type ChromeMockOptions,
  type ChromeMock as GenericChromeMock,
  makeChrome as makeChromeMock,
} from "./chrome-mock.ts";

/** the shared mock, bound to Taboom's storage schemas: storage.*.get() reads known keys back typed */
export type ChromeMock = GenericChromeMock<LocalStorageSchema, SessionStorageSchema>;

// THE one cast of this harness. happy-dom's Window / Document / Event classes and the
// stubs below are deliberately NOT the DOM lib's types (they implement the slice the pages
// use), so the globals the page scripts read are assigned through this view of globalThis.
const globals = globalThis as unknown as {
  window: Window;
  document: Window["document"];
  matchMedia: Window["matchMedia"];
  Event: Window["Event"];
  KeyboardEvent: Window["KeyboardEvent"];
  confirm: () => boolean;
  chrome: ChromeMock;
  fetch: (url: unknown) => Promise<{ json: () => Promise<Features> } | { text: () => Promise<string> }>;
};

// calls: flat log of stubbed chrome calls, e.g. ["tabs.reload 3", "storage.set {...}"]
// tests fetch the real features.json (single source of truth for flags)
const featuresJson = readFileSync(new URL("../../features.json", import.meta.url), "utf8");

// The suite runs three times (see justfile):
//  1. flags as shipped;
//  2. TEST_EXPERIMENTAL=1 — experimental flags count as enabled, so
//     experimental functionality is tested, not skipped until promotion
//     (makeChrome injects ui.showExperimental so the code under test resolves
//     the flags the same way the skip decisions do);
//  3. TEST_ALL_DISABLED=1 — every flag off, proving disabled-state behavior
//     (the fetch stub serves the disabled set to the code under test).
export const TEST_EXPERIMENTAL = process.env.TEST_EXPERIMENTAL === "1";
export const TEST_ALL_DISABLED = process.env.TEST_ALL_DISABLED === "1";
export const RAW_FEATURES: Features = (() => {
  const parsed: Features = JSON.parse(featuresJson);
  if (TEST_ALL_DISABLED) {
    for (const value of Object.values(parsed)) {
      value.enabled = false;
    }
  }
  return parsed;
})();
export const TEST_FEATURES: Features = applyExperimental(RAW_FEATURES, TEST_EXPERIMENTAL);

const changesMd = readFileSync(new URL("../../CHANGES.md", import.meta.url), "utf8");

globals.fetch = async (url) => {
  if (String(url).endsWith("features.json")) {
    return { json: async () => structuredClone(RAW_FEATURES) };
  }
  if (String(url).endsWith("CHANGES.md")) {
    return { text: async () => changesMd };
  }
  throw new Error(`unmocked fetch ${url}`);
};

// the shared mock, bound to this run's flag scenario
export function makeChrome(options: Omit<ChromeMockOptions, "experimental">): ChromeMock {
  return makeChromeMock<LocalStorageSchema, SessionStorageSchema>({ ...options, experimental: TEST_EXPERIMENTAL });
}

// Loads <page>/index.html into a happy-dom window and exposes the globals
// the page scripts expect. Import the page script AFTER calling this.
export function loadPage(htmlPath: string, chrome: ChromeMock): Window {
  // repo-root-relative ("src/pages/sidepanel/index.html") — a test file can move without breaking it
  const htmlUrl = new URL(htmlPath, new URL("../../", import.meta.url));
  const html = readFileSync(htmlUrl, "utf8")
    .replace(/<script[^>]*><\/script>/, "") // page script is imported manually
    // inline real stylesheets so tests can assert COMPUTED styles — an attribute
    // like [hidden] can be overridden by author CSS, and attribute-only asserts
    // miss that (see the bulk-bar / collapse-all always-visible regression)
    .replace(/<link rel="stylesheet" href="([^"]+)" \/>/g, (_, href: string) => {
      return `<style>${readFileSync(new URL(href, htmlUrl), "utf8")}</style>`;
    });
  const window = new Window();
  window.document.write(html);
  if (!window.HTMLElement.prototype.scrollIntoView) {
    window.HTMLElement.prototype.scrollIntoView = () => {};
  }
  globals.window = window;
  globals.document = window.document;
  globals.matchMedia = window.matchMedia.bind(window);
  globals.Event = window.Event; // page code dispatches synthetic events (custom dropdown)
  globals.KeyboardEvent = window.KeyboardEvent; // page code cancels a rename with a synthetic Esc
  globals.confirm = () => true;
  globals.chrome = chrome;
  return window;
}

export const tick = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));
