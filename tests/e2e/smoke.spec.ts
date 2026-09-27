import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures.ts";

const { version } = JSON.parse(readFileSync(resolve(import.meta.dirname, "../../package.json"), "utf8"));

function collectErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(`pageerror: ${error.message}`));
  page.on("console", (message) => {
    if (message.type() === "error") {
      errors.push(`console: ${message.text()}`);
    }
  });
  return errors;
}

test("service worker registers and reports the packaged version", async ({ serviceWorker }) => {
  const manifest = await serviceWorker.evaluate(() => chrome.runtime.getManifest());
  expect(manifest.version).toBe(version);
  expect(manifest.manifest_version).toBe(3);
});

test("side panel page boots against the real chrome.* and lists open tabs", async ({ context, extensionId }) => {
  const tab = await context.newPage();
  await tab.goto("data:text/html,<title>Hello E2E</title><p>hi</p>");

  // Playwright cannot open the side-panel surface itself (issue 26693) — the same page
  // as a tab runs the same code with the same APIs
  const panel = await context.newPage();
  const errors = collectErrors(panel);
  await panel.goto(`chrome-extension://${extensionId}/sidepanel/index.html`);
  await expect(panel.locator("#tab-list .row").first()).toBeVisible();
  await expect(panel.locator("#tab-list")).toContainText("Hello E2E");
  expect(errors).toEqual([]);
});

test("options page boots and shows the release notes", async ({ context, extensionId }) => {
  const options = await context.newPage();
  const errors = collectErrors(options);
  await options.goto(`chrome-extension://${extensionId}/options/index.html`);
  await expect(options.locator("h1")).toContainText("Taboom");
  // CHANGES.md is fetched through chrome.runtime.getURL — proves the static file shipped.
  // (Between releases the newest entry is the previous version, so match any heading.)
  await expect(options.locator("#whats-new")).toContainText(/v\d+\.\d+\.\d+ — \d{4}-\d{2}-\d{2}/);
  expect(errors).toEqual([]);
});

test("the extension makes zero network requests", async ({ context, extensionId, networkRequests }) => {
  const panel = await context.newPage();
  await panel.goto(`chrome-extension://${extensionId}/sidepanel/index.html`);
  await expect(panel.locator("#tab-list .row").first()).toBeVisible();
  const options = await context.newPage();
  await options.goto(`chrome-extension://${extensionId}/options/index.html`);
  await expect(options.locator("h1")).toBeVisible();
  expect(networkRequests).toEqual([]);
});
