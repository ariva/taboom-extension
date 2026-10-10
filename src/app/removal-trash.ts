// Undo stack for list removals (keep-alive marks, protection rules): every removal
// is one action, newest last; Settings → Restore pops the newest. Pure.
import type { Removal } from "./types.ts";

// ponytail: a flat cap bounds storage.local; per-item dedupe if anyone fills 50 actions
const LIMIT = 50;

export function recordRemoval<T>(trash: Removal<T>[], items: T[], now: number): Removal<T>[] {
  if (items.length === 0) {
    return trash;
  }
  return [...trash, { at: now, items }].slice(-LIMIT);
}

export function popRemoval<T>(trash: Removal<T>[]): { newest: Removal<T>; rest: Removal<T>[] } | undefined {
  const newest = trash.at(-1);
  return newest ? { newest, rest: trash.slice(0, -1) } : undefined;
}
