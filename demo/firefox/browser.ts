// Firefox for the demo and the performance tier (T-0152). Playwright cannot load an extension
// into Firefox, so this speaks to a real Firefox itself over WebDriver BiDi: a fresh profile
// whose prefs pin the extension's internal UUID (a stable moz-extension:// origin — the trick
// web-ext uses), send every request through a PAC proxy to the fake-site server (zero network,
// like Chromium's --host-resolver-rules) and set the device scale; webExtension.install for the
// built add-on; the panel page in a tab (MOZ_REMOTE_ALLOW_SYSTEM_ACCESS lets BiDi navigate to
// moz-extension://); then BiDi for everything else.
import { type ChildProcess, spawn } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { GECKO_ID } from "../../src/manifest.ts";
import type { Aside, DemoBrowser, DemoPage, FrameRecorder, Size, Stream } from "../page-api.ts";
import { FirefoxPage } from "./page.ts";
import { BidiClient, BidiError } from "./protocol.ts";
import { FirefoxRecorder } from "./recorder.ts";

// the extension's internal UUID: preset, so the panel url is known before Firefox starts
const EXTENSION_UUID = "6f1b9c1e-0f2a-4c3b-9d4e-5a6b7c8d9e0f";

export interface FirefoxLaunchOptions {
  extensionDir: string;
  proxyPort: number; // the fake-site server; every request of the browser goes there
  devicePixelRatio: number; // the film's scale: Firefox renders every page at it (layout.css.devPixelsPerPx)
  log: (line: string) => void;
}

interface Context {
  context: string;
  url: string;
  parent?: string | null;
}

function userPrefs(proxyPort: number, devicePixelRatio: number): string {
  const prefs: Record<string, string | number | boolean> = {
    "extensions.webextensions.uuids": JSON.stringify({ [GECKO_ID]: EXTENSION_UUID }),
    // every host through the fake-site server: *.test is served, anything else refused there
    "network.proxy.type": 2,
    "network.proxy.autoconfig_url": `data:text/plain,function FindProxyForURL(url, host){ return "PROXY 127.0.0.1:${proxyPort}"; }`,
    "network.proxy.allow_hijacking_localhost": true,
    // BiDi cannot emulate a device scale on an extension page (privileged scope): the browser renders at it
    "layout.css.devPixelsPerPx": String(devicePixelRatio),
    "remote.active-protocols": 1, // WebDriver BiDi
    // the tab-audio scene's page starts its tone with no click on it (a background tab gets none)
    "media.autoplay.default": 0,
    "media.autoplay.blocking_policy": 0,
    "browser.shell.checkDefaultBrowser": false,
    "browser.startup.page": 0,
    "browser.startup.homepage": "about:blank",
    "browser.newtabpage.enabled": false,
    "browser.aboutwelcome.enabled": false,
    "browser.tabs.warnOnClose": false,
    "browser.sessionstore.resume_from_crash": false,
    "dom.disable_beforeunload": true,
    "datareporting.policy.dataSubmissionEnabled": false,
    "toolkit.telemetry.enabled": false,
    "app.update.enabled": false,
    "app.update.auto": false,
    "extensions.update.enabled": false,
    "extensions.getAddons.cache.enabled": false,
    "browser.search.update": false,
    "browser.region.network.url": "",
  };
  return Object.entries(prefs)
    .map(([key, value]) => `user_pref(${JSON.stringify(key)}, ${JSON.stringify(value)});`)
    .join("\n");
}

// the system Firefox, else Playwright's build (npx playwright install firefox)
export function firefoxBinary(): string {
  if (process.env.FIREFOX_BIN) {
    return process.env.FIREFOX_BIN;
  }
  for (const candidate of ["/usr/bin/firefox", "/usr/lib/firefox/firefox", "/usr/bin/firefox-esr"]) {
    if (existsSync(candidate)) {
      return candidate;
    }
  }
  return "firefox";
}

export class FirefoxBrowser implements DemoBrowser {
  readonly name = "firefox" as const;
  readonly extensionOrigin = `moz-extension://${EXTENSION_UUID}`;
  readonly blocked: string[];
  worker: FirefoxPage; // the panel page: an extension page sees the same chrome.* as the worker
  private readonly process: ChildProcess;
  private readonly profile: string;
  private readonly bidi: BidiClient;
  readonly known = new Map<string, FirefoxPage>();
  private readonly pageListeners: ((page: DemoPage) => void)[] = [];
  private recorderInstance: FirefoxRecorder | undefined;

  private constructor(process: ChildProcess, profile: string, bidi: BidiClient, panel: FirefoxPage, blocked: string[]) {
    this.process = process;
    this.profile = profile;
    this.bidi = bidi;
    this.worker = panel;
    this.blocked = blocked;
    this.known.set(panel.context, panel);
  }

