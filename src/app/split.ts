// Split view (Chrome 155+: chrome.tabs.createSplit / unsplit) as pure decisions: Chrome
// pairs only two adjacent tabs of one window with the same pin and group state, so this
// works out the moves that get a pair there, or why it cannot. No DOM, no chrome.*.

// the slice of chrome.tabs.Tab the rules read; tests build these by hand
export interface SplitTab {
  id: number;
  windowId: number;
  index: number;
  pinned: boolean;
  groupId: number; // -1 = none
  splitViewId?: number; // absent before Chrome 140; -1 = none
}

// The partner adapts to the anchor in every state Chrome checks (window, pin, group,
// adjacency); only a tab already split, or the same tab twice, is refused.
export type SplitPlan =
  | { refusal: string }
  | {
      tabIds: [number, number]; // anchor first
      move?: { windowId: number; index: number }; // the partner's move, when it is not beside the anchor
      pin?: boolean; // the partner's pin state to set: it differs, or a cross-window move unpins a pinned pair
      group?: number | null; // the anchor's group the partner joins; null = it leaves its own
    };

export function isSplit(tab: Pick<SplitTab, "splitViewId">): boolean {
  return tab.splitViewId !== undefined && tab.splitViewId !== -1;
}

// the partner's move to the slot right after the anchor; undefined when it already sits beside it
export function adjacentMove(
  anchor: Pick<SplitTab, "windowId" | "index">,
  partner: Pick<SplitTab, "windowId" | "index">,
): { windowId: number; index: number } | undefined {
  const sameWindow = anchor.windowId === partner.windowId;
  if (sameWindow && Math.abs(anchor.index - partner.index) === 1) {
    return undefined;
  }
  // tabs.move gives the FINAL index: a partner left of the anchor shifts the anchor down by
  // one when it leaves, so the anchor's own index is the slot right after it
  return {
    windowId: anchor.windowId,
    index: sameWindow && partner.index < anchor.index ? anchor.index : anchor.index + 1,
  };
}

// anchor = the clicked tab: it stays where it is, the partner comes to it
export function splitPlan(anchor: SplitTab, partner: SplitTab): SplitPlan {
  if (anchor.id === partner.id) {
    return { refusal: "Pick two different tabs" };
  }
  if (isSplit(anchor) || isSplit(partner)) {
    return { refusal: "A tab is already in a split view — unsplit it first" };
  }
  const move = adjacentMove(anchor, partner);
  // Chrome unpins a tab moved across windows, so a pinned anchor needs the pin set again
  const pinAfterMove = anchor.windowId !== partner.windowId ? false : partner.pinned;
  return {
    tabIds: [anchor.id, partner.id],
    ...(move ? { move } : {}),
    ...(pinAfterMove === anchor.pinned ? {} : { pin: anchor.pinned }),
    ...(anchor.groupId === partner.groupId ? {} : { group: anchor.groupId === -1 ? null : anchor.groupId }),
  };
}

// A pair reads as one thing in the list: whatever the sort, the partner sits right
// after the first member. Returns the same array when nothing had to move, so a
// caller can skip work.
// chrome.tabs.Tab leaves id optional (sessions-API tabs); an id-less tab is never in a pair
type PairMember = { id?: number; splitViewId?: number };

export function keepSplitPairsTogether<T extends PairMember>(tabs: T[]): T[] {
  if (!tabs.some(isSplit)) {
    return tabs;
  }
  const result: T[] = [];
  const placed = new Set<number>();
  for (const tab of tabs) {
    if (tab.id === undefined) {
      result.push(tab);
      continue;
    }
    if (placed.has(tab.id)) {
      continue;
    }
    result.push(tab);
    placed.add(tab.id);
    if (isSplit(tab)) {
      const partner = tabs.find((other) => other.id !== tab.id && other.splitViewId === tab.splitViewId);
      if (partner?.id !== undefined && !placed.has(partner.id)) {
        result.push(partner);
        placed.add(partner.id);
      }
    }
  }
  return result.every((tab, index) => tab === tabs[index]) ? tabs : result;
}

// Where a split's rows sit in the list order: adjacent members of one split view are
// "first" / "last"; a member whose partner is filtered out is "only" (still a split,
// shown as 1/2 under its own header, like a group with one visible tab).
export type SplitEdge = "first" | "last" | "only";

export function splitPairEdges(tabs: PairMember[]): Map<number, SplitEdge> {
  const edges = new Map<number, SplitEdge>();
  for (let index = 0; index < tabs.length; index++) {
    const tab = tabs[index];
    if (tab?.id === undefined || !isSplit(tab) || edges.has(tab.id)) {
      continue;
    }
    const next = tabs[index + 1];
    if (next?.id !== undefined && next.splitViewId === tab.splitViewId) {
      edges.set(tab.id, "first");
      edges.set(next.id, "last");
    } else {
      edges.set(tab.id, "only");
    }
  }
  return edges;
}
