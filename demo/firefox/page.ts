// A page of the Firefox the demo drives, over WebDriver BiDi: the DemoPage / DemoLocator slice
// of Playwright's API that the scenes and the perf scenarios use (demo/page-api.ts). Elements are
// found by running selectors inside the page; input goes through input.performActions (trusted,
// like a person's), screenshots through browsingContext.captureScreenshot.
import { writeFileSync } from "node:fs";
import type {
  Box,
  DemoLocator,
  DemoPage,
  ElementFunction,
  LocatorOptions,
  MouseButton,
  PageFunction,
  Point,
  Size,
} from "../page-api.ts";
import { type BidiClient, BidiError, fromRemoteValue, type RemoteValue, toLocalValue } from "./protocol.ts";

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

// Playwright key names → WebDriver key code points (the printable ones are themselves)
const KEYS: Record<string, string> = {
  Enter: "\uE006", // the Return key (code "Enter"); \uE007 is the numpad one
  Escape: "\uE00C",
  Backspace: "\uE003",
  Tab: "\uE004",
  Delete: "\uE017",
  ArrowDown: "\uE015",
  ArrowUp: "\uE013",
  ArrowLeft: "\uE012",
  ArrowRight: "\uE014",
  Home: "\uE011",
  End: "\uE010",
  PageDown: "\uE00F",
  PageUp: "\uE00E",
  Shift: "\uE008",
  Control: "\uE009",
  Alt: "\uE00A",
  Meta: "\uE03D",
  F10: "\uE03A", // WebDriver numbers F1…F12 from \uE031; only the one a scene presses (Shift+F10) is listed
  Space: " ",
};
const BUTTONS: Record<MouseButton, number> = { left: 0, right: 2 };

// a chain of selectors with their text filters and positions: resolved inside the page each time
interface Step {
  selector: string;
  hasText?: string;
  index?: number; // nth; undefined = every match
}

// runs in the page: the elements a step chain names
function resolveSteps(steps: Step[]): HTMLElement[] {
  let scope: HTMLElement[] = [document.documentElement];
  for (const step of steps) {
    const found: HTMLElement[] = [];
    for (const root of scope) {
      const matches = step.selector.startsWith("xpath=")
        ? xpathAll(step.selector.slice(6), root)
        : Array.from(root.querySelectorAll<HTMLElement>(step.selector));
      for (const element of matches) {
        if (step.hasText === undefined || (element.textContent ?? "").includes(step.hasText)) {
          found.push(element);
        }
      }
    }
    scope = step.index === undefined ? found : found[step.index] ? [found[step.index] as HTMLElement] : [];
  }
  return scope;
  function xpathAll(expression: string, root: HTMLElement): HTMLElement[] {
    const result = document.evaluate(expression, root, null, XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, null);
    const nodes: HTMLElement[] = [];
    for (let index = 0; index < result.snapshotLength; index++) {
      const node = result.snapshotItem(index);
      if (node instanceof HTMLElement) {
        nodes.push(node);
      }
    }
    return nodes;
  }
}

function isVisible(element: HTMLElement): boolean {
  const style = getComputedStyle(element);
  if (style.visibility === "hidden" || style.display === "none") {
    return false;
  }
  const box = element.getBoundingClientRect();
  return box.width > 0 && box.height > 0;
}

export class FirefoxPage implements DemoPage {
  readonly context: string;
  windowId: number | undefined; // the browser window holding this page, once known (sizing goes through it)
  // set by the browser: sizes the window so the page's inner size is the wanted one
  fitWindow: ((page: FirefoxPage, size: Size) => Promise<void>) | undefined;
  private readonly bidi: BidiClient;
  private currentUrl: string;
  private closed = false;
  private viewport: Size | null = null;
  private pointer: Point = { x: 0, y: 0 };
  readonly mouse: DemoPage["mouse"];
  readonly keyboard: DemoPage["keyboard"];

