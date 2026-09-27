// Typed edges of sidepanel/model/* added with the Phase 5 type-debt cleanup.
import assert from "node:assert/strict";
import { test } from "vitest";
import { TAB_GROUP_COLORS, tabGroupColor, windowMaps } from "../../../../src/pages/sidepanel/model/index.ts";

test("Model - TabGroupColor: known colors map to hex, missing or unknown ones to undefined", () => {
  assert.equal(tabGroupColor("blue"), TAB_GROUP_COLORS.blue);
  assert.equal(tabGroupColor(undefined), undefined, "vanished group");
  assert.equal(tabGroupColor("teal"), undefined, "color this table lacks");
});

test("Model - WindowMaps: a null current window (before the first refresh) still holds slot #1", () => {
  // `as`: windowMaps reads only windowId
  const tabs = [{ windowId: 5 }, { windowId: 2 }] as chrome.tabs.Tab[];
  const { indexes } = windowMaps(tabs, null);
  assert.deepEqual(
    [...indexes],
    [
      [2, 2],
      [5, 3],
    ],
  );
});
