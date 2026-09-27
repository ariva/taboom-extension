// Emits files that live outside src/ and public/ into the build output, unchanged —
// for files the runtime fetches by URL (chrome.runtime.getURL) but that must stay where
// they are in the repo (release notes, feature flags), and for dev-only assets.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import type { Plugin } from "vite";

export interface StaticFile {
  /** file or directory, relative to the project root */
  from: string;
  /** output path (file) or output directory (directory) */
  to: string;
  /** emit in development builds only */
  devOnly?: boolean;
}

function* walk(from: string, to: string): Generator<[string, string]> {
  if (!statSync(from).isDirectory()) {
    yield [from, to];
    return;
  }
  for (const name of readdirSync(from)) {
    yield* walk(join(from, name), `${to}/${name}`);
  }
}

export function staticFilesPlugin(files: StaticFile[]): Plugin {
  let isDev = false;
  return {
    name: "extension:static-files",
    configResolved(config) {
      isDev = config.mode === "development";
    },
    buildStart() {
      for (const file of files) {
        this.addWatchFile(file.from); // watch mode: a changed CHANGES.md / features.json rebuilds
      }
    },
    generateBundle() {
      for (const file of files) {
        if (file.devOnly && !isDev) {
          continue;
        }
        for (const [source, fileName] of walk(file.from, file.to)) {
          this.emitFile({ type: "asset", fileName, source: readFileSync(source) });
        }
      }
    },
  };
}
