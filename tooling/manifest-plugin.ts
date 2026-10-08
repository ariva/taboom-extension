// Emits manifest.json into the build output from a typed manifest function.
// Generic: knows nothing about the extension beyond "a function that returns a manifest".
import type { Plugin } from "vite";

// watchFiles: inputs the manifest is built from (e.g. package.json for the version). In a
// watch build, Rollup rebuilds when one changes — and `build()` runs per bundle, so the
// emitted manifest follows them instead of freezing at config-load time.
export function manifestPlugin(build: () => object, watchFiles: string[] = []): Plugin {
  return {
    name: "extension:manifest",
    buildStart() {
      for (const file of watchFiles) {
        this.addWatchFile(file);
      }
    },
    generateBundle() {
      this.emitFile({
        type: "asset",
        fileName: "manifest.json",
        source: `${JSON.stringify(build(), null, 2)}\n`,
      });
    },
  };
}
