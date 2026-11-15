// src/app/env.ts — the dev marker comes from the BUILD (Vite's mode), not from the manifest:
// a store install on Firefox has no update_url either, and a constant folds away in a production build.
import assert from "node:assert/strict";
import { test } from "vitest";
import { makeChrome } from "../helpers/ui.ts";

Object.assign(globalThis, { chrome: makeChrome({}) });
const { DEV_PREFIX, IS_DEV, getReleaseVersion } = await import("../../src/app/env.ts");

test("Core - Env - outside a development build nothing is marked DEV", () => {
  assert.equal(
    import.meta.env.MODE,
    "test",
    "Vitest runs in its own mode, like a production build is not 'development'",
  );
  assert.equal(IS_DEV, false);
  assert.equal(DEV_PREFIX, "");
});

test("Core - Env - the release version is the manifest's", () => {
  assert.equal(getReleaseVersion(), "0.0.0-test");
});
