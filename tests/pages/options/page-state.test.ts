import assert from "node:assert/strict";
import { test } from "vitest";
import type { Features } from "../../../src/app/types.ts";
import { getFeatures, registerRender, render, setFeatures } from "../../../src/pages/options/page-state.ts";

// first: nothing is set / registered yet in this file's module instance
test("Options - Page state - Reading before boot throws instead of silently doing nothing", () => {
  assert.throws(() => getFeatures(), /setFeatures/);
  assert.throws(() => render(), /registerRender/);
});

test("Options - Page state - getFeatures returns the very object main.ts loaded", () => {
  const loaded: Features = {};
  setFeatures(loaded);
  assert.equal(getFeatures(), loaded);
});

test("Options - Page state - render forwards to the registered implementation and returns its promise", () => {
  let calls = 0;
  const done = Promise.resolve();
  registerRender(() => {
    calls++;
    return done;
  });
  assert.equal(render(), done);
  assert.equal(calls, 1);
});
