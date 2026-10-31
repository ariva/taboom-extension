// Round 3 replication attempts for the four "suspected" items: what only real Chrome can answer.
// Each test states the invariant the code should hold; a failure here is the bug reproduced.
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { type BrowserContext, chromium, expect, type Page, test as base, type Worker } from "@playwright/test";
import { test } from "./fixtures.ts";

const EXTENSION_DIR = resolve(import.meta.dirname, "../../dist/prod");

async function serveFakeSites(context: BrowserContext, hits?: Map<string, number>): Promise<void> {
  await context.route(/^https?:\/\/[a-z0-9-]+\.test\//, (route) => {
    const host = new URL(route.request().url()).hostname;
    if (hits && route.request().resourceType() === "document") {
      hits.set(host, (hits.get(host) ?? 0) + 1);
    }
    return route.fulfill({ contentType: "text/html", body: `<title>${host}</title><h1>${host}</h1>` });
  });
}

async function openPanel(context: BrowserContext, extensionId: string): Promise<Page> {
  const panel = await context.newPage();
  await panel.goto(`chrome-extension://${extensionId}/sidepanel/index.html`);
  await expect(panel.locator("#tab-list .row").first()).toBeVisible();
  return panel;
}

// 1. A restore consumes the snapshot by position after a multi-second open: a parked tab removed
// elsewhere meanwhile shifts the positions — the refused address must still be the one left parked
test("parked restore racing a removal from the same snapshot keeps exactly the refused tab", async ({
  context,
  extensionId,
  serviceWorker,
}) => {
  await serveFakeSites(context);
  const panel = await openPanel(context, extensionId);
  // 30 tabs: tabs.create resolves in ~10 ms each, so the restore takes a few hundred ms — the
  // window in which another surface can edit the same snapshot
  const tabs = Array.from({ length: 30 }, (_, i) => (i === 15 ? "refused" : `r${i}`)).map((name) => ({
    // javascript: is a scheme tabs.create refuses ("Cannot navigate to a javascript URL"); file:// is not — it opens blocked
    url: name === "refused" ? "javascript:void%200" : `http://${name}.test/`,
    title: name,
  }));
  await serviceWorker.evaluate((parked) => chrome.storage.local.set({ parkedWindows: [parked], parkedTrash: [] }), {
    id: "p-race",
    parkedAt: Date.now(),
    tabs,
    groups: [],
  });
  const restored = panel.evaluate(() => chrome.runtime.sendMessage({ type: "restore-parked", id: "p-race" }));
  await panel.waitForTimeout(60); // the restore has read the snapshot and is opening tabs one by one
  // another surface removes the first parked tab from the same snapshot
  const stillThere = await serviceWorker.evaluate(async () => {
    const { parkedWindows = [] } = (await chrome.storage.local.get("parkedWindows")) as {
      parkedWindows?: { tabs: { url: string }[] }[];
    };
    const parked = parkedWindows[0];
    if (!parked || parked.tabs.length < 30) {
      return false; // the restore already consumed it: the race window was missed
    }
    parked.tabs = parked.tabs.slice(1);
    await chrome.storage.local.set({ parkedWindows });
    return true;
  });
  expect(stillThere, "the removal landed while the restore was still opening tabs").toBe(true);
  await restored;
  const left = await serviceWorker.evaluate(async () => {
    const { parkedWindows = [] } = (await chrome.storage.local.get("parkedWindows")) as {
      parkedWindows?: { tabs: { title: string }[] }[];
    };
    return parkedWindows.flatMap((parked) => parked.tabs.map((tab) => tab.title));
  });
  expect(left, "the refused address stays parked; nothing that opened does").toEqual(["refused"]);
});

