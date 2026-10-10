import assert from "node:assert/strict";
import { test } from "vitest";
import { popRemoval, recordRemoval } from "../../src/app/removal-trash.ts";
import type { Removal } from "../../src/app/types.ts";

const NOW = 1_700_000_000_000;

test("Removal trash - recordRemoval appends newest last, skips empty removals, caps at 50 actions", () => {
  const first = recordRemoval<string>([], ["a"], NOW - 400 * 24 * 60 * 60_000);
  const second = recordRemoval(first, ["b", "c"], NOW);
  assert.deepEqual(second, [...first, { at: NOW, items: ["b", "c"] }], "no expiry: a year-old action is still there");
  assert.equal(recordRemoval(first, [], NOW), first, "nothing removed: nothing recorded");
  let many: Removal<number>[] = [];
  for (let index = 0; index < 60; index += 1) {
    many = recordRemoval(many, [index], NOW + index);
  }
  assert.equal(many.length, 50);
  assert.equal(many[0]?.at, NOW + 10, "oldest actions dropped first");
});

test("Removal trash - popRemoval hands back the newest action and the rest; undefined when empty", () => {
  const trash = recordRemoval(recordRemoval<string>([], ["a"], NOW - 1), ["b"], NOW);
  const popped = popRemoval(trash);
  assert.deepEqual(popped, { newest: { at: NOW, items: ["b"] }, rest: [{ at: NOW - 1, items: ["a"] }] });
  assert.equal(popRemoval([]), undefined);
});
