// Validates features.json so a typo'd flag can't silently disable (or enable) a feature.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { featureEnabled } from "../core/core.js";

const features = JSON.parse(readFileSync(new URL("../features.json", import.meta.url), "utf8"));

test("Features - Every key has a boolean `enabled`", () => {
  const keys = Object.keys(features);
  assert.ok(keys.length > 0, "at least one feature key");
  for (const [key, value] of Object.entries(features)) {
    assert.equal(typeof value, "object", `${key} must map to an object`);
    assert.equal(typeof value.enabled, "boolean", `${key}.enabled must be boolean`);
  }
});

test("Features - featureEnabled reads flags and defaults missing keys to off", () => {
  assert.equal(featureEnabled({ X: { enabled: true } }, "X"), true);
  assert.equal(featureEnabled({ X: { enabled: false } }, "X"), false);
  assert.equal(featureEnabled({}, "X"), false);
});

test("Features - loadFeatures returns an injected features object verbatim", async () => {
  const { loadFeatures } = await import("../core/storage.js");
  const injected = { NAVIGATION_DROPDOWN: { enabled: true } };
  assert.deepEqual(await loadFeatures(injected), injected);
});

test("Features - applyExperimental flips experimental features on only when both gates pass", async () => {
  const { applyExperimental } = await import("../core/core.js");
  const base = {
    ALLOW_EXPERIMENTAL: { enabled: true },
    A: { enabled: false, experimental: true },
    B: { enabled: false },
    C: { enabled: true },
  };
  assert.equal(featureEnabled(applyExperimental(base, true), "A"), true, "experimental flips on");
  assert.equal(featureEnabled(applyExperimental(base, true), "B"), false, "non-experimental stays off");
  assert.equal(featureEnabled(applyExperimental(base, true), "C"), true, "enabled untouched");
  assert.equal(featureEnabled(applyExperimental(base, false), "A"), false, "user opt-in required");
  const noAllow = { ...base, ALLOW_EXPERIMENTAL: { enabled: false } };
  assert.equal(featureEnabled(applyExperimental(noAllow, true), "A"), false, "ALLOW_EXPERIMENTAL required");
});
