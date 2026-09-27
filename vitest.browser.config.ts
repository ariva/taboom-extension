// Real-browser tier: the same Vitest API, executed inside headless Chromium (Playwright
// provider). For what happy-dom cannot judge — focus and blur order, which element a click
// lands on after a re-render, popover / <dialog> top-layer behaviour, drag & drop.
// Kept out of the default `vitest run` (and `just check`): it needs a browser binary and
// takes seconds, not milliseconds. Run with `just test-browser`; `just build` includes it.
import { playwright } from "@vitest/browser-playwright";
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    name: "browser",
    include: ["tests/browser/*.test.ts"],
    browser: {
      enabled: true,
      headless: true,
      provider: playwright(),
      instances: [{ browser: "chromium" }],
      screenshotFailures: false,
    },
  },
});
