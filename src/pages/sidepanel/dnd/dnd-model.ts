// Pure drag & drop decisions: what dropping a tab on a list element means, and the saved
// group order after a group row is dragged onto another. No DOM, no chrome.*, no state.

// What a drop on this element would do: {windowId, index} or null (invalid).
// Cross-window: any row of the target window (drop lands AT that row's strip
// position) or its group header (appends at the end). Same window: only a row,
// and only while reorderActive() — that is the drag-to-reorder gesture.
// tabGroupId: join that tab group (-1 = leave the group); otherwise a strip move,
// regroupId = group membership to restore after it
export type DropSpec =
  | { tabGroupId: number; windowId?: undefined; index?: undefined; regroupId?: undefined }
  | { tabGroupId?: undefined; windowId: number; index: number; regroupId?: number | null };

// the fields of a tab the drop decision reads
export interface DropTab {
  id: number;
  windowId: number;
  index?: number;
  groupId?: number;
}

// what is under the pointer, read off the DOM by the caller
export interface DropTargetInfo {
  targetTab: DropTab | null | undefined; // tab of the .row under the pointer
  tabGroupHeaderId: number | null; // closest [data-tab-group-id] (-1 = "No group")
  headerWindowId: number | null; // closest .group-header's window id
}

export interface DropFlags {
  tabGroups: boolean; // tabGroupsActive()
  reorder: boolean; // reorderActive()
  tabGroupSort: boolean; // effectiveSort() === "group-tabgroup"
}

// source: the dragged tab (undefined = it is gone — nothing can be dropped)
export function dropSpecFor(
  source: DropTab | undefined,
  { targetTab, tabGroupHeaderId, headerWindowId }: DropTargetInfo,
  flags: DropFlags,
): DropSpec | null {
  if (!source) {
    return null;
  }
  if (flags.tabGroups) {
    // group headers (B sub-headers + Tab groups sort headers) take the drop:
    // join that group ("No group" = leave the group)
    if (tabGroupHeaderId != null) {
      return { tabGroupId: tabGroupHeaderId };
    }
    // a row inside a group the dragged tab is NOT in: drop joins that group
    const targetGroup = targetTab?.groupId ?? -1;
    if (targetTab && targetGroup !== -1 && (source.groupId ?? -1) !== targetGroup) {
      return { tabGroupId: targetGroup };
    }
    // reorder INSIDE a group: rows are strip-ordered wherever a group renders
    // (window view runs AND the Tab groups sort) — allow the move in both;
    // regroupId restores the membership tabs.move strips
    if (
      targetTab &&
      targetTab.id !== source.id &&
      (source.groupId ?? -1) !== -1 &&
      targetTab.groupId === source.groupId &&
      (flags.reorder || flags.tabGroupSort)
    ) {
      return { windowId: targetTab.windowId, index: targetTab.index ?? -1, regroupId: source.groupId };
    }
  }
  const windowId = targetTab?.windowId ?? headerWindowId;
  if (windowId == null) {
    return null;
  }
  if (windowId === source.windowId) {
    if (!flags.reorder || !targetTab || targetTab.id === source.id) {
      return null;
    }
    return {
      windowId,
      index: targetTab.index ?? -1,
      // reorder INSIDE a group: tabs.move kicks the tab out of its group, so
      // the drop handler re-groups it after the move (it lands inside the
      // group's range, so membership comes back without another move)
      regroupId: (source.groupId ?? -1) !== -1 && targetTab.groupId === source.groupId ? source.groupId : null,
    };
  }
  return { windowId, index: targetTab?.index ?? -1 };
}

// Groups view reorder: `ids` = the group rows top to bottom, `groups` = the open groups,
// `savedOrder` = ui.quickLaunchGroupOrder. Returns the new order, by title
export function reorderedGroupTitles(
  ids: readonly number[],
  draggedId: number,
  targetId: number,
  groups: ReadonlyMap<number, { title?: string }>,
  savedOrder: readonly string[],
): string[] {
  const next = [...ids];
  // pull the dragged id out, put it back at the target's old index: lands
  // after the target when dragged down, before it when dragged up
  const to = next.indexOf(targetId);
  next.splice(next.indexOf(draggedId), 1);
  next.splice(to, 0, draggedId);
  const titles = [...new Set(next.map((id) => groups.get(id)?.title ?? ""))];
  // ponytail: titles of groups not open right now keep their slot at the end and
  // are never pruned — prune on save if the list ever grows noticeably
  const stale = savedOrder.filter((title) => !titles.includes(title));
  return [...titles, ...stale];
}
