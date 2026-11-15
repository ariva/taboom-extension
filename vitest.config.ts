// Test runner config — deliberately separate from vite.config.ts (that one builds the
// extension; tests import sources directly and must not inherit its root/plugins).
//
// The feature-flag matrix is three projects instead of three CLI passes:
//   enabled      — flags exactly as shipped in features.json
//   experimental — experimental flags treated as enabled (ui.showExperimental injected)
//   disabled     — every flag disabled, proving disabled-state behaviour
//   firefox      — flags as shipped against the Firefox-shaped chrome mock (no sidePanel,
//                  tabs.onReplaced, split view or favicon store; a sidebarAction) — T-0152
// tests/helpers read TEST_EXPERIMENTAL / TEST_ALL_DISABLED / TEST_BROWSER. Flag-independent tests
// (lib, tooling, structure guards, pure page units) run once, in `unit`.
// Layout mirrors src/: tests/app, lib, background, pages/*, tooling; tests/structure holds
// the repo-wide guards; tests/browser and tests/e2e have their own configs.
import { defineConfig } from "vitest/config";

// whole folders that never read a feature flag, plus the pure / DOM-only page units
const FLAG_INDEPENDENT = [
  "tests/lib/**/*.test.*",
  "tests/tooling/**/*.test.*",
  "tests/structure/**/*.test.*",
  "tests/demo/**/*.test.*",
  "tests/perf/**/*.test.*",
  "tests/pages/options/page-state.test.*",
  "tests/pages/sidepanel/foundation/**/*.test.*",
  "tests/pages/sidepanel/dnd/**/*.test.*",
  "tests/pages/sidepanel/model/sort-direction.test.*",
  "tests/pages/sidepanel/model/tab-hosts.test.*",
  "tests/pages/sidepanel/model/window-order.test.*",
];

// everything else under these folders runs once per flag scenario
const FLAG_DEPENDENT = ["tests/app/**/*.test.*", "tests/background/**/*.test.*", "tests/pages/**/*.test.*"];

// the build-time browser constants (src/lib/platform/build-target.d.ts): tests run the source, where
// both branches stay and the chrome mock decides — like a build that may run anywhere; the firefox
// project is the Firefox build, so the Chrome branches are off there too
const BOTH = { __CHROME__: "true", __FIREFOX__: "true" };
const FIREFOX_BUILD = { __CHROME__: "false", __FIREFOX__: "true" };

const flagProject = (name: string, env: Record<string, string>, define = BOTH) => ({
  define,
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
      { define: BOTH, test: { name: "unit", environment: "node", include: FLAG_INDEPENDENT } },
      flagProject("enabled", {}),
      flagProject("experimental", { TEST_EXPERIMENTAL: "1" }),
      flagProject("disabled", { TEST_ALL_DISABLED: "1" }),
      flagProject("firefox", { TEST_BROWSER: "firefox" }, FIREFOX_BUILD),
    ],
  },
});
