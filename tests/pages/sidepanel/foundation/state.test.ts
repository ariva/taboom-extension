import assert from "node:assert/strict";
import { beforeEach, test } from "vitest";
import type { Features, UiPrefs } from "../../../../src/app/types.ts";
import {
  activeCollapsedSet,
  effectiveSort,
  namesActive,
  nestedTabGroupsActive,
  pinActive,
  reorderActive,
  state,
  tabGroupsActive,
} from "../../../../src/pages/sidepanel/foundation/state.ts";

const on = { enabled: true };

function setup(features: Features, ui: Partial<UiPrefs> = {}, tabGroupsApi = true): void {
  // `as`: capabilities only feature-detects chrome.tabGroups
  globalThis.chrome = (tabGroupsApi ? { tabGroups: {} } : {}) as unknown as typeof chrome;
  state.features = features;
  state.ui = ui as UiPrefs; // `as`: the predicates default every pref they read
}

beforeEach(() => {
  state.sort = "recent";
  state.query = "";
});

test("Sidepanel - State - Starts on the defaults with the flags still to be assigned", () => {
  assert.equal(state.filter, "all");
  assert.equal(state.scope, "all-windows");
  assert.equal(state.cursor, -1);
  assert.equal(state.currentWindowId, null);
});

test("Sidepanel - State - tabGroupsActive needs the flag AND the API; nesting also the strip order", () => {
  setup({ TAB_GROUPS: on });
  assert.equal(tabGroupsActive(), true);
  assert.equal(nestedTabGroupsActive(), true, "same-as-window is the default order");
  setup({ TAB_GROUPS: on }, { groupByWindowTabsOrder: "same-as-window" }, false);
  assert.equal(tabGroupsActive(), false);
  setup({});
  assert.equal(tabGroupsActive(), false);
  const otherOrder = "recent" as UiPrefs["groupByWindowTabsOrder"]; // `as`: any order but same-as-window
  setup({ TAB_GROUPS: on }, { groupByWindowTabsOrder: otherOrder });
  assert.equal(nestedTabGroupsActive(), false);
});

test("Sidepanel - State - namesActive = flag + user toggle; pinActive rides it with its own flag", () => {
  setup({ WINDOW_NAMES: on, WINDOW_PIN: on });
  assert.equal(namesActive(), true);
  assert.equal(pinActive(), true);
  setup({ WINDOW_NAMES: on, WINDOW_PIN: on }, { windowNamesEnabled: false });
  assert.equal(namesActive(), false);
  assert.equal(pinActive(), false);
  setup({ WINDOW_NAMES: on });
  assert.equal(pinActive(), false);
  setup({ WINDOW_PIN: on });
  assert.equal(pinActive(), false);
});

test("Sidepanel - State - effectiveSort falls back to window while a gated sort's flag is off", () => {
  setup({});
  state.sort = "group-domain";
  assert.equal(effectiveSort(), "window");
  assert.equal(state.sort, "group-domain", "the stored preference is not rewritten");
  setup({ GROUP_BY_DOMAIN: on });
  assert.equal(effectiveSort(), "group-domain");
  state.sort = "title";
  assert.equal(effectiveSort(), "title");
});

test("Sidepanel - State - reorderActive only while the list mirrors the strip", () => {
  setup({});
  state.sort = "window";
  assert.equal(reorderActive(), true);
  state.sort = "recent";
  assert.equal(reorderActive(), false);
  state.sort = "group-url"; // flag off → displayed as window
  assert.equal(reorderActive(), true);
  const otherOrder = "recent" as UiPrefs["groupByWindowTabsOrder"]; // `as`: any order but same-as-window
  setup({}, { groupByWindowTabsOrder: otherOrder });
  assert.equal(reorderActive(), false);
});

test("Sidepanel - State - A search folds groups in its own collapse set", () => {
  assert.equal(activeCollapsedSet(), state.collapsedGroups);
  state.query = "docs";
  assert.equal(activeCollapsedSet(), state.searchCollapsedGroups);
});
