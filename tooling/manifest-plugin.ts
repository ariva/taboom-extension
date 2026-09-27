// Emits manifest.json into the build output from a typed manifest function.
// Generic: knows nothing about the extension beyond "a function that returns a manifest".
import type { Plugin } from "vite";

export function manifestPlugin(build: () => object): Plugin {
  return {
    name: "extension:manifest",
    generateBundle() {
      this.emitFile({
        type: "asset",
        fileName: "manifest.json",
        source: `${JSON.stringify(build(), null, 2)}\n`,
      });
    },
  };
}
