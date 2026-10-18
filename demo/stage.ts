// What a scene drives: the panel page with a visible cursor and a caption bar painted into
// it (an automation click has no pointer, and a viewer needs to see where it lands), plus
// human-paced helpers. The overlay is a manual popover re-shown before every move so it
// stays above the panel's own popovers and dialogs (the top layer orders by show time).
// Beside the panel: the story pane (every caption also lands there, with the ones before it)
// and the Settings page, scrolled to the section a scene is about.
import { join } from "node:path";
import type { Locator, Page, Worker } from "@playwright/test";
import type { World } from "./browser.ts";

export interface Stage {
  panel: Page;
  worker: Worker;
  world: World;
  aside: Aside; // the story pane and the Settings page beside the panel
  caption: (text: string, holdMs?: number) => Promise<void>;
  pause: (ms: number) => Promise<void>;
  hover: (target: Locator) => Promise<void>;
  click: (target: Locator, options?: { button?: "left" | "right" }) => Promise<void>;
  type: (text: string) => Promise<void>;
  press: (key: string) => Promise<void>;
  select: (selector: string, value: string) => Promise<void>; // with a drawn dropdown: headless shows no native one
  settingsSelect: (selector: string, value: string) => Promise<void>; // the same on the Settings pane (no cursor there)
  settings: (selector: string) => Promise<void>; // scroll the Settings pane to the card holding this #id and flash it
  scrollList: (dy: number) => Promise<void>;
  row: (title: string) => Locator; // a list row by (part of) its title
  awakeRow: (title: string) => Locator; // the same, not snoozed (a snoozed row has no snooze button)
  menuItem: (text: string) => Locator; // an item of the open context menu by its text
  check: (ok: boolean, what: string) => void; // a scene's own assertion: logged, never fatal
  // a feature still for the docs: <stillsDir>/<name>.png of the panel (or the Settings pane;
  // with a height, the page from its top that tall), overlay hidden for the shot — names are
  // fixed, docs link them (tests/demo/stills.test.ts)
  still: (name: string, pane?: "panel" | "settings", height?: number) => Promise<void>;
  stills: string[];
  warnings: string[];
}

interface OverlayApi {
  move: (x: number, y: number) => void;
  press: () => void;
  caption: (text: string) => void;
  hidden: (hide: boolean) => void; // the whole overlay off while a still is taken
}
type DemoWindow = Window & { __demo?: OverlayApi };
interface StoryApi {
  scene: (title: string) => void;
  caption: (text: string) => void;
}
type StoryWindow = Window & { __story?: StoryApi };

export interface Hidden {
  tabIds: number[]; // the demo's own tabs (panel, story, settings): hidden from the list the panel renders
  windowIds: number[];
}

