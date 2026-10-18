// scripts/build.sh is the release gate; the demo recording is part of it so no release ships
// with a stale README tour. The step must come after the pack (it films dist/prod) and stay
// skippable for a quick repack (SKIP_DEMO=1).
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { test } from "vitest";

const script = readFileSync(resolve(import.meta.dirname, "../../scripts/build.sh"), "utf8");

test("Tooling - Build script - records the demo after packing unless SKIP_DEMO=1", () => {
  const pack = script.indexOf("scripts/pack.sh");
  const record = script.indexOf("demo/record.ts");
  const encode = script.indexOf("demo/encode.sh");
  assert.ok(pack > 0, "packs dist/prod");
  assert.ok(record > pack && encode > record, "demo recorded and encoded after the pack");
  const guard = script.slice(0, record).lastIndexOf("SKIP_DEMO");
  assert.ok(guard > pack, "the demo step is guarded by SKIP_DEMO");
});
