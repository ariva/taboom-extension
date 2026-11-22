// scripts/build.sh is the release gate; the demo recording is its optional last step (RECORD_DEMO=1,
// what `just publish` sets) so a release ships with a current README tour while a plain `just build`
// stays a quick repack. The step must come after the pack (it films dist/chrome).
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { test } from "vitest";

const script = readFileSync(resolve(import.meta.dirname, "../../scripts/build.sh"), "utf8");

test("Tooling - Build script - records the demo after packing only with RECORD_DEMO=1", () => {
  const pack = script.indexOf("scripts/pack.sh");
  const record = script.indexOf("demo/record.ts");
  const encode = script.indexOf("demo/encode.sh");
  assert.ok(pack > 0, "packs dist/chrome");
  assert.ok(record > pack && encode > record, "demo recorded and encoded after the pack");
  const guard = script.slice(0, record).lastIndexOf("RECORD_DEMO");
  assert.ok(guard > pack, "the demo step is guarded by RECORD_DEMO");
  assert.ok(!script.includes("SKIP_DEMO"), "the old SKIP_DEMO switch is gone");
});

// T-0152: the Firefox zip is packed from the same sources and validated with AMO's linter, before the e2e smoke
test("Tooling - Build script - packs the Firefox flavour and lints it after the Chrome zip", () => {
  const chromePack = script.indexOf('scripts/pack.sh"');
  const firefoxPack = script.indexOf("TARGET=firefox");
  const lint = script.indexOf("web-ext lint --source-dir dist/firefox");
  const e2e = script.indexOf("playwright test");
  assert.ok(chromePack > 0 && firefoxPack > chromePack, "Firefox packed after Chrome");
  assert.ok(lint > firefoxPack && e2e > lint, "linted before the e2e smoke");
});

// the Firefox film follows the Chrome one under the same guard: the dist/firefox packed above, its own
// take folder, published to its own docs folder (the Chrome encode owns the stills)
test("Tooling - Build script - with RECORD_DEMO=1 the Firefox demo is recorded and encoded after the Chrome one", () => {
  const chromeEncode = script.indexOf("./demo/encode.sh");
  const firefoxRecord = script.indexOf("demo/record.ts --browser firefox");
  const firefoxEncode = script.indexOf("DEMO_PUBLISH=docs/assets/demo/firefox ./demo/encode.sh");
  assert.ok(firefoxRecord > chromeEncode, "Firefox recorded after the Chrome encode");
  assert.ok(firefoxEncode > firefoxRecord, "Firefox take encoded into docs/assets/demo/firefox");
  assert.match(
    script.slice(firefoxRecord, firefoxEncode + 80),
    /DEMO_DIR="dist\/demo\/.+-firefox"/,
    "from its own take folder",
  );
  const guardEnd = script.indexOf("\nelse", chromeEncode);
  assert.ok(firefoxEncode < guardEnd, "inside the RECORD_DEMO branch: a plain build films nothing");
});
