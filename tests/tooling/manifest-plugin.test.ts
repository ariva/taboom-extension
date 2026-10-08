// tooling/manifest-plugin.ts — the manifest must follow its inputs in watch mode.
import assert from "node:assert/strict";
import { test } from "vitest";
import { manifestPlugin } from "../../tooling/manifest-plugin.ts";

// the two plugin-context methods the plugin uses
function fakeContext() {
  const watched: string[] = [];
  const emitted: { fileName: string; source: string }[] = [];
  return {
    watched,
    emitted,
    addWatchFile: (file: string) => void watched.push(file),
    emitFile: (asset: { fileName: string; source: string }) => void emitted.push(asset),
  };
}

test("Tooling - Manifest plugin - Watches its inputs and rebuilds the manifest on every bundle", () => {
  let version = "1.0.0";
  const plugin = manifestPlugin(() => ({ version }), ["/repo/package.json"]);
  const context = fakeContext();
  // `as never`: the hooks are typed against Rollup's full PluginContext; the fake covers what they call
  (plugin.buildStart as (this: unknown) => void).call(context as never);
  assert.deepEqual(context.watched, ["/repo/package.json"], "a bumped package.json triggers a rebuild");
  const generate = plugin.generateBundle as (this: unknown) => void;
  generate.call(context as never);
  version = "1.0.1"; // bump between two watch-mode rebuilds
  generate.call(context as never);
  assert.deepEqual(
    context.emitted.map((asset) => JSON.parse(asset.source).version),
    ["1.0.0", "1.0.1"],
    "the version is read at emit time, not once at config load",
  );
  assert.equal(context.emitted[0]?.fileName, "manifest.json");
});
