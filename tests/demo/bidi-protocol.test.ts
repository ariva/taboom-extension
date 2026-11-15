// demo/firefox/protocol.ts — the values the demo hands a page function and reads back must survive
// the BiDi encoding both ways (the Firefox harness has no Playwright to do it, T-0152).
import assert from "node:assert/strict";
import { test } from "vitest";
import { fromRemoteValue, toLocalValue } from "../../demo/firefox/protocol.ts";

test("Demo - BiDi protocol - plain data round-trips through LocalValue and RemoteValue", () => {
  const value = {
    text: "a",
    count: 3,
    flag: true,
    none: null,
    list: [1, "two", { three: 3 }],
    nested: { specs: [{ url: "http://a.test/", pinned: false }] },
  };
  assert.deepEqual(fromRemoteValue(toLocalValue(value)), value);
});

test("Demo - BiDi protocol - the special numbers and undefined are spelled the way the protocol wants", () => {
  assert.deepEqual(toLocalValue(Number.NaN), { type: "number", value: "NaN" });
  assert.deepEqual(toLocalValue(-0), { type: "number", value: "-0" });
  assert.deepEqual(toLocalValue(Number.POSITIVE_INFINITY), { type: "number", value: "Infinity" });
  assert.deepEqual(toLocalValue(undefined), { type: "undefined" });
  assert.ok(Number.isNaN(fromRemoteValue({ type: "number", value: "NaN" })));
  assert.equal(fromRemoteValue({ type: "number", value: "-Infinity" }), Number.NEGATIVE_INFINITY);
  assert.equal(fromRemoteValue({ type: "undefined" }), undefined);
});

test("Demo - BiDi protocol - a map comes back as an object, a node or a function as nothing", () => {
  assert.deepEqual(
    fromRemoteValue({
      type: "map",
      value: [
        ["a", { type: "number", value: 1 }],
        [
          { type: "number", value: 2 },
          { type: "string", value: "b" },
        ],
      ],
    }),
    { a: 1, "2": "b" },
  );
  assert.equal(fromRemoteValue({ type: "node", value: {} }), undefined);
  assert.throws(() => toLocalValue(() => 1), /cannot serialize a function/);
});
