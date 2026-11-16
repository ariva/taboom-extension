import assert from "node:assert/strict";
import { test } from "vitest";
import { moveItemTo } from "../../src/lib/list.ts";

const list = [{ url: "a" }, { url: "b" }, { url: "c" }];
const keyOf = (item: { url: string }) => item.url;

test("Lib - List - moveItemTo lands the dragged item at the target's index: after it going down, before it going up", () => {
  assert.deepEqual(moveItemTo(list, keyOf, "a", "c")?.map(keyOf), ["b", "c", "a"]);
  assert.deepEqual(moveItemTo(list, keyOf, "c", "a")?.map(keyOf), ["c", "a", "b"]);
  assert.deepEqual(list.map(keyOf), ["a", "b", "c"], "the input is not touched");
});

test("Lib - List - moveItemTo returns undefined when nothing moves", () => {
  assert.equal(moveItemTo(list, keyOf, "a", "a"), undefined, "onto itself");
  assert.equal(moveItemTo(list, keyOf, "a", "zz"), undefined, "unknown target");
  assert.equal(moveItemTo(list, keyOf, "zz", "a"), undefined, "unknown dragged");
});
