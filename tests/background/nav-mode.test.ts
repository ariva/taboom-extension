// nav-mode.ts: the per-worker feature-flag memo and the resolved navigation mode.
import assert from "node:assert/strict";
import { test, vi } from "vitest";
import { resolveNavMode } from "../../src/app/core.ts";
import { makeChrome, RAW_FEATURES, TEST_FEATURES } from "../helpers/ui.ts";

const chrome = makeChrome({ stored: {} });
Object.assign(globalThis, { chrome });

// each test starts a fresh worker life: the memo is module state
function freshWorker(): Promise<typeof import("../../src/background/nav-mode.ts")> {
  vi.resetModules();
  return import("../../src/background/nav-mode.ts");
}

// the helpers' fetch stub serves features.json; fail it `times` times, then hand back to it
const realFetch = globalThis.fetch;
function failFetch(times: number): void {
  let left = times;
  globalThis.fetch = async (...args: Parameters<typeof fetch>) => {
    left -= 1;
    if (left <= 0) {
      globalThis.fetch = realFetch;
    }
    if (left >= 0) {
      throw new TypeError("Failed to fetch");
    }
    return realFetch(...args);
  };
}

// the in-call retry waits FEATURES_RETRY_MS: run the clock, not the test
async function settled<T>(pending: Promise<T>): Promise<T> {
  await vi.advanceTimersByTimeAsync(5_000);
  return pending;
}

test("Nav mode - a fetch that fails once is retried inside the same call", async () => {
  vi.useFakeTimers();
  const { getFeatures } = await freshWorker();
  failFetch(1);
  try {
    assert.deepEqual(await settled(getFeatures()), RAW_FEATURES, "the retry answers the call");
  } finally {
    globalThis.fetch = realFetch;
    vi.useRealTimers();
  }
});

test("Nav mode - a fetch that fails twice answers fail-closed once and is fetched again on the next call", async () => {
  vi.useFakeTimers();
  const { getFeatures } = await freshWorker();
  failFetch(2);
  try {
    assert.deepEqual(await settled(getFeatures()), {}, "the failing call reads every flag as disabled");
    assert.deepEqual(
      await settled(getFeatures()),
      RAW_FEATURES,
      "the next call fetches again instead of serving the failure",
    );
    assert.deepEqual(await settled(getFeatures()), RAW_FEATURES, "and a good answer is memoized");
  } finally {
    globalThis.fetch = realFetch;
    vi.useRealTimers();
  }
});

test("Nav mode - the navigation mode resolved from a failed fetch is not cached either", async () => {
  vi.useFakeTimers();
  const { navMode } = await freshWorker();
  failFetch(2);
  try {
    assert.equal(await settled(navMode()), "off", "fail-closed for that call");
    assert.equal(
      await settled(navMode()),
      resolveNavMode(TEST_FEATURES, {}),
      "re-resolved from the real flags next time",
    );
  } finally {
    globalThis.fetch = realFetch;
    vi.useRealTimers();
  }
});
