// Generic MV3 fixture: persistent Chromium context with one unpacked extension loaded.
// `channel: "chromium"` is what lets extensions run headless (Playwright docs).
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { test as base, chromium, type BrowserContext, type Worker } from "@playwright/test";

const EXTENSION_DIR = resolve(import.meta.dirname, "../../dist/prod");

interface ExtensionFixtures {
  context: BrowserContext;
  serviceWorker: Worker;
  extensionId: string;
  /** every http(s)/ws request any page or the worker attempted */
  networkRequests: string[];
}

export const test = base.extend<ExtensionFixtures>({
  // biome-ignore lint/correctness/noEmptyPattern: Playwright fixtures require the object-destructuring form
  context: async ({}, use) => {
    const context = await chromium.launchPersistentContext(mkdtempSync(join(tmpdir(), "mv3-e2e-")), {
      channel: "chromium",
      args: [`--disable-extensions-except=${EXTENSION_DIR}`, `--load-extension=${EXTENSION_DIR}`],
    });
    await use(context);
    await context.close();
  },
  serviceWorker: async ({ context }, use) => {
    const [existing] = context.serviceWorkers();
    await use(existing ?? (await context.waitForEvent("serviceworker")));
  },
  extensionId: async ({ serviceWorker }, use) => {
    // chrome-extension://<id>/background/service-worker.js
    const id = serviceWorker.url().split("/")[2];
    if (!id) {
      throw new Error(`cannot read extension id from ${serviceWorker.url()}`);
    }
    await use(id);
  },
  networkRequests: async ({ context }, use) => {
    const seen: string[] = [];
    context.on("request", (request) => {
      if (/^(https?|wss?):/.test(request.url())) {
        seen.push(request.url());
      }
    });
    await use(seen);
  },
});

export { expect } from "@playwright/test";
