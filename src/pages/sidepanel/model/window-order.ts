// Pure: the order every window list shows its windows in.
import { windowGroupName } from "./index.ts";
import type { WindowMaps } from "./index.ts";

// window ids the way every window list shows them (windows popover, "Move tab
// to"): current window first, pinned windows next, the rest ABC by display name
export function orderWindowIds(
  maps: WindowMaps,
  currentWindowId: number | null,
  pinnedIds: ReadonlySet<number>,
): number[] {
  const labelOf = (windowId: number): string =>
    windowGroupName(windowId, {
      currentWindowId,
      indexes: maps.indexes,
      names: maps.names,
    });
  const pinRank = (windowId: number): number => (pinnedIds.has(windowId) ? 0 : 1);
  return [...maps.indexes.keys()].sort((a, b) => {
    if (a === currentWindowId || b === currentWindowId) {
      return a === currentWindowId ? -1 : 1;
    }
    return (
      pinRank(a) - pinRank(b) || labelOf(a).localeCompare(labelOf(b), undefined, { numeric: true, sensitivity: "base" })
    );
  });
}
