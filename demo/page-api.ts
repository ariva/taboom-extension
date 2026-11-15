// What the demo and the performance tier need from a browser, as interfaces: the Chromium
// implementation wraps Playwright (demo/browser.ts), the Firefox one speaks WebDriver BiDi and
// Marionette itself (demo/firefox/), because Playwright cannot load an extension into Firefox
// (T-0152). Scenes, the stage and the perf scenarios are written against these only.

export interface Size {
  width: number;
  height: number;
}

export interface Box extends Size {
  x: number;
  y: number;
}

export interface Point {
  x: number;
  y: number;
}

export type MouseButton = "left" | "right";

// a function serialized and run inside the page (or the extension's worker): plain data in and out
export type PageFunction<Arg, Result> = (arg: Arg) => Result | Promise<Result>;
export type ElementFunction<Arg, Result> = (element: HTMLElement, arg: Arg) => Result | Promise<Result>;

export interface Evaluator {
  evaluate<Result, Arg = undefined>(fn: PageFunction<Arg, Result>, arg?: Arg): Promise<Result>;
}

export interface LocatorOptions {
  hasText?: string;
}

// the slice of Playwright's Locator the scenes and scenarios use; a Firefox locator does the same
// through script.callFunction + input.performActions
export interface DemoLocator {
  first(): DemoLocator;
  nth(index: number): DemoLocator;
  locator(selector: string, options?: LocatorOptions): DemoLocator;
  count(): Promise<number>;
  textContent(): Promise<string | null>;
  inputValue(): Promise<string>;
  getAttribute(name: string): Promise<string | null>;
  isVisible(): Promise<boolean>;
  boundingBox(): Promise<Box | null>;
  evaluate<Result, Arg = undefined>(fn: ElementFunction<Arg, Result>, arg?: Arg): Promise<Result>;
  waitFor(options?: { state?: "visible" | "attached"; timeout?: number }): Promise<void>;
  click(options?: { button?: MouseButton; position?: Point; force?: boolean }): Promise<void>;
  hover(): Promise<void>;
  check(): Promise<void>;
  fill(text: string): Promise<void>;
  press(key: string): Promise<void>;
  type(text: string, options?: { delay?: number }): Promise<void>;
  selectOption(value: string): Promise<void>;
  dispatchEvent(type: string): Promise<void>;
}

export interface DemoPage extends Evaluator {
  locator(selector: string, options?: LocatorOptions): DemoLocator;
  mouse: {
    move(x: number, y: number, options?: { steps?: number }): Promise<void>;
    click(x: number, y: number, options?: { button?: MouseButton }): Promise<void>;
    wheel(deltaX: number, deltaY: number): Promise<void>;
  };
  keyboard: {
    type(text: string, options?: { delay?: number }): Promise<void>;
    press(key: string): Promise<void>;
  };
  url(): string;
  isClosed(): boolean;
  reload(): Promise<void>;
  waitForTimeout(ms: number): Promise<void>;
  // a PNG of the viewport (or of `clip` inside it) written to `path`
  screenshot(options: { path: string; clip?: Box }): Promise<void>;
  viewportSize(): Size | null;
  setViewportSize(size: Size): Promise<void>;
  addStyleTag(options: { content: string }): Promise<void>;
}

// one page of its own window: the story pane and the Settings page
export interface Aside {
  page: DemoPage;
  windowId: number;
  tabId: number;
}

export type Stream = "panel" | "story" | "settings";

// films the recorded pages: one frame per change, a concat list per stream and scene
export interface FrameRecorder {
  hidden: string[]; // streams whose page reported itself hidden at a scene start (diagnostics)
  start(panel: DemoPage, log?: (line: string) => void): Promise<void>;
  startScene(id: string): Promise<void>;
  endScene(): { id: string; durationMs: number; streams: Stream[] };
}

export type BrowserName = "chrome" | "firefox";

export interface DemoBrowser {
  name: BrowserName;
  // runs code with the extension's own chrome.* (Chromium: the worker; Firefox: the panel page —
  // an extension page sees the same APIs, and BiDi reaches no event page)
  worker: Evaluator;
  extensionOrigin: string; // chrome-extension://<id> or moz-extension://<uuid>
  blocked: string[]; // network requests refused during the run (the routed *.test pages excepted)
  pages(): DemoPage[];
  onPage(listener: (page: DemoPage) => void): void;
  // the side panel page in a tab of the first window (no browser lets automation open the real
  // panel surface); confirm() dialogs are accepted so bulk actions go through
  openPanel(): Promise<DemoPage>;
  openAside(url: string, size: Size): Promise<Aside>;
  recorder(
    outDir: string,
    streamOfUrl: (url: string) => Stream | undefined,
    activeUrls: () => Promise<Set<string>>,
  ): FrameRecorder;
  // one wheel-like gesture down the list, as trusted input
  scrollGesture(page: DemoPage, distance: number): Promise<void>;
  close(): Promise<void>;
}
