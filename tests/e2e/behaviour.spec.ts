// What only real Chrome can answer. Every other tier runs against tests/helpers/chrome-mock.ts,
// which behaves the way we ASSUME Chrome behaves — these tests check the assumptions that
// fixes and features rest on: a real discard, a real cross-window move, a real tab group,
// a real autoDiscardable flag, real storage. Kept few on purpose; UI behaviour lives in
// tests/browser.
import type { BrowserContext, Page, Worker } from "@playwright/test";
import { expect, test } from "./fixtures.ts";

// Pages the extension treats as ordinary sites (isSupportedUrl wants http/https) without
// touching the network: every *.test request is answered from here.
async function serveFakeSites(context: BrowserContext): Promise<void> {
  await context.route(/^https?:\/\/[a-z-]+\.test\//, (route) => {
    const host = new URL(route.request().url()).hostname;
    return route.fulfill({ contentType: "text/html", body: `<title>${host}</title><h1>${host}</h1>` });
  });
}

async function openSite(context: BrowserContext, host: string): Promise<Page> {
  const page = await context.newPage();
  await page.goto(`http://${host}/`);
  return page;
}

// Playwright cannot open the side-panel surface (issue 26693) — the same page in a tab
// runs the same code against the same APIs.
async function openPanel(context: BrowserContext, extensionId: string): Promise<Page> {
  const panel = await context.newPage();
  await panel.goto(`chrome-extension://${extensionId}/sidepanel/index.html`);
  await expect(panel.locator("#tab-list .row").first()).toBeVisible();
  return panel;
}

const tabByHost = (worker: Worker, host: string) =>
  worker.evaluate(async (wanted) => {
    const tabs = await chrome.tabs.query({});
    return tabs.find((tab) => tab.url?.includes(wanted)) ?? null;
  }, host);

const rowFor = (panel: Page, title: string) => panel.locator("#tab-list .row", { hasText: title });

// FIXME(chromium): cannot run under automation today. A real chrome.tabs.discard() succeeds
// (the call resolves with { discarded: true } and a NEW tab id — Chrome replaces the tab),
// but Playwright's Chromium 153 then segfaults within ~400 ms ("Received signal 11
// SEGV_MAPERR"), headless, even for a tab Playwright never touched — so the badge can never
// be observed. Not an extension bug. Re-enable when a newer Chromium build survives a
// discard; until then the snooze path is covered with the mock (tests/background,
// tests/pages/sidepanel) and by hand.
test.fixme("snoozing from the list really discards the tab and the row shows it", async ({
  context,
  extensionId,
  serviceWorker,
}) => {
  await serveFakeSites(context);
  await openSite(context, "alpha.test");
  const panel = await openPanel(context, extensionId); // panel is now the active tab, alpha is not

  const row = rowFor(panel, "alpha.test");
  await row.hover();
  await row.locator('[data-action="snooze"]').click();

  await expect.poll(async () => (await tabByHost(serviceWorker, "alpha.test"))?.discarded).toBe(true);
  await expect(row.locator(".badge", { hasText: /snoozed/i })).toBeVisible();
});

test("Chrome drops the pin when a tab changes window — the assumption behind the re-pin fix", async ({
  context,
  serviceWorker,
}) => {
  await serveFakeSites(context);
  await openSite(context, "pinned.test");
  const pinned = await serviceWorker.evaluate(async () => {
    const [tab] = (await chrome.tabs.query({})).filter((candidate) => candidate.url?.includes("pinned.test"));
    if (tab?.id === undefined) {
      return null;
    }
    await chrome.tabs.update(tab.id, { pinned: true });
    const other = await chrome.windows.create({ url: "about:blank" });
    await chrome.tabs.move(tab.id, { windowId: other?.id, index: -1 });
    return (await chrome.tabs.get(tab.id)).pinned;
  });
  expect(pinned).toBe(false);
});

