// scripts/build.sh is the release gate; the demo recording is its optional last step (RECORD_DEMO=1,
// what `just publish` sets) so a release ships with a current README tour while a plain `just build`
// stays a quick repack. The step must come after the pack (it films dist/prod).
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { test } from "vitest";

const script = readFileSync(resolve(import.meta.dirname, "../../scripts/build.sh"), "utf8");

test("Tooling - Build script - records the demo after packing only with RECORD_DEMO=1", () => {
  const pack = script.indexOf("scripts/pack.sh");
  const record = script.indexOf("demo/record.ts");
  const encode = script.indexOf("demo/encode.sh");
  assert.ok(pack > 0, "packs dist/prod");
  assert.ok(record > pack && encode > record, "demo recorded and encoded after the pack");
  const guard = script.slice(0, record).lastIndexOf("RECORD_DEMO");
  assert.ok(guard > pack, "the demo step is guarded by RECORD_DEMO");
  assert.ok(!script.includes("SKIP_DEMO"), "the old SKIP_DEMO switch is gone");
});
