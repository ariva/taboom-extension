// What the browser side measures: when the list has settled after an action, long tasks during it,
// frame intervals during a synthesized scroll. Node's wall clock brackets every action, so a
// measurement includes the panel's 150 ms debounce where the user would feel it too.
import type { CDPSession, Page } from "@playwright/test";

// arm BEFORE the action: resolves (ms, page clock) after the list's next DOM change plus two frames
export function armListSettle(page: Page): Promise<number> {
  return page.evaluate(
    () =>
      new Promise<number>((resolve) => {
        const list = document.getElementById("tab-list");
        if (!list) {
          resolve(performance.now());
          return;
        }
        const observer = new MutationObserver(() => {
          observer.disconnect();
          requestAnimationFrame(() => requestAnimationFrame(() => resolve(performance.now())));
        });
        observer.observe(list, { childList: true, subtree: true, characterData: true });
      }),
  );
}

// wall-clock ms for `act` up to the settled list
export async function timed(page: Page, act: () => Promise<unknown>): Promise<number> {
  const settled = armListSettle(page);
  const started = performance.now();
  await act();
  await settled;
  return performance.now() - started;
}

export async function installFrameRecorder(page: Page): Promise<void> {
  await page.evaluate(() => {
    const w = window as unknown as { __perfFrames: number[]; __perfRecording: boolean; __perfLong: number[] };
    w.__perfFrames = [];
    w.__perfLong = [];
    w.__perfRecording = false;
    new PerformanceObserver((entries) => {
      for (const entry of entries.getEntries()) {
        w.__perfLong.push(Math.round(entry.duration));
      }
    }).observe({ type: "longtask", buffered: false });
  });
}

export async function startFrames(page: Page): Promise<void> {
  await page.evaluate(() => {
    const w = window as unknown as { __perfFrames: number[]; __perfRecording: boolean; __perfLong: number[] };
    w.__perfFrames = [];
    w.__perfLong = [];
    w.__perfRecording = true;
    let last = performance.now();
    const tick = () => {
      const now = performance.now();
      w.__perfFrames.push(now - last);
      last = now;
      if (w.__perfRecording) {
        requestAnimationFrame(tick);
      }
    };
    requestAnimationFrame(tick);
  });
}

export async function stopFrames(page: Page): Promise<{ frames: number[]; longTasks: number[] }> {
  return page.evaluate(() => {
    const w = window as unknown as { __perfFrames: number[]; __perfRecording: boolean; __perfLong: number[] };
    w.__perfRecording = false;
    return { frames: w.__perfFrames.slice(1), longTasks: w.__perfLong.slice() };
  });
}

// one wheel-like gesture down the list, through the DevTools protocol (trusted input)
export async function scrollGesture(cdp: CDPSession, page: Page, distance: number): Promise<void> {
  const box = await page.locator("#tab-list").boundingBox();
  if (!box) {
    throw new Error("no #tab-list to scroll");
  }
  await cdp.send("Input.synthesizeScrollGesture", {
    x: box.x + box.width / 2,
    y: box.y + box.height / 2,
    yDistance: -distance,
    speed: 2400,
  });
}