test("moving a pinned tab to a new window from the row menu keeps it pinned", async ({
  context,
  extensionId,
  serviceWorker,
}) => {
  await serveFakeSites(context);
  await openSite(context, "keep-pin.test");
  const before = await tabByHost(serviceWorker, "keep-pin.test");
  await serviceWorker.evaluate((id) => chrome.tabs.update(id, { pinned: true }), before?.id ?? -1);
  const panel = await openPanel(context, extensionId);

  // Any tab event re-renders the list, and a re-render closes an open context menu (by
  // design: its tab ids may be stale). Pinning just fired such events, so the menu can
  // vanish mid-sequence — retry the whole gesture until it goes through once.
  await expect(async () => {
    await rowFor(panel, "keep-pin.test").click({ button: "right" });
    await panel.locator("#ctx-menu .ctx-item", { hasText: "Move tab to" }).click({ timeout: 1500 });
    await panel.locator("#ctx-menu .ctx-item", { hasText: "New window" }).click({ timeout: 1500 });
  }).toPass({ timeout: 15_000 });

  await expect
    .poll(async () => {
      const after = await tabByHost(serviceWorker, "keep-pin.test");
      return { moved: after?.windowId !== before?.windowId, pinned: after?.pinned };
    })
    .toEqual({ moved: true, pinned: true });
});

test("quick launch creates a real, named tab group and lists it", async ({ context, extensionId, serviceWorker }) => {
  const panel = await openPanel(context, extensionId);
  await panel.locator("#win-list-btn").click();
  await panel.locator("#windows-pop .win-view", { hasText: "Groups" }).click();
  await panel.locator("#windows-pop .win-row.win-new").click();
  await panel.locator("#windows-pop .rename-input").fill("reading");
  await panel.keyboard.press("Enter");

  await expect
    .poll(() => serviceWorker.evaluate(async () => (await chrome.tabGroups.query({})).map((group) => group.title)))
    .toEqual(["reading"]);
  // the mock never adds a created group to its list — only real Chrome can show this row
  await expect(panel.locator("#windows-pop .win-row[data-tab-group-id] .win-title")).toHaveText(["reading"]);
  await expect(panel.locator("#windows-pop")).toBeVisible(); // stays open after the commit
  const grouped = await serviceWorker.evaluate(async () => {
    const [group] = await chrome.tabGroups.query({});
    return (await chrome.tabs.query({ groupId: group?.id })).length;
  });
  expect(grouped).toBe(1); // exactly the fresh New Tab — no existing tab was pulled in
});

test("protecting a site really sets autoDiscardable on its tabs, and unprotecting clears it", async ({
  context,
  extensionId,
  serviceWorker,
}) => {
  await serveFakeSites(context);
  await openSite(context, "bank.test");
  const panel = await openPanel(context, extensionId);
  const row = rowFor(panel, "bank.test");
  const autoDiscardable = async () => (await tabByHost(serviceWorker, "bank.test"))?.autoDiscardable;
  expect(await autoDiscardable()).toBe(true);

  await row.hover();
  await row.locator('[data-action="toggle-protect"]').click();
  await expect.poll(autoDiscardable).toBe(false);
  const rules = await serviceWorker.evaluate(
    async () => (await chrome.storage.local.get("protectionRules")).protectionRules,
  );
  expect(rules).toEqual([expect.objectContaining({ type: "host", pattern: "bank.test" })]);

  await row.hover();
  await row.locator('[data-action="toggle-protect"]').click();
  await expect.poll(autoDiscardable).toBe(true);
});

test("a setting changed in options persists across a reload and reaches an open side panel", async ({
  context,
  extensionId,
}) => {
  const panel = await openPanel(context, extensionId);
  const options = await context.newPage();
  await options.goto(`chrome-extension://${extensionId}/options/index.html`);

  await expect(options.locator("#excludePinned")).toBeChecked(); // default
  await options.locator("#excludePinned").uncheck();
  await options.locator("#density").selectOption("compact");
  await expect(options.locator("#saved")).toBeVisible();

  await expect(panel.locator("#tab-list")).toHaveClass(/compact/); // storage.onChanged → live refresh

  await options.reload();
  await expect(options.locator("#excludePinned")).not.toBeChecked();
  await expect(options.locator("#density")).toHaveValue("compact");
});
