// Chrome split view (155+): put two tabs side by side, or separate them again. The
// decisions (moves, refusals) are app/split.ts; this runs them against chrome.tabs.
import { adjacentMove, isSplit, type SplitTab, splitPlan } from "../../../app/split.ts";
import { toast } from "../../../lib/ui/toast.ts";
import { refresh } from "../foundation/scheduler.ts";
import { type PanelTab, state } from "../foundation/state.ts";

interface SplitApi {
  createSplit?: (tabIds: [number, number]) => Promise<number>;
  unsplit?: (splitViewId: number) => Promise<void>;
}

// @types/chrome 0.2.6 predates the Split View API, and older Chromes lack it — read it untyped
function splitApi(): SplitApi {
  return chrome.tabs as unknown as SplitApi;
}

export function splitSupported(): boolean {
  return typeof splitApi().createSplit === "function";
}

export function asSplitTab(tab: PanelTab): SplitTab {
  return {
    id: tab.id,
    windowId: tab.windowId,
    index: tab.index ?? 0,
    pinned: tab.pinned ?? false,
    groupId: tab.groupId ?? -1,
    ...(tab.splitViewId === undefined ? {} : { splitViewId: tab.splitViewId }),
  };
}

// the anchor (clicked tab) stays put; the partner is brought beside it, matched to its pin
// state and group, then the two are split. Chrome's own refusals surface as a toast.
export async function splitTabs(anchorId: number, partnerId: number): Promise<void> {
  const anchor = state.allTabs.find((tab) => tab.id === anchorId);
  const partner = state.allTabs.find((tab) => tab.id === partnerId);
  if (!anchor || !partner) {
    return;
  }
  const plan = splitPlan(asSplitTab(anchor), asSplitTab(partner));
  if ("refusal" in plan) {
    toast(plan.refusal);
    return;
  }
  try {
    if (plan.move) {
      await chrome.tabs.move(partnerId, plan.move);
    }
    if (plan.pin !== undefined) {
      await chrome.tabs.update(partnerId, { pinned: plan.pin });
      // pinning moves a tab into the pinned run (unpinning out of it): seat it beside the anchor again
      const [anchorNow, partnerNow] = await Promise.all([chrome.tabs.get(anchorId), chrome.tabs.get(partnerId)]);
      const again = adjacentMove(
        { windowId: anchorNow.windowId, index: anchorNow.index },
        { windowId: partnerNow.windowId, index: partnerNow.index },
      );
      if (again) {
        await chrome.tabs.move(partnerId, again);
      }
    }
    if (plan.group === null) {
      await chrome.tabs.ungroup(partnerId);
    } else if (plan.group !== undefined) {
      await chrome.tabs.group({ tabIds: partnerId, groupId: plan.group });
    }
    await splitApi().createSplit?.(plan.tabIds);
  } catch (error) {
    console.debug("split failed", error);
    toast("Chrome refused the split view");
  }
  state.selected.delete(anchorId);
  state.selected.delete(partnerId);
  refresh(true);
}

export async function unsplitTab(tabId: number): Promise<void> {
  const tab = state.allTabs.find((candidate) => candidate.id === tabId);
  if (!tab || !isSplit(tab) || tab.splitViewId === undefined) {
    return;
  }
  await splitApi()
    .unsplit?.(tab.splitViewId)
    .catch(() => {});
  refresh(true);
}
