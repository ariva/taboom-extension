import assert from "node:assert/strict";
import { test } from "vitest";
import { makeChrome, TEST_EXPERIMENTAL } from "../helpers/ui.ts";
import { DEFAULTS } from "../../src/app/core.ts";
import type { LocalStorageSchema } from "../../src/app/types.ts";

test("Core - Storage - LoadState merges defaults with partial stored state", async () => {
  const stored = { settings: { inactivityMinutes: 15 }, ui: { theme: "dark" } };
  Object.assign(globalThis, { chrome: makeChrome({ stored, calls: [] }) });
  const { loadState } = await import("../../src/app/storage.ts");

  const state = await loadState();
  assert.equal(state.settings.inactivityMinutes, 15, "stored value wins");
  assert.equal(
    state.settings.checkIntervalMinutes,
    DEFAULTS.settings.checkIntervalMinutes,
    "missing setting from defaults",
  );
  assert.equal(state.ui.theme, "dark");
  assert.equal(state.ui.density, DEFAULTS.ui.density, "missing ui pref from defaults");
  assert.deepEqual(state.protectionRules, [], "no rules stored → empty list");
  assert.equal(state.schemaVersion, 1);
});

test("Core - Storage - LoadState on empty storage returns full defaults; saveState patches", async () => {
  const stored: Partial<LocalStorageSchema> = {};
  const calls: string[] = [];
  Object.assign(globalThis, { chrome: makeChrome({ stored, calls }) });
  const { loadState, saveState } = await import("../../src/app/storage.ts");

  const state = await loadState();
  assert.deepEqual(state.settings, DEFAULTS.settings);
  // scenario 2 injects ui.showExperimental into stored state (helpers/ui.ts)
  assert.deepEqual(state.ui, { ...DEFAULTS.ui, ...(TEST_EXPERIMENTAL ? { showExperimental: true } : {}) });

  await saveState({ ui: { ...state.ui, fontSize: 1.3 } });
  assert.equal(stored.ui?.fontSize, 1.3);
  const reloaded = await loadState();
  assert.equal(reloaded.ui.fontSize, 1.3);
  assert.equal(reloaded.ui.theme, DEFAULTS.ui.theme, "untouched prefs keep defaults");
});