  constructor(bidi: BidiClient, context: string, url: string) {
    this.bidi = bidi;
    this.context = context;
    this.currentUrl = url;
    this.mouse = {
      move: (x, y, options) => this.pointerMove(x, y, options?.steps ?? 1),
      click: async (x, y, options) => {
        await this.pointerMove(x, y, 1);
        await this.pointerClick(options?.button ?? "left");
      },
      wheel: (deltaX, deltaY) =>
        this.actions([
          {
            type: "wheel",
            id: "wheel",
            actions: [{ type: "scroll", x: Math.round(this.pointer.x), y: Math.round(this.pointer.y), deltaX, deltaY }],
          },
        ]),
    };
    this.keyboard = {
      type: async (text, options) => {
        for (const char of text) {
          await this.keyPress(char);
          await sleep(options?.delay ?? 0);
        }
      },
      press: (key) => this.keyPress(key),
    };
  }

  // the recorder and the aside lookup follow the url the page reports
  noteUrl(url: string): void {
    this.currentUrl = url;
  }

  noteClosed(): void {
    this.closed = true;
  }

  url(): string {
    return this.currentUrl;
  }

  isClosed(): boolean {
    return this.closed;
  }

  locator(selector: string, options?: LocatorOptions): DemoLocator {
    return new FirefoxLocator(this, [
      { selector, ...(options?.hasText === undefined ? {} : { hasText: options.hasText }) },
    ]);
  }

  async evaluate<Result, Arg = undefined>(fn: PageFunction<Arg, Result>, arg?: Arg): Promise<Result> {
    return this.callFunction(fn.toString(), arg === undefined ? [] : [toLocalValue(arg)]) as Promise<Result>;
  }

  // steps: a locator chain to resolve first; the elements come to `fn` as its first argument
  async callOnElements<Result>(steps: Step[], body: string, arg: unknown): Promise<Result> {
    // the page function wraps resolveSteps so the chain and the body travel as one declaration
    const declaration = `(steps, arg) => { ${resolveSteps.toString()}; ${isVisible.toString()}; const elements = resolveSteps(steps); return (${body})(elements, arg, isVisible); }`;
    return this.callFunction(declaration, [toLocalValue(steps), toLocalValue(arg)]) as Promise<Result>;
  }

  private async callFunction(declaration: string, args: RemoteValue[]): Promise<unknown> {
    const result = await this.bidi.send("script.callFunction", {
      functionDeclaration: declaration,
      target: { context: this.context },
      arguments: args,
      awaitPromise: true,
      resultOwnership: "none",
      serializationOptions: { maxObjectDepth: 100 },
    });
    if (result.type === "exception") {
      const details = result.exceptionDetails as { text?: string } | undefined;
      throw new BidiError(`page script failed: ${details?.text ?? "unknown error"}`);
    }
    return fromRemoteValue(result.result as RemoteValue);
  }

  async reload(): Promise<void> {
    await this.bidi.send("browsingContext.reload", { context: this.context, wait: "interactive" });
  }

  waitForTimeout(ms: number): Promise<void> {
    return sleep(ms);
  }

  async screenshot(options: { path: string; clip?: Box }): Promise<void> {
    const { data } = await this.bidi.send("browsingContext.captureScreenshot", {
      context: this.context,
      origin: "viewport",
      ...(options.clip ? { clip: { type: "box", ...options.clip } } : {}),
    });
    writeFileSync(options.path, Buffer.from(String(data), "base64"));
  }

  // a frame for the recorder: JPEG, base64 — undefined when the page cannot be captured right now
  async frame(): Promise<string | undefined> {
    try {
      const { data } = await this.bidi.send("browsingContext.captureScreenshot", {
        context: this.context,
        origin: "viewport",
        format: { type: "image/jpeg", quality: 0.85 },
      });
      return String(data);
    } catch {
      return undefined;
    }
  }

  viewportSize(): Size | null {
    return this.viewport;
  }

  // through the window (demo/firefox/browser.ts fitWindow): BiDi's viewport emulation refuses extension pages
  async setViewportSize(size: Size): Promise<void> {
    await this.fitWindow?.(this, size);
    this.viewport = size;
  }

