// Playwright's Page and Locator seen through the demo's interfaces (demo/page-api.ts): thin
// adapters, so the scenes and the perf scenarios have one shape for Chromium and Firefox.
import type { Locator, Page } from "@playwright/test";
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
} from "./page-api.ts";

export class PlaywrightLocator implements DemoLocator {
  readonly inner: Locator;

  constructor(inner: Locator) {
    this.inner = inner;
  }

  first(): DemoLocator {
    return new PlaywrightLocator(this.inner.first());
  }

  nth(index: number): DemoLocator {
    return new PlaywrightLocator(this.inner.nth(index));
  }

  locator(selector: string, options?: LocatorOptions): DemoLocator {
    return new PlaywrightLocator(this.inner.locator(selector, options));
  }

  count(): Promise<number> {
    return this.inner.count();
  }

  textContent(): Promise<string | null> {
    return this.inner.textContent();
  }

  inputValue(): Promise<string> {
    return this.inner.inputValue();
  }

  getAttribute(name: string): Promise<string | null> {
    return this.inner.getAttribute(name);
  }

  isVisible(): Promise<boolean> {
    return this.inner.isVisible();
  }

  boundingBox(): Promise<Box | null> {
    return this.inner.boundingBox();
  }

  evaluate<Result, Arg = undefined>(fn: ElementFunction<Arg, Result>, arg?: Arg): Promise<Result> {
    // Playwright types the function's argument as Unboxed<Arg> (JSHandles inside it unwrapped) and the
    // element as the locator's generic; the demo passes plain data to HTMLElements, so the interface's
    // function IS such a function — the cast names Playwright's own parameter type, nothing wider
    return this.inner.evaluate(fn as unknown as Parameters<Locator["evaluate"]>[0], arg) as Promise<Result>;
  }

  waitFor(options?: { state?: "visible" | "attached"; timeout?: number }): Promise<void> {
    return this.inner.waitFor(options);
  }

  click(options?: { button?: MouseButton; position?: Point; force?: boolean }): Promise<void> {
    return this.inner.click(options);
  }

  hover(): Promise<void> {
    return this.inner.hover();
  }

  check(): Promise<void> {
    return this.inner.check();
  }

  fill(text: string): Promise<void> {
    return this.inner.fill(text);
  }

  press(key: string): Promise<void> {
    return this.inner.press(key);
  }

  type(text: string, options?: { delay?: number }): Promise<void> {
    return this.inner.pressSequentially(text, options);
  }

  async selectOption(value: string): Promise<void> {
    await this.inner.selectOption(value);
  }

  dispatchEvent(type: string): Promise<void> {
    return this.inner.dispatchEvent(type);
  }
}

export class PlaywrightPage implements DemoPage {
  readonly inner: Page;
  readonly mouse: DemoPage["mouse"];
  readonly keyboard: DemoPage["keyboard"];

  constructor(inner: Page) {
    this.inner = inner;
    this.mouse = {
      move: (x, y, options) => inner.mouse.move(x, y, options),
      click: (x, y, options) => inner.mouse.click(x, y, options),
      wheel: (deltaX, deltaY) => inner.mouse.wheel(deltaX, deltaY),
    };
    this.keyboard = {
      type: (text, options) => inner.keyboard.type(text, options),
      press: (key) => inner.keyboard.press(key),
    };
  }

  locator(selector: string, options?: LocatorOptions): DemoLocator {
    return new PlaywrightLocator(this.inner.locator(selector, options));
  }

  evaluate<Result, Arg = undefined>(fn: PageFunction<Arg, Result>, arg?: Arg): Promise<Result> {
    // same gap as the locator's: Unboxed<Arg> vs Arg, no handles ever cross — Playwright's own parameter type
    return this.inner.evaluate(fn as unknown as Parameters<Page["evaluate"]>[0], arg) as Promise<Result>;
  }

  url(): string {
    return this.inner.url();
  }

  isClosed(): boolean {
    return this.inner.isClosed();
  }

  async reload(): Promise<void> {
    await this.inner.reload();
  }

  waitForTimeout(ms: number): Promise<void> {
    return this.inner.waitForTimeout(ms);
  }

  async screenshot(options: { path: string; clip?: Box }): Promise<void> {
    await this.inner.screenshot(options);
  }

  viewportSize(): Size | null {
    return this.inner.viewportSize();
  }

  setViewportSize(size: Size): Promise<void> {
    return this.inner.setViewportSize(size);
  }

  async addStyleTag(options: { content: string }): Promise<void> {
    await this.inner.addStyleTag(options);
  }
}