  static async launch(options: FirefoxLaunchOptions, blocked: string[]): Promise<FirefoxBrowser> {
    const profile = mkdtempSync(join(tmpdir(), "taboom-firefox-"));
    writeFileSync(join(profile, "user.js"), userPrefs(options.proxyPort, options.devicePixelRatio));
    const child = spawn(
      firefoxBinary(),
      ["--headless", "--no-remote", "--remote-debugging-port", "0", "--profile", profile, "about:blank"],
      // system access: BiDi may then open and drive the extension's own pages (privileged scope)
      { stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, MOZ_REMOTE_ALLOW_SYSTEM_ACCESS: "1" } },
    );
    let output = "";
    child.stdout?.on("data", (chunk) => {
      output += chunk;
    });
    child.stderr?.on("data", (chunk) => {
      output += chunk;
    });
    // --remote-debugging-port 0: Firefox picks the port and writes it next to the profile
    const serverFile = join(profile, "WebDriverBiDiServer.json");
    const ready = await waitFor(() => existsSync(serverFile), 30_000);
    if (!ready) {
      child.kill();
      throw new BidiError(`Firefox did not start its remote agent:\n${output.slice(-2000)}`);
    }
    const { ws_host, ws_port } = JSON.parse(readFileSync(serverFile, "utf8")) as { ws_host: string; ws_port: number };
    const bidi = await BidiClient.connect(`ws://${ws_host}:${ws_port}/session`);
    // confirm() dialogs are accepted (bulk close, cleanup) — Playwright's Chromium path does the same
    await bidi.send("session.new", { capabilities: { alwaysMatch: { unhandledPromptBehavior: "accept" } } });
    await bidi.send("session.subscribe", {
      events: [
        "browsingContext.contextCreated",
        "browsingContext.contextDestroyed",
        "browsingContext.navigationStarted",
      ],
    });
    await bidi.send("webExtension.install", { extensionData: { type: "path", path: options.extensionDir } });
    const { contexts } = (await bidi.send("browsingContext.getTree", {})) as { contexts: Context[] };
    const first = contexts[0];
    if (!first) {
      child.kill();
      throw new BidiError("Firefox opened no window");
    }
    // The tab BiDi navigates to the extension never gets the focus (headless Firefox keeps it on the
    // chrome side after a programmatic navigation), and an unfocused window gets no focus/blur
    // events — the inline edits commit on blur. So that tab only bootstraps: the extension opens
    // the real panel page into a popup window of its own (a window the extension opens does take
    // the focus, and windows.update brings it back), and the bootstrap window is closed.
    const panelUrl = `moz-extension://${EXTENSION_UUID}/sidepanel/index.html`;
    await bidi.send("browsingContext.navigate", { context: first.context, url: panelUrl, wait: "complete" });
    const bootstrap = new FirefoxPage(bidi, first.context, panelUrl);
    const browser = new FirefoxBrowser(child, profile, bidi, bootstrap, blocked);
    browser.trackContexts();
    const bootstrapWindow = await bootstrap.evaluate(async () => (await chrome.windows.getCurrent()).id ?? -1);
    const panelWindow = await bootstrap.evaluate(
      async (url) => (await chrome.windows.create({ url, type: "popup", width: 600, height: 892 }))?.id ?? -1,
      panelUrl,
    );
    const panel = await waitFor(
      () => browser.firefoxPages().find((page) => page !== bootstrap && page.url() === panelUrl),
      15_000,
    );
    if (!panel) {
      child.kill();
      throw new BidiError("the panel page never appeared in its popup window");
    }
    panel.windowId = panelWindow;
    browser.worker = panel;
    await panel.locator("#tab-list, #search").first().waitFor({ state: "attached", timeout: 30_000 });
    await panel.evaluate((id) => chrome.windows.remove(id), bootstrapWindow);
    browser.known.delete(bootstrap.context);
    options.log(`firefox ${firefoxBinary()}: BiDi on ${ws_port}, extension ${GECKO_ID}`);
    return browser;
  }

  // every top-level browsing context the browser opens becomes a page; the urls follow navigations
  private trackContexts(): void {
    this.bidi.on("browsingContext.contextCreated", (params) => {
      const created = params as unknown as Context;
      if (created.parent) {
        return; // frames are not pages
      }
      const page = new FirefoxPage(this.bidi, created.context, created.url);
      page.fitWindow = (target, size) => this.fitWindow(target, size);
      this.known.set(created.context, page);
      for (const listener of this.pageListeners) {
        listener(page);
      }
    });
    this.bidi.on("browsingContext.navigationStarted", (params) => {
      const navigation = params as unknown as { context: string; url: string };
      this.known.get(navigation.context)?.noteUrl(navigation.url);
    });
    this.bidi.on("browsingContext.contextDestroyed", (params) => {
      const destroyed = params as unknown as Context;
      this.known.get(destroyed.context)?.noteClosed();
      this.known.delete(destroyed.context);
    });
  }

  pages(): DemoPage[] {
    return [...this.known.values()];
  }

  firefoxPages(): FirefoxPage[] {
    return [...this.known.values()];
  }

  onPage(listener: (page: DemoPage) => void): void {
    this.pageListeners.push(listener);
  }

  // the panel is already in its tab (it doubles as the worker)
  async openPanel(): Promise<DemoPage> {
    await this.worker.locator("#tab-list .row").first().waitFor({ state: "visible", timeout: 30_000 });
    await this.focusPanelWindow();
    return this.worker;
  }

  // Firefox ignores `focused: false` on windows.create (since 86): every window the world opens
  // takes the focus, and an unfocused window gets no focus/blur events — the inline edits commit
  // on blur. The panel's window is put back in front after anything that opened a window
  async focusPanelWindow(): Promise<void> {
    const windowId = this.worker.windowId;
    if (windowId !== undefined) {
      await this.worker.evaluate((id) => chrome.windows.update(id, { focused: true }).then(() => undefined), windowId);
    }
  }

  // a page of its own window (the story pane, the Settings page): opened by the extension, found by
  // url among the pages that did not exist before — the filmed panel has the second panel's url
  async openAside(url: string, size: Size): Promise<Aside> {
    const before = new Set(this.firefoxPages());
    const ids = await this.worker.evaluate(
      async ({ url, size }) => {
        const created = await chrome.windows.create({ url, focused: false, type: "popup", ...size });
        return { windowId: created?.id ?? -1, tabId: created?.tabs?.[0]?.id ?? -1 };
      },
      { url, size },
    );
    const page = await waitFor(
      () => this.firefoxPages().find((candidate) => !before.has(candidate) && candidate.url() === url),
      15_000,
    );
    if (!page) {
      throw new BidiError(`no page for ${url} appeared`);
    }
    page.windowId = ids.windowId;
    await page.setViewportSize(size);
    await this.focusPanelWindow();
    return { page, ...ids };
  }

  // BiDi's viewport emulation refuses extension pages, so a page is sized through its WINDOW:
  // the extension resizes the window until the page's inner size is the wanted one (the browser's
  // own bars take the difference; two passes, since a tab strip may appear with the first resize)
  async fitWindow(page: FirefoxPage, size: Size): Promise<void> {
    const windowId = page.windowId ?? (await page.evaluate(async () => (await chrome.windows.getCurrent()).id ?? -1));
    page.windowId = windowId;
    for (let pass = 0; pass < 2; pass++) {
      const [innerWidth, innerHeight] = await page.evaluate(() => [window.innerWidth, window.innerHeight]);
      if (innerWidth === size.width && innerHeight === size.height) {
        return;
      }
      await this.worker.evaluate(
        async ({ windowId, deltaWidth, deltaHeight }) => {
          const current = await chrome.windows.get(windowId);
          await chrome.windows.update(windowId, {
            width: (current.width ?? 0) + deltaWidth,
            height: (current.height ?? 0) + deltaHeight,
          });
        },
        { windowId, deltaWidth: size.width - innerWidth, deltaHeight: size.height - innerHeight },
      );
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
  }

  recorder(
    outDir: string,
    streamOfUrl: (url: string) => Stream | undefined,
    activeUrls: () => Promise<Set<string>>,
  ): FrameRecorder {
    this.recorderInstance = new FirefoxRecorder(() => this.firefoxPages(), outDir, streamOfUrl, activeUrls);
    return this.recorderInstance;
  }

  // wheel events down the list, like a person's mouse wheel (trusted input)
  async scrollGesture(page: DemoPage, distance: number): Promise<void> {
    const box = await page.locator("#tab-list").boundingBox();
    if (!box) {
      throw new BidiError("no #tab-list to scroll");
    }
    const steps = 10;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    for (let step = 0; step < steps; step++) {
      await page.mouse.wheel(0, distance / steps);
    }
  }

  async close(): Promise<void> {
    this.recorderInstance?.stop();
    this.bidi.close();
    this.process.kill();
    await new Promise<void>((resolve) => {
      this.process.once("exit", () => resolve());
      setTimeout(resolve, 5000);
    });
    rmSync(this.profile, { recursive: true, force: true });
  }
}

async function waitFor<T>(probe: () => T | Promise<T>, timeoutMs: number): Promise<T | undefined> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = await probe();
    if (value) {
      return value;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  return undefined;
}
