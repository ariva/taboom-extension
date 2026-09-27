// End-to-end smoke: the BUILT extension (dist/prod) loaded into real Chromium.
// Deliberately tiny — behaviour is covered by the Vitest tiers; this proves the package
// boots: worker registers, pages load from chrome-extension://, nothing touches the network.
import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "tests/e2e",
  workers: 1, // one persistent browser profile at a time
  fullyParallel: false,
  reporter: "line",
  timeout: 30_000,
});
