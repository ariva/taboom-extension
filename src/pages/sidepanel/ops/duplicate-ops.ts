// Duplicate cleanups: which tabs go is decided in app/duplicates.ts; this asks once,
// naming windows that would close with their last tab, and closes through the shared
// closeTabs. Shared by the Dupes view (per set / ticked sets) and the quick-actions menu
// (every set, "There can be only one").
import {
  type CleanupMode,
  closingWindows,
  type DuplicateSet,
  duplicateSets,
  duplicatesToClose,
} from "../../../app/duplicates.ts";
import { duplicatesActive, type PanelTab, state } from "../foundation/state.ts";
import { closeTabs } from "./actions.ts";
import { windowLabel } from "./window-ops.ts";

export type DupSet = DuplicateSet<PanelTab>;

export const keeperContext = () => ({ currentWindowId: state.currentWindowId, keepAlive: state.keepAlive });

const plural = (count: number, noun: string) => `${count} ${noun}${count === 1 ? "" : "s"}`;

export async function cleanupDuplicates(sets: DupSet[], mode: CleanupMode): Promise<void> {
  const ids = sets.flatMap((set) => duplicatesToClose(set, mode, keeperContext()).map((tab) => tab.id));
  if (ids.length === 0) {
    return;
  }
  const message = [
    `Close ${plural(ids.length, "duplicate tab")}?`,
    ...closingWindows(state.allTabs, ids).map(
      (windowId) => `${windowLabel(windowId)} will close — every tab in it is a duplicate.`,
    ),
    "Chrome's Ctrl+Shift+T reopens closed tabs.",
  ].join("\n");
  await closeTabs(ids, message);
}

// the quick action: every duplicated page, one survivor each (New Tab: one per window)
export function allDuplicateSets(): DupSet[] {
  return duplicatesActive() ? duplicateSets(state.allTabs) : [];
}

export function cleanupAllDuplicates(): Promise<void> {
  return cleanupDuplicates(allDuplicateSets(), "one");
}
