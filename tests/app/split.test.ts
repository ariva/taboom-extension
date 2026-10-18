import assert from "node:assert/strict";
import { test } from "vitest";
import { adjacentMove, isSplit, keepSplitPairsTogether, splitPairEdges, splitPlan } from "../../src/app/split.ts";

const tab = (overrides: Partial<Parameters<typeof splitPlan>[0]> = {}) => ({
  id: 1,
  windowId: 1,
  index: 0,
  pinned: false,
  groupId: -1,
  ...overrides,
});

test("Split - isSplit: a tab belongs to a split view only with a real split id", () => {
  assert.equal(isSplit(tab()), false, "field absent (Chrome < 140)");
  assert.equal(isSplit(tab({ splitViewId: -1 })), false, "SPLIT_VIEW_ID_NONE");
  assert.equal(isSplit(tab({ splitViewId: 7 })), true);
});

test("Split - plan: adjacent tabs of one window need nothing but the split", () => {
  assert.deepEqual(splitPlan(tab({ id: 1, index: 3 }), tab({ id: 2, index: 4 })), { tabIds: [1, 2] });
  assert.deepEqual(splitPlan(tab({ id: 1, index: 3 }), tab({ id: 2, index: 2 })), { tabIds: [1, 2] }, "either side");
});

test("Split - plan: the partner moves next to the anchor (same window or across), keeping its pin, then matches its group", () => {
  // same window, partner further right: it lands right after the anchor
  assert.deepEqual(splitPlan(tab({ id: 1, index: 1 }), tab({ id: 2, index: 5 })), {
    tabIds: [1, 2],
    move: { windowId: 1, index: 2 },
  });
  // same window, partner on the left: removing it shifts the anchor left, so the anchor's own index is "after it"
  assert.deepEqual(splitPlan(tab({ id: 1, index: 4 }), tab({ id: 2, index: 0 })), {
    tabIds: [1, 2],
    move: { windowId: 1, index: 4 },
  });
  // other window: moved over (Chrome unpins a tab on a cross-window move — a pinned anchor re-pins it)
  assert.deepEqual(
    splitPlan(tab({ id: 1, index: 2, pinned: true }), tab({ id: 2, windowId: 9, index: 0, pinned: true })),
    {
      tabIds: [1, 2],
      move: { windowId: 1, index: 3 },
      pin: true,
    },
  );
  assert.deepEqual(splitPlan(tab({ id: 1, index: 2 }), tab({ id: 2, windowId: 9, index: 0 })), {
    tabIds: [1, 2],
    move: { windowId: 1, index: 3 },
  });
  // pin mismatch: the partner takes the anchor's pin state (Chrome splits only equal states)
  assert.deepEqual(splitPlan(tab({ id: 1, index: 0, pinned: true }), tab({ id: 2, index: 1 })), {
    tabIds: [1, 2],
    pin: true,
  });
  assert.deepEqual(splitPlan(tab({ id: 1, index: 3 }), tab({ id: 2, index: 0, pinned: true })), {
    tabIds: [1, 2],
    move: { windowId: 1, index: 3 },
    pin: false,
  });
  // group mismatch: the partner joins the anchor's group, or leaves its own
  assert.deepEqual(splitPlan(tab({ id: 1, index: 0, groupId: 7 }), tab({ id: 2, index: 1 })), {
    tabIds: [1, 2],
    group: 7,
  });
  assert.deepEqual(splitPlan(tab({ id: 1, index: 0 }), tab({ id: 2, index: 1, groupId: 7 })), {
    tabIds: [1, 2],
    group: null,
  });
});

test("Split - plan: refusals name the reason", () => {
  assert.deepEqual(splitPlan(tab({ id: 1 }), tab({ id: 1 })), { refusal: "Pick two different tabs" });
  assert.deepEqual(splitPlan(tab({ id: 1, splitViewId: 3 }), tab({ id: 2, index: 1 })), {
    refusal: "A tab is already in a split view — unsplit it first",
  });
  assert.deepEqual(splitPlan(tab({ id: 1 }), tab({ id: 2, index: 1, splitViewId: 3 })), {
    refusal: "A tab is already in a split view — unsplit it first",
  });
});

test("Split - adjacentMove: nothing when side by side, else the slot beside the anchor", () => {
  assert.equal(adjacentMove(tab({ id: 1, index: 3 }), tab({ id: 2, index: 4 })), undefined);
  assert.equal(adjacentMove(tab({ id: 1, index: 3 }), tab({ id: 2, index: 2 })), undefined);
  assert.deepEqual(adjacentMove(tab({ id: 1, index: 3 }), tab({ id: 2, index: 0 })), { windowId: 1, index: 3 });
  assert.deepEqual(adjacentMove(tab({ id: 1, index: 3 }), tab({ id: 2, index: 7 })), { windowId: 1, index: 4 });
  assert.deepEqual(adjacentMove(tab({ id: 1, index: 3 }), tab({ id: 2, windowId: 9, index: 4 })), {
    windowId: 1,
    index: 4,
  });
});

test("Split - keepSplitPairsTogether: the partner follows the first member, everything else keeps its order", () => {
  const rows = [
    { id: 1, splitViewId: 9 },
    { id: 2, splitViewId: -1 },
    { id: 3, splitViewId: 9 },
    { id: 4 },
    { id: 5, splitViewId: 4 },
    { id: 6, splitViewId: 4 },
  ];
  assert.deepEqual(
    keepSplitPairsTogether(rows).map((row) => row.id),
    [1, 3, 2, 4, 5, 6],
  );
  const same = rows.filter((row) => row.id !== 3);
  assert.equal(keepSplitPairsTogether(same), same, "no pair to pull together: the same array back");
});

test("Split - splitPairEdges: adjacent members get first / last, a lone member (partner filtered out) is 'only'", () => {
  const edges = splitPairEdges([
    { id: 1, splitViewId: 9 },
    { id: 3, splitViewId: 9 },
    { id: 2, splitViewId: -1 },
    { id: 5, splitViewId: 4 }, // its partner is filtered out: still a split, shown as 1/2
    { id: 7, splitViewId: 6 },
    { id: 8, splitViewId: 6 },
  ]);
  assert.deepEqual(
    [...edges],
    [
      [1, "first"],
      [3, "last"],
      [5, "only"],
      [7, "first"],
      [8, "last"],
    ],
  );
});
