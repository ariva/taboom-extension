// Boots the BUILT extension in a headless browser for the demo and the performance tier: Chromium
// through Playwright here, Firefox through demo/firefox/ (Playwright cannot load an extension into
// Firefox — T-0152). Both serve the fake sites from one local HTTP server and refuse every other
// request. Same recipe as tests/e2e/fixtures.ts, with one difference that matters: Playwright's
// default `--no-sandbox` makes Chromium 153 crash on chrome.tabs.discard (the e2e FIXME) —
// leaving the sandbox on keeps every discard alive.
import { mkdtempSync, rmSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type BrowserContext, chromium, type Page, type Worker } from "@playwright/test";
import { type DemoTab, pageHtml } from "./fixture.ts";
import { FirefoxBrowser } from "./firefox/browser.ts";
import type { Aside, BrowserName, DemoBrowser, DemoPage, FrameRecorder, Size, Stream } from "./page-api.ts";
import { PlaywrightPage } from "./playwright-page.ts";
import { Recorder } from "./recorder.ts";
import { WINDOW_VIEWPORT } from "./world.ts";

export { buildWorld, WINDOW_VIEWPORT, type World } from "./world.ts";
export type { DemoBrowser as Browser } from "./page-api.ts";

// the panel film: the 600×820 app plus a band below it where the captions go (stage.ts
// paints them there, never over the panel); stills clip the band away
export const CAPTION_BAND = 72;
export const PANEL_VIEWPORT = { width: 600, height: 820 + CAPTION_BAND };
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
// fire their first request before it does. Chromium: two flags make every *.test host land on
// the server while the urls stay clean (`http://docs.example.test/...`, no port in sight).
// Firefox: a PAC proxy sends EVERY request here — a proxied request arrives with its absolute
// url; anything outside *.test is refused and remembered (`blocked`).
// `pages` are whole pages by url (the story pane); every other url is a fake site.
async function serveFakeSites(
  tabs: DemoTab[],
  pages: Map<string, string>,
  blocked: string[],
): Promise<{ server: Server; port: number }> {
  const server = createServer((request, response) => {
    const requested = request.url ?? "/";
    const url = requested.startsWith("http")
      ? requested
      : `http://${request.headers.host ?? "unknown.test"}${requested}`;
    if (!new URL(url).hostname.endsWith(".test")) {
      blocked.push(url);
      response.statusCode = 404;
      response.end("refused: the demo makes no network requests");
      return;
    }
    response.setHeader("content-type", "text/html; charset=utf-8");
    response.end(pages.get(url) ?? pageHtml(url, tabs));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  return { server, port: (server.address() as AddressInfo).port }; // listen(0): the OS picked the port
}

export async function launch(
  extensionDir: string,
  tabs: DemoTab[],
  pages: Map<string, string>,
  browser: BrowserName = "chrome",
  log: (line: string) => void = () => {},
): Promise<DemoBrowser> {
  const blocked: string[] = [];
  const { server, port } = await serveFakeSites(tabs, pages, blocked);
  const stopServer = () => server.close();
  if (browser === "firefox") {
    const firefox = await FirefoxBrowser.launch(
      { extensionDir, proxyPort: port, devicePixelRatio: DEVICE_SCALE, log },
      blocked,
    );
    const close = firefox.close.bind(firefox);
    firefox.close = async () => {
      await close();
      stopServer();
    };
    return firefox;
  }
  return ChromiumBrowser.launch(extensionDir, port, blocked, stopServer);
}

export class ChromiumBrowser implements DemoBrowser {
  readonly name = "chrome" as const;
  readonly context: BrowserContext;
  readonly playwrightWorker: Worker;
  readonly extensionId: string;
  readonly extensionOrigin: string;
  readonly blocked: string[];
  readonly worker: DemoBrowser["worker"];
  private readonly profile: string;
  private readonly stopServer: () => void;
  private readonly wrapped = new Map<Page, PlaywrightPage>();

  private constructor(
    context: BrowserContext,
    worker: Worker,
    extensionId: string,
    blocked: string[],
    profile: string,
    stopServer: () => void,
  ) {
    this.context = context;
    this.playwrightWorker = worker;
    this.extensionId = extensionId;
    this.extensionOrigin = `chrome-extension://${extensionId}`;
    this.blocked = blocked;
    this.profile = profile;
    this.stopServer = stopServer;
    // Playwright types the argument as Unboxed<Arg> (handles unwrapped); the demo passes plain data,
    // so the Evaluator's function is such a function — the cast names Playwright's own parameter type
    this.worker = {
      evaluate: <Result, Arg>(fn: (arg: Arg) => Result | Promise<Result>, arg?: Arg) =>
        worker.evaluate(fn as unknown as Parameters<Worker["evaluate"]>[0], arg) as Promise<Result>,
    };
  }

  static async launch(
    extensionDir: string,
    port: number,
    blocked: string[],
    stopServer: () => void,
  ): Promise<ChromiumBrowser> {
    const profile = mkdtempSync(join(tmpdir(), "taboom-demo-"));
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
        // no --mute-audio: with it Chromium never reports a tab as audible, and the tab-audio scene
        // films exactly that. The one sound of the world is that scene's tone, at -54 dBFS (fixture.ts)
        // the tone starts with no click on the page (a background tab gets none)
        "--autoplay-policy=no-user-gesture-required",
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
    await context.route(/^(https?|wss?):\/\/(?![a-z0-9.-]+\.test\/)/, (route) => {
      blocked.push(route.request().url());
      return route.abort("blockedbyclient");
    });
    const worker = await extensionWorker(context);
    const extensionId = worker.url().split("/")[2] ?? "";
    if (!extensionId) {
      throw new Error(`cannot read the extension id from ${worker.url()}`);
    }
    return new ChromiumBrowser(context, worker, extensionId, blocked, profile, stopServer);
  }

  wrap(page: Page): PlaywrightPage {
    let wrapped = this.wrapped.get(page);
    if (!wrapped) {
      wrapped = new PlaywrightPage(page);
      this.wrapped.set(page, wrapped);
    }
    return wrapped;
  }

  pages(): DemoPage[] {
    return this.context.pages().map((page) => this.wrap(page));
  }

  onPage(listener: (page: DemoPage) => void): void {
    this.context.on("page", (page) => listener(this.wrap(page)));
  }

  // the side panel page in a tab of the first (otherwise empty) window: Playwright cannot open
  // the real side panel surface, the same page runs the same code (tests/e2e does the same)
  async openPanel(): Promise<DemoPage> {
    const [first] = this.context.pages();
    const page = first ?? (await this.context.newPage());
    // Playwright dismisses native confirm() dialogs by default — the panel's bulk confirmations
    // (Cleanup Duplicates, closing several tabs) must go through
    page.on("dialog", (dialog) => {
      dialog.accept().catch(() => {});
    });
    await page.setViewportSize(PANEL_VIEWPORT);
    await page.goto(`${this.extensionOrigin}/sidepanel/index.html`);
    await page.locator("#tab-list .row").first().waitFor({ state: "visible", timeout: 30_000 });
    return this.wrap(page);
  }

  // a page of its own window, sized for its slot in the composite: the story pane and the
  // Settings page. Its window and tab are hidden from the panel by the overlay (stage.ts). Found
  // by url among the pages that did not exist before — the filmed panel has the second panel's url
  async openAside(url: string, size: Size): Promise<Aside> {
    const before = new Set(this.context.pages());
    const pageShown = this.context.waitForEvent("page", {
      predicate: (page) => !before.has(page) && page.url() === url,
      timeout: 15_000,
    });
    const ids = await this.playwrightWorker.evaluate(
      async ({ url, size }) => {
        const created = await chrome.windows.create({ url, focused: false, type: "popup", ...size });
        return { windowId: created?.id ?? -1, tabId: created?.tabs?.[0]?.id ?? -1 };
      },
      { url, size },
    );
    const page =
      this.context.pages().find((candidate) => !before.has(candidate) && candidate.url() === url) ?? (await pageShown);
    await page.setViewportSize(size);
    await page.waitForLoadState("domcontentloaded");
    return { page: this.wrap(page), ...ids };
  }

  recorder(
    outDir: string,
    streamOfUrl: (url: string) => Stream | undefined,
    activeUrls: () => Promise<Set<string>>,
  ): FrameRecorder {
    return new Recorder(this.context, outDir, streamOfUrl, activeUrls);
  }

  // one wheel-like gesture down the list, through the DevTools protocol (trusted input)
  async scrollGesture(page: DemoPage, distance: number): Promise<void> {
    const inner = (page as PlaywrightPage).inner; // `as`: this browser hands out PlaywrightPages only
    const box = await inner.locator("#tab-list").boundingBox();
    if (!box) {
      throw new Error("no #tab-list to scroll");
    }
    const cdp = await this.context.newCDPSession(inner);
    try {
      await cdp.send("Input.synthesizeScrollGesture", {
        x: box.x + box.width / 2,
        y: box.y + box.height / 2,
        yDistance: -distance,
        speed: 2400,
      });
    } finally {
      await cdp.detach();
    }
  }

  async close(): Promise<void> {
    await this.context.close();
    this.stopServer();
    rmSync(this.profile, { recursive: true, force: true });
  }
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
