// Split view items of the row menu (SPLIT_VIEW flag, Chrome 155+): two ticked rows pair
// up, a single row pairs with the row above or below it in the list, a split member can
// unsplit — and the Split sub-header's own menu: Unsplit plus the tab actions over the pair.
import { isSplit, splitPlan } from "../../../app/split.ts";
import { clearCtxMenu, ctxAppend, ctxDivider, ctxItem, ctxTitle, showCtxMenu } from "../../../lib/ui/context-menu.ts";
import { type PanelTab, splitActive, state } from "../foundation/state.ts";
import { asSplitTab, splitSupported, splitTabs, unsplitTab } from "../ops/split-ops.ts";

export function appendSplitItems(ids: number[], clicked: PanelTab | undefined): void {
  if (!clicked || !splitActive() || !splitSupported()) {
    return; // Chrome < 155 has no Split View API: nothing to offer
  }
  if (isSplit(clicked)) {
    ctxAppend(
      ctxDivider(),
      ctxItem("Unsplit", () => unsplitTab(clicked.id)),
    );
    return;
  }
  const partnerId = ids.find((id) => id !== clicked.id);
  if (ids.length === 2 && partnerId !== undefined) {
    ctxAppend(
      ctxDivider(),
      ctxItem("Split view (2 tabs)", () => splitTabs(clicked.id, partnerId)),
    );
    return;
  }
  if (ids.length !== 1) {
    return; // three or more: Chrome splits exactly two
  }
  // partners: the rows right above and below in the list as shown, each offered only
  // when the plan can get it beside the clicked tab (a pin mismatch is not offered)
  const at = state.visible.findIndex((tab) => tab.id === clicked.id);
  const neighbours: [string, PanelTab | undefined][] = [
    ["Split with previous tab", state.visible[at - 1]],
    ["Split with next tab", state.visible[at + 1]],
  ];
  const items = neighbours.flatMap(([label, tab]) =>
    tab && !("refusal" in splitPlan(asSplitTab(clicked), asSplitTab(tab))) ? [{ label, tab }] : [],
  );
  if (items.length === 0) {
    return;
  }
  ctxAppend(ctxDivider());
  for (const { label, tab } of items) {
    const item = ctxItem(label, () => splitTabs(clicked.id, tab.id));
    item.title = tab.title || tab.url || "(tab)";
    ctxAppend(item);
  }
}

// the Split sub-header's right-click menu. appendActions is menus.ts's shared tab-action
// list, handed in by the dispatcher (menus.ts imports this file, so no import back)
export function openSplitMenu(
  event: MouseEvent,
  splitViewId: number,
  appendActions: (ids: number[], alwaysCount: boolean) => void,
): void {
  const members = state.allTabs.filter((tab) => tab.splitViewId === splitViewId);
  const [first] = members;
  if (!first) {
    return;
  }
  clearCtxMenu();
  ctxAppend(ctxTitle("Split view"), ctxDivider());
  ctxAppend(
    ctxItem("Unsplit", () => unsplitTab(first.id)),
    ctxDivider(),
  );
  appendActions(
    members.map((tab) => tab.id),
    true,
  );
  showCtxMenu(event);
}
