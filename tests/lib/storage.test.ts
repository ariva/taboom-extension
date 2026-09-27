import assert from "node:assert/strict";
import { test } from "vitest";
import { createStorage } from "../../src/lib/storage.ts";

interface Schema {
  count: number;
  names: string[];
}

// hand-rolled fake: two areas that log every call with its exact arguments
function fakeChrome(calls: unknown[][], data: Record<string, Record<string, unknown>>): void {
  const area = (name: string) => ({
    get: async (keys: unknown) => {
      calls.push([name, "get", keys]);
      return { ...data[name] };
    },
    set: async (patch: unknown) => {
      calls.push([name, "set", patch]);
    },
    remove: async (keys: unknown) => {
      calls.push([name, "remove", keys]);
    },
  });
  // `as`: a two-area stand-in for the chrome global
  globalThis.chrome = { storage: { local: area("local"), session: area("session") } } as unknown as typeof chrome;
}

test("Lib - Storage - get/set/remove hit the chosen area with the arguments unchanged", async () => {
  const calls: unknown[][] = [];
  fakeChrome(calls, { local: { count: 3 }, session: {} });
  const local = createStorage<Schema>("local");
  const session = createStorage<Schema>("session");
  const patch = { names: ["a"] };

  const { count } = await local.get("count");
  await local.get(["count", "names"]);
  await local.set(patch);
  await local.remove("count");
  await session.remove(["count", "names"]);

  assert.equal(count, 3);
  assert.deepEqual(calls, [
    ["local", "get", "count"],
    ["local", "get", ["count", "names"]],
    ["local", "set", { names: ["a"] }],
    ["local", "remove", "count"],
    ["session", "remove", ["count", "names"]],
  ]);
  assert.equal(calls[2]?.[2], patch, "patch object passed through, not copied");
});

test("Lib - Storage - Reading an empty area yields undefined values, so defaults apply", async () => {
  fakeChrome([], { local: {}, session: {} });
  const { count = 7, names } = await createStorage<Schema>("local").get(["count", "names"]);
  assert.equal(count, 7);
  assert.equal(names, undefined);
});

test("Lib - Storage - The chrome global is resolved per call, not captured at creation", async () => {
  const before: unknown[][] = [];
  const after: unknown[][] = [];
  fakeChrome(before, { local: {}, session: {} });
  const local = createStorage<Schema>("local");
  fakeChrome(after, { local: {}, session: {} });

  await local.set({ count: 1 });

  assert.equal(before.length, 0);
  assert.deepEqual(after, [["local", "set", { count: 1 }]]);
});
