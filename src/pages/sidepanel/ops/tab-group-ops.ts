// Chrome tab-group operations: rename (keeping the quick-launch slot), update, move tabs
// into a group / a new group, ungroup.
import { inlineEdit } from "../../../lib/ui/inline-edit.ts";
import { toast } from "../../../lib/ui/toast.ts";
import { listEl } from "../foundation/elements.ts";
import { refresh } from "../foundation/scheduler.ts";
import { state } from "../foundation/state.ts";
import { persistUiPrefs } from "../input/toolbar-events.ts";

// what chrome.tabs.group/ungroup are typed to take
export type TabIdList = [number, ...number[]];

// rename commit shared by both rename entry points — the group keeps its
// dragged slot in the quick-launch order, which is keyed by title
export function commitTabGroupTitle(groupId: number, title: string): Promise<unknown> {
  const old = state.tabGroups.get(groupId)?.title ?? "";
  const order = state.ui.quickLaunchGroupOrder ?? [];
  if (old !== title && order.includes(old)) {
    state.ui = { ...state.ui, quickLaunchGroupOrder: order.map((slot) => (slot === old ? title : slot)) };
    persistUiPrefs();
  }
  return chrome.tabGroups.update(groupId, { title }).catch(() => {});
}

// tab-group rename: the label lives on a C header (.group-label) or a B
// sub-header (.tg-title), whichever is on screen
export function startRenameTabGroup(groupId: number): void {
  const label = listEl.querySelector(
    `.group-header[data-tab-group-id="${groupId}"] .group-label, .tabgroup-header[data-tab-group-id="${groupId}"] .tg-title`,
  );
  if (!label) {
    return;
  }
  inlineEdit(label, {
    initial: state.tabGroups.get(groupId)?.title ?? "",
    placeholder: "Group name",
    commit: (title) => commitTabGroupTitle(groupId, title),
    finish: () => refresh(false),
  });
}

export async function updateTabGroup(groupId: number, patch: chrome.tabGroups.UpdateProperties): Promise<void> {
  await chrome.tabGroups.update(groupId, patch).catch(() => {});
  refresh(true);
}

// groupId null = new group, titled `title` (empty = Chrome's unnamed group)
// (`as TabIdList` here and in ungroupTabs: chrome's typings want a non-empty
// tuple; an empty list simply rejects and is caught)
export async function moveTabsToGroup(tabIds: number[], groupId: number | null, title = ""): Promise<void> {
  try {
    if (groupId != null) {
      // Chrome refuses to group across windows — move foreign tabs over first
      const group = state.tabGroups.get(groupId);
      const foreign = tabIds.filter((id) => state.allTabs.find((tab) => tab.id === id)?.windowId !== group?.windowId);
      if (group && foreign.length > 0) {
        await chrome.tabs.move(foreign, { windowId: group.windowId, index: -1 });
      }
      await chrome.tabs.group({ tabIds: tabIds as TabIdList, groupId });
    } else {
      const newGroupId = await chrome.tabs.group({ tabIds: tabIds as TabIdList });
      if (title) {
        await chrome.tabGroups.update(newGroupId, { title });
      }
    }
  } catch (error) {
    toast(String((error as Partial<Error> | null)?.message ?? error));
  }
  refresh(true);
}

export async function ungroupTabs(tabIds: number[]): Promise<void> {
  await chrome.tabs.ungroup(tabIds as TabIdList).catch(() => {});
  refresh(true);
}
