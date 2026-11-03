import assert from "node:assert/strict";
import { test } from "vitest";
import { FOCUS_SETTLE_MS, hintSurvives } from "../../../../src/pages/sidepanel/model/focus-intent.ts";

const hint = { windowId: 2, at: 1_000 };

test("Model - FocusHint: a focus change inside the settle window is the window manager's dance, the hint stays", () => {
  assert.equal(hintSurvives(hint, 7, 1_000 + FOCUS_SETTLE_MS), true);
  assert.equal(hintSurvives(hint, 2, 1_100), true, "the hinted window itself: the refresh decides");
  assert.equal(hintSurvives(hint, -1, 1_000 + FOCUS_SETTLE_MS + 5_000), true, "focus leaving Chrome proves nothing");
});

test("Model - FocusHint: another window after the settle window - the user moved focus, the hint goes", () => {
  assert.equal(hintSurvives(hint, 7, 1_000 + FOCUS_SETTLE_MS + 1), false);
});
