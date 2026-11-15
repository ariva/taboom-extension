// Real-browser tier: the same Vitest API, executed inside headless Chromium AND Firefox
// (Playwright provider). For what happy-dom cannot judge — focus and blur order, which element
// a click lands on after a re-render, popover / <dialog> top-layer behaviour, drag & drop —
// and, since the Firefox port (T-0152), that the DOM code behaves the same in Gecko.
// Kept out of the default `vitest run` (and `just check`): it needs a browser binary and
// takes seconds, not milliseconds. Run with `just test-browser`; `just build` includes it.
import { playwright } from "@vitest/browser-playwright";
import { defineConfig } from "vitest/config";

export default defineConfig({
  define: { __CHROME__: "true", __FIREFOX__: "true" }, // the source, not a build: both branches present
  test: {
    name: "browser",
    include: ["tests/browser/*.test.ts"],
    browser: {
      enabled: true,
      headless: true,
      provider: playwright(),
      // Firefox: one test file at a time — headless Gecko gives the focus to one page only, and
      // twelve pages at once take it from each other's popovers and dialogs
      instances: [{ browser: "chromium" }, { browser: "firefox", fileParallelism: false }],
      screenshotFailures: false,
    },
  },
});
