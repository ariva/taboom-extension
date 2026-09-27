// Test runner config — deliberately separate from vite.config.ts (that one builds the
// extension; tests import sources directly and must not inherit its root/plugins).
//
// The feature-flag matrix is three projects instead of three CLI passes:
//   enabled      — flags exactly as shipped in features.json
//   experimental — experimental flags treated as enabled (ui.showExperimental injected)
//   disabled     — every flag disabled, proving disabled-state behaviour
// tests/helpers read TEST_EXPERIMENTAL / TEST_ALL_DISABLED. Flag-independent tests
// (lib, tooling, structure guards, pure page units) run once, in `unit`.
// Layout mirrors src/: tests/app, lib, background, pages/*, tooling; tests/structure holds
// the repo-wide guards; tests/browser and tests/e2e have their own configs.
import { defineConfig } from "vitest/config";

// whole folders that never read a feature flag, plus the pure / DOM-only page units
const FLAG_INDEPENDENT = [
  "tests/lib/**/*.test.*",
  "tests/tooling/**/*.test.*",
  "tests/structure/**/*.test.*",
  "tests/pages/options/page-state.test.*",
  "tests/pages/sidepanel/foundation/**/*.test.*",
  "tests/pages/sidepanel/dnd/**/*.test.*",
  "tests/pages/sidepanel/model/sort-direction.test.*",
  "tests/pages/sidepanel/model/tab-hosts.test.*",
  "tests/pages/sidepanel/model/window-order.test.*",
];

// everything else under these folders runs once per flag scenario
const FLAG_DEPENDENT = ["tests/app/**/*.test.*", "tests/background/**/*.test.*", "tests/pages/**/*.test.*"];

const flagProject = (name: string, env: Record<string, string>) => ({
  test: {
    name,
    environment: "node" as const, // UI tests bring their own happy-dom Window (tests/helpers)
    include: FLAG_DEPENDENT,
    exclude: FLAG_INDEPENDENT,
    env,
  },
});

export default defineConfig({
  test: {
    projects: [
      { test: { name: "unit", environment: "node", include: FLAG_INDEPENDENT } },
      flagProject("enabled", {}),
      flagProject("experimental", { TEST_EXPERIMENTAL: "1" }),
      flagProject("disabled", { TEST_ALL_DISABLED: "1" }),
    ],
  },
});