// 2. Browser shutdown: the panel ports disconnect while the worker may still be alive — does the
// disconnect handler clear panelOpen, so that a restart has nothing to offer?
base("a panel open at browser shutdown is still marked open after the restart", async () => {
  const dir = mkdtempSync(join(tmpdir(), "mv3-restart-"));
  const launch = () =>
    chromium.launchPersistentContext(dir, {
      channel: "chromium",
      args: [`--disable-extensions-except=${EXTENSION_DIR}`, `--load-extension=${EXTENSION_DIR}`],
    });
  const worker = async (context: BrowserContext): Promise<Worker> =>
    context.serviceWorkers()[0] ?? (await context.waitForEvent("serviceworker"));
  const openProfiles = (sw: Worker) =>
    sw.evaluate(async () => {
      const { windowProfiles = {} } = await chrome.storage.local.get("windowProfiles");
      return Object.values(windowProfiles as Record<string, { panelOpen?: boolean }>).filter((p) => p.panelOpen).length;
    });

  const first = await launch();
  const sw1 = await worker(first);
  const extensionId = sw1.url().split("/")[2];
  const panel = await first.newPage();
  await panel.goto(`chrome-extension://${extensionId}/sidepanel/index.html`);
  await expect.poll(() => openProfiles(sw1), { timeout: 10_000 }).toBeGreaterThan(0);
  await first.close(); // the browser quits with the panel open

  const second = await launch();
  try {
    const sw2 = await worker(second);
    await sw2.evaluate(() => new Promise((resolve) => setTimeout(resolve, 1500))); // the restart pass
    expect(await openProfiles(sw2), "the restart finds the panel's window still marked open").toBeGreaterThan(0);
  } finally {
    await second.close();
  }
});

// 3. A sweep alarm due at browser start and the startup stagger both read the mark list: with no
// write chain the page just reloaded can be re-timed to reload again within a minute.
// FIXME(playwright): a relaunched persistent context restores no tabs, so nothing exists for the
// startup sweep to reload and the race has no observable here (0 hits in 75 s, twice). The worker
// now runs both writers on one chain (tests/background covers the ordering); kept as the recipe.
base.fixme("marks overdue across a restart reload once, not twice within a minute", async () => {
  base.setTimeout(120_000);
  const dir = mkdtempSync(join(tmpdir(), "mv3-ka-"));
  const launch = () =>
    chromium.launchPersistentContext(dir, {
      channel: "chromium",
      args: [`--disable-extensions-except=${EXTENSION_DIR}`, `--load-extension=${EXTENSION_DIR}`],
    });
  const worker = async (context: BrowserContext): Promise<Worker> =>
    context.serviceWorkers()[0] ?? (await context.waitForEvent("serviceworker"));

  const first = await launch();
  await serveFakeSites(first);
  const sw1 = await worker(first);
  for (const host of ["ka-one.test", "ka-two.test"]) {
    const page = await first.newPage();
    await page.goto(`http://${host}/`);
  }
  await sw1.evaluate(async () => {
    const past = Date.now() - 60_000;
    await chrome.storage.local.set({
      keepAlive: [
        { url: "http://ka-one.test/", title: "one", minutes: 20, nextReload: past },
        { url: "http://ka-two.test/", title: "two", minutes: 20, nextReload: past - 1000 },
      ],
    });
  });
  await sw1.evaluate(() => new Promise((resolve) => setTimeout(resolve, 1500))); // the alarm is armed by the storage reaction
  await first.close();

  const second = await launch();
  const hits = new Map<string, number>();
  await serveFakeSites(second, hits);
  try {
    await worker(second);
    await new Promise((resolve) => setTimeout(resolve, 75_000)); // the stagger window is 30–60 s
    for (const host of ["ka-one.test", "ka-two.test"]) {
      // the startup stagger reloads an overdue mark once within 30–60 s; a second hit inside the
      // window is the sweep alarm racing it. 0 hits = the alarm never fired here: inconclusive
      expect(hits.get(host) ?? 0, `${host} reloaded once after the restart (got ${hits.get(host) ?? 0})`).toBe(1);
    }
  } finally {
    await second.close();
  }
});