  async addStyleTag(options: { content: string }): Promise<void> {
    await this.evaluate((content) => {
      const style = document.createElement("style");
      style.textContent = content;
      document.head.append(style);
    }, options.content);
  }

  // ---------- input ----------

  async pointerMove(x: number, y: number, steps: number): Promise<void> {
    const from = this.pointer;
    const moves = [];
    for (let step = 1; step <= Math.max(1, steps); step++) {
      const fraction = step / Math.max(1, steps);
      moves.push({
        type: "pointerMove",
        x: Math.round(from.x + (x - from.x) * fraction),
        y: Math.round(from.y + (y - from.y) * fraction),
        duration: steps > 1 ? 16 : 0,
      });
    }
    await this.actions([{ type: "pointer", id: "mouse", parameters: { pointerType: "mouse" }, actions: moves }]);
    this.pointer = { x, y };
  }

  async pointerClick(button: MouseButton): Promise<void> {
    await this.actions([
      {
        type: "pointer",
        id: "mouse",
        parameters: { pointerType: "mouse" },
        actions: [
          { type: "pointerDown", button: BUTTONS[button] },
          { type: "pointerUp", button: BUTTONS[button] },
        ],
      },
    ]);
  }

  // "Shift+Enter" style chords: modifiers held around the key
  async keyPress(key: string): Promise<void> {
    const parts = key.split("+");
    const main = parts.pop() ?? key;
    const modifiers = parts.map((part) => KEYS[part] ?? part);
    const value = KEYS[main] ?? main;
    await this.actions([
      {
        type: "key",
        id: "keyboard",
        actions: [
          ...modifiers.map((modifier) => ({ type: "keyDown", value: modifier })),
          { type: "keyDown", value },
          { type: "keyUp", value },
          ...modifiers.reverse().map((modifier) => ({ type: "keyUp", value: modifier })),
        ],
      },
    ]);
  }

  private async actions(actions: unknown[]): Promise<void> {
    await this.bidi.send("input.performActions", { context: this.context, actions });
  }
}

export class FirefoxLocator implements DemoLocator {
  private readonly page: FirefoxPage;
  private readonly steps: Step[];

  constructor(page: FirefoxPage, steps: Step[]) {
    this.page = page;
    this.steps = steps;
  }

  private withIndex(index: number): FirefoxLocator {
    const last = this.steps[this.steps.length - 1];
    if (!last) {
      return this;
    }
    return new FirefoxLocator(this.page, [...this.steps.slice(0, -1), { ...last, index }]);
  }

  first(): DemoLocator {
    return this.withIndex(0);
  }

  nth(index: number): DemoLocator {
    return this.withIndex(index);
  }

  locator(selector: string, options?: LocatorOptions): DemoLocator {
    return new FirefoxLocator(this.page, [
      ...this.steps,
      { selector, ...(options?.hasText === undefined ? {} : { hasText: options.hasText }) },
    ]);
  }

  // body: a page-side function (elements, arg, isVisible) => result
  private run<Result>(body: string, arg?: unknown): Promise<Result> {
    return this.page.callOnElements<Result>(this.steps, body, arg);
  }

  count(): Promise<number> {
    return this.run("(elements) => elements.length");
  }

  textContent(): Promise<string | null> {
    return this.run("(elements) => elements[0] ? elements[0].textContent : null");
  }

  inputValue(): Promise<string> {
    return this.run("(elements) => elements[0] ? elements[0].value ?? '' : ''");
  }

  getAttribute(name: string): Promise<string | null> {
    return this.run("(elements, name) => elements[0] ? elements[0].getAttribute(name) : null", name);
  }

  isVisible(): Promise<boolean> {
    return this.run("(elements, _arg, isVisible) => elements[0] ? isVisible(elements[0]) : false");
  }

  boundingBox(): Promise<Box | null> {
    return this.run(
      "(elements) => { const box = elements[0]?.getBoundingClientRect(); return box ? { x: box.x, y: box.y, width: box.width, height: box.height } : null; }",
    );
  }