// runs inside the panel page
function installInPage(own: Hidden): void {
  if (document.getElementById("demo-overlay")) {
    return;
  }
  const overlay = document.createElement("div");
  overlay.id = "demo-overlay";
  overlay.setAttribute("popover", "manual");
  overlay.style.cssText =
    "position:fixed;inset:0;margin:0;padding:0;border:0;width:100%;height:100%;max-width:none;max-height:none;background:transparent;overflow:visible;pointer-events:none;color:inherit";
  const cursor = document.createElement("div");
  cursor.style.cssText =
    "position:absolute;left:0;top:0;width:22px;height:22px;transform:translate(200px,300px);transition:transform 420ms cubic-bezier(.3,.7,.3,1);filter:drop-shadow(0 1px 2px rgba(0,0,0,.5))";
  cursor.innerHTML =
    '<svg viewBox="0 0 24 24" width="22" height="22"><path d="M5 3l14 9-6.5 1.2L16 20l-3 1.4-3.3-6.8L5 19z" fill="#fff" stroke="#111" stroke-width="1.5" stroke-linejoin="round"/></svg>';
  const ring = document.createElement("div");
  ring.style.cssText =
    "position:absolute;left:0;top:0;width:34px;height:34px;margin:-17px 0 0 -17px;border-radius:50%;border:3px solid #ff6b35;opacity:0;transform:translate(200px,300px) scale(.4)";
  const caption = document.createElement("div");
  caption.style.cssText =
    "position:absolute;left:12px;right:12px;bottom:14px;padding:10px 14px;border-radius:10px;background:rgba(20,22,26,.9);color:#fff;font:600 15px/1.35 system-ui,sans-serif;text-align:center;opacity:0;transition:opacity 250ms;box-shadow:0 4px 16px rgba(0,0,0,.35)";
  overlay.append(ring, cursor, caption);
  document.body.append(overlay);
  const style = document.createElement("style");
  const rows = own.tabIds.flatMap((id) => [
    `#tab-list .row[data-tab-id="${id}"]`,
    `#tab-list .group-header:has(+ .row[data-tab-id="${id}"])`,
  ]);
  const windows = own.windowIds.flatMap((id) => [
    `#windows-pop .win-row[data-window-id="${id}"]`,
    `#windows-pop .win-row[data-window-id="${id}"] + .win-menu-btn`,
  ]);
  style.textContent = `${[...rows, ...windows].join(", ")} { display: none !important; }`;
  document.head.append(style);
  overlay.showPopover();
  let x = 200;
  let y = 300;
  const top = () => {
    // re-show: back on top of whatever popover or dialog the panel opened since
    try {
      overlay.hidePopover();
      overlay.showPopover();
    } catch {
      // the page is navigating away
    }
  };
  const api: OverlayApi = {
    move(nextX, nextY) {
      x = nextX;
      y = nextY;
      top();
      cursor.style.transform = `translate(${x}px,${y}px)`;
    },
    press() {
      ring.style.transition = "none";
      ring.style.transform = `translate(${x + 4}px,${y + 4}px) scale(.4)`;
      ring.style.opacity = "1";
      requestAnimationFrame(() => {
        ring.style.transition = "transform 350ms ease-out, opacity 350ms ease-out";
        ring.style.transform = `translate(${x + 4}px,${y + 4}px) scale(1.2)`;
        ring.style.opacity = "0";
      });
    },
    caption(text) {
      top();
      if (!text) {
        caption.style.opacity = "0";
        return;
      }
      caption.textContent = text;
      caption.style.opacity = "1";
    },
    hidden(hide) {
      overlay.style.visibility = hide ? "hidden" : "";
    },
  };
  (window as DemoWindow).__demo = api; // the recorder's handle into the page (not part of the extension)
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export async function installOverlay(panel: Page, own: Hidden): Promise<void> {
  await panel.evaluate(installInPage, own);
}

// runs inside the Settings page: scroll to the card of the element, outline it for a moment
function focusSettingsCard(selector: string): boolean {
  const element = document.querySelector(selector);
  if (!element) {
    return false;
  }
  const card = element.closest(".card") ?? element;
  if (!document.getElementById("demo-focus-style")) {
    const style = document.createElement("style");
    style.id = "demo-focus-style";
    style.textContent =
      ".demo-focus{outline:3px solid #ff6b35;outline-offset:-3px;transition:outline-color 1.5s}.demo-focus.fade{outline-color:transparent}.card{scroll-margin-top:8px}";
    document.head.append(style);
  }
  for (const previous of document.querySelectorAll(".demo-focus")) {
    previous.classList.remove("demo-focus", "fade");
  }
  card.classList.add("demo-focus");
  setTimeout(() => card.classList.add("fade"), 1800);
  card.scrollIntoView({ behavior: "smooth", block: "start" });
  return true;
}

// runs inside a page: a <select>'s options drawn as a list under it, the current value marked
// ("open"), then the one about to be chosen ("pick"), then gone ("close"). Headless Chromium
// paints no native dropdown, and a value that flips on its own reads as a cut.
interface DropdownArgs {
  selector: string;
  value: string;
  step: "open" | "pick" | "close";
}
function drawnDropdown(args: DropdownArgs): { x: number; y: number } | null {
  const id = "demo-dropdown";
  const existing = document.getElementById(id);
  if (args.step === "close") {
    existing?.remove();
    return null;
  }
  const select = document.querySelector<HTMLSelectElement>(args.selector);
  if (!select) {
    return null;
  }
  let list = existing;
  if (!list) {
    list = document.createElement("div");
    list.id = id;
    list.setAttribute("popover", "manual");
    const anchor = select.getBoundingClientRect();
    list.style.cssText = `position:fixed;margin:0;padding:4px 0;border:1px solid #9aa0a6;border-radius:6px;background:#fff;color:#202124;box-shadow:0 6px 20px rgba(0,0,0,.3);font:13px system-ui,sans-serif;min-width:${anchor.width}px;left:${anchor.left}px;top:${anchor.bottom + 2}px`;
    for (const option of select.options) {
      const row = document.createElement("div");
      row.dataset.value = option.value;
      row.textContent = option.text;
      row.style.cssText = "padding:5px 12px;white-space:nowrap";
      list.append(row);
    }
    document.body.append(list);
    list.showPopover();
    const height = list.getBoundingClientRect().height;
    if (anchor.bottom + 2 + height > window.innerHeight) {
      list.style.top = `${anchor.top - 2 - height}px`; // no room below: open upwards, as Chrome does
    }
  }
  const wanted = args.step === "open" ? select.value : args.value;
  let target: HTMLElement | null = null;
  for (const row of Array.from(list.children) as HTMLElement[]) {
    const on = row.dataset.value === wanted;
    row.style.background = on ? "#1a73e8" : "";
    row.style.color = on ? "#fff" : "";
    if (on) {
      target = row;
    }
  }
  const box = target?.getBoundingClientRect();
  return box
    ? { x: Math.round(box.left + Math.min(box.width / 2, 60)), y: Math.round(box.top + box.height / 2) }
    : null;
}

export interface Aside {
  story: Page;
  settings: Page;
}

export function storyScene(aside: Aside, title: string): Promise<void> {
  return aside.story.evaluate((value) => (window as StoryWindow).__story?.scene(value), title);
}

export function makeStage(
  panel: Page,
  worker: Worker,
  world: World,
  aside: Aside,
  log: (line: string) => void,
  stillsDir: string,
): Stage {
  const warnings: string[] = [];
  const stills: string[] = [];
  const moveTo = async (target: Locator) => {
    // centered, not merely in view: a context menu opens at the click and must have room below
    await target.evaluate((element) => element.scrollIntoView({ block: "center", inline: "nearest" })).catch(() => {});
    await sleep(120);
    const box = await target.boundingBox();
    if (!box) {
      throw new Error(`no box for ${target}`);
    }
    const x = Math.round(box.x + Math.min(box.width / 2, 60));
    const y = Math.round(box.y + box.height / 2);
    await cursorTo(x, y);
    return { x, y };
  };
  const cursorTo = async (x: number, y: number) => {
    await panel.evaluate(([px, py]) => (window as DemoWindow).__demo?.move(px, py), [x, y] as const);
    await panel.mouse.move(x, y, { steps: 12 });
    await sleep(460);
  };
  const pressRing = () => panel.evaluate(() => (window as DemoWindow).__demo?.press());
  // open the drawn list, mark the current value, then the chosen one, close, change for real
  const pickFromDropdown = async (page: Page, selector: string, value: string, withCursor: boolean) => {
    const open: DropdownArgs = { selector, value, step: "open" };
    await page.evaluate(drawnDropdown, open);
    await sleep(800);
    const pick: DropdownArgs = { selector, value, step: "pick" };
    const point = await page.evaluate(drawnDropdown, pick);
    if (point && withCursor) {
      await cursorTo(point.x, point.y);
      await pressRing();
    }
    await sleep(800);
    const close: DropdownArgs = { selector, value, step: "close" };
    await page.evaluate(drawnDropdown, close);
    await page.selectOption(selector, value);
    await sleep(1100);
  };
  return {
    panel,
    worker,
    world,
    aside,
    caption: async (text, holdMs = 1200) => {
      await panel.evaluate((value) => (window as DemoWindow).__demo?.caption(value), text);
      await aside.story.evaluate((value) => (window as StoryWindow).__story?.caption(value), text);
      await sleep(holdMs);
    },
    pause: sleep,
    hover: async (target) => {
      await moveTo(target);
      await sleep(600);
    },
    click: async (target, options = {}) => {
      const { x, y } = await moveTo(target);
      await pressRing();
      await panel.mouse.click(x, y, { button: options.button ?? "left" });
      await sleep(650);
    },
    type: async (text) => {
      await panel.keyboard.type(text, { delay: 70 });
      await sleep(700);
    },
    press: async (key) => {
      await panel.keyboard.press(key);
      await sleep(600);
    },
    select: async (selector, value) => {
      await moveTo(panel.locator(selector));
      await pressRing();
      await pickFromDropdown(panel, selector, value, true);
    },
    settingsSelect: async (selector, value) => {
      await pickFromDropdown(aside.settings, selector, value, false);
    },
    settings: async (selector) => {
      const found = await aside.settings.evaluate(focusSettingsCard, selector);
      if (!found) {
        warnings.push(`settings: ${selector} is not on the Settings page`);
        log(`  settings: ${selector} not found`);
      }
      await sleep(900);
    },
    scrollList: async (dy) => {
      const steps = 10;
      for (let step = 0; step < steps; step++) {
        await panel.mouse.wheel(0, dy / steps);
        await sleep(70);
      }
      await sleep(500);
    },
    row: (title) => panel.locator("#tab-list .row", { hasText: title }).first(),
    awakeRow: (title) => panel.locator("#tab-list .row:not(.snoozed)", { hasText: title }).first(),
    menuItem: (text) => panel.locator("#ctx-menu .ctx-item", { hasText: text }).first(),
    check: (ok, what) => {
      if (!ok) {
        warnings.push(what);
        log(`  check failed: ${what}`);
      }
    },
    still: async (name, pane = "panel", height?: number) => {
      const page = pane === "settings" ? aside.settings : panel;
      await panel.evaluate(() => (window as DemoWindow).__demo?.hidden(true));
      await sleep(250); // the caption's fade-out, so it is not caught mid-way
      // a taller viewport rather than a fullPage clip: the Settings body background is `fixed`,
      // which a stitched full-page shot paints only viewport-high
      const size = page.viewportSize();
      if (height !== undefined && size) {
        await page.setViewportSize({ width: size.width, height });
        await page.evaluate(() => window.scrollTo(0, 0));
        await sleep(250);
      }
      await page.screenshot({ path: join(stillsDir, `${name}.png`) });
      if (height !== undefined && size) {
        await page.setViewportSize(size);
      }
      await panel.evaluate(() => (window as DemoWindow).__demo?.hidden(false));
      stills.push(name);
    },
    stills,
    warnings,
  };
}
