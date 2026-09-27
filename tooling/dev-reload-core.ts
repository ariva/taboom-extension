// Pure part of the dev-reload loop: decide what a rebuild means for the loaded extension.
// No Vite, no network — unit-tested in tests/tooling/dev-reload.test.ts.

export type ReloadKind = "none" | "pages" | "extension";

/** Output files whose change only needs open extension pages to reload themselves. */
function isPageFile(fileName: string, pageDirs: readonly string[]): boolean {
  return (
    pageDirs.some((dir) => fileName.startsWith(`${dir}/`)) ||
    (fileName.startsWith("assets/") && !fileName.endsWith(".js"))
  );
}

/**
 * Anything outside the pages — service worker, shared chunks, manifest, static files —
 * needs the whole extension reloaded: a running worker never re-reads its files.
 */
export function classifyChange(changedFiles: readonly string[], pageDirs: readonly string[]): ReloadKind {
  if (changedFiles.length === 0) {
    return "none";
  }
  return changedFiles.every((file) => isPageFile(file, pageDirs)) ? "pages" : "extension";
}

/** Names of files that are new, gone, or whose content hash differs. */
export function diffBuilds(previous: ReadonlyMap<string, string>, next: ReadonlyMap<string, string>): string[] {
  const changed: string[] = [];
  for (const [file, hash] of next) {
    if (previous.get(file) !== hash) {
      changed.push(file);
    }
  }
  for (const file of previous.keys()) {
    if (!next.has(file)) {
      changed.push(file);
    }
  }
  return changed.sort();
}