  evaluate<Result, Arg = undefined>(fn: ElementFunction<Arg, Result>, arg?: Arg): Promise<Result> {
    return this.run(
      `(elements, arg) => { if (!elements[0]) { throw new Error("no element"); } return (${fn.toString()})(elements[0], arg); }`,
      arg,
    );
  }

  async waitFor(options: { state?: "visible" | "attached"; timeout?: number } = {}): Promise<void> {
    const state = options.state ?? "visible";
    const deadline = Date.now() + (options.timeout ?? 30_000);
    while (Date.now() < deadline) {
      const ready = await this.run<boolean>(
        "(elements, state, isVisible) => elements[0] ? (state === 'attached' || isVisible(elements[0])) : false",
        state,
      );
      if (ready) {
        return;
      }
      await sleep(50);
    }
    throw new BidiError(`waitFor(${state}): ${this.describe()} did not appear in time`);
  }

  private describe(): string {
    return this.steps.map((step) => `${step.selector}${step.hasText ? ` "${step.hasText}"` : ""}`).join(" >> ");
  }

  // scrolled into view first and STABLE (Playwright does the same: a box still moving — a smooth
  // scroll of the Settings pane, a popover sliding in — would put the click somewhere else); force
  // skips the visibility wait
  private async center(options: { position?: Point; force?: boolean } = {}): Promise<Point> {
    if (!options.force) {
      await this.waitFor({ state: "visible", timeout: 15_000 });
    }
    const box = await this.run<Box | null>(
      `(elements) => new Promise((resolve) => {
        const element = elements[0];
        if (!element) { resolve(null); return; }
        element.scrollIntoView({ block: "nearest", inline: "nearest" });
        const measure = () => { const b = element.getBoundingClientRect(); return { x: b.x, y: b.y, width: b.width, height: b.height }; };
        let last = measure();
        let tries = 0;
        const tick = () => {
          const now = measure();
          if ((now.x === last.x && now.y === last.y && now.width === last.width) || tries++ > 120) { resolve(now); return; }
          last = now;
          requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
      })`,
    );
    if (!box) {
      throw new BidiError(`no element for ${this.describe()}`);
    }
    const position = options.position ?? { x: box.width / 2, y: box.height / 2 };
    return { x: box.x + position.x, y: box.y + position.y };
  }

  async click(options: { button?: MouseButton; position?: Point; force?: boolean } = {}): Promise<void> {
    const point = await this.center(options);
    await this.page.pointerMove(point.x, point.y, 1);
    await this.page.pointerClick(options.button ?? "left");
  }

  async hover(): Promise<void> {
    const point = await this.center();
    await this.page.pointerMove(point.x, point.y, 1);
  }

  async check(): Promise<void> {
    const checked = await this.run<boolean>("(elements) => elements[0]?.checked === true");
    if (!checked) {
      await this.click();
    }
  }

  // like Playwright's fill: focus, replace the value, one input event
  async fill(text: string): Promise<void> {
    await this.waitFor({ state: "attached" });
    await this.run(
      "(elements, text) => { const element = elements[0]; element.focus(); element.value = text; element.dispatchEvent(new Event('input', { bubbles: true })); }",
      text,
    );
  }

  async press(key: string): Promise<void> {
    await this.run("(elements) => elements[0]?.focus()");
    await this.page.keyPress(key);
  }

  async type(text: string, options?: { delay?: number }): Promise<void> {
    await this.run("(elements) => elements[0]?.focus()");
    await this.page.keyboard.type(text, options);
  }

  async selectOption(value: string): Promise<void> {
    await this.run(
      "(elements, value) => { const select = elements[0]; select.value = value; select.dispatchEvent(new Event('input', { bubbles: true })); select.dispatchEvent(new Event('change', { bubbles: true })); }",
      value,
    );
  }

  async dispatchEvent(type: string): Promise<void> {
    await this.run(
      "(elements, type) => { const Ctor = type === 'click' ? MouseEvent : Event; elements[0]?.dispatchEvent(new Ctor(type, { bubbles: true, cancelable: true })); }",
      type,
    );
  }
}
