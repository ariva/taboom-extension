// Context menus of the tab list: row menu, tab-group menu, window header menu, and the
// item builders they share with the windows popover's menus.
import type { UiPrefs } from "../../../app/types.ts";
import { askDialog } from "../../../lib/ui/ask-dialog.ts";
import {
  clearCtxMenu,
  ctxAppend,
  ctxDivider,
  ctxItem,
  ctxSubmenu,
  ctxTitle,
  showCtxMenu,
} from "../../../lib/ui/context-menu.ts";
import { actionIds, closeTabs, copyUrls, pinTabs, protectTabs, snooze, unprotectTabs, wake } from "../ops/actions.ts";
import { TAB_GROUP_COLORS, WINDOW_DOT_COLORS, windowGroupName, windowMaps } from "../model/index.ts";
import { render } from "../foundation/scheduler.ts";
import { namesActive, pinActive, state, tabGroupsActive } from "../foundation/state.ts";
import type { PanelTab } from "../foundation/state.ts";
import { moveTabsToGroup, startRenameTabGroup, ungroupTabs, updateTabGroup } from "../ops/tab-group-ops.ts";
import { persistUiPrefs } from "../input/toolbar-events.ts";
import {
  moveTabsToWindow,
  orderedWindowIds,
  setWindowColor,
  setWindowPin,
  startRenameWindow,
  windowLabel,
} from "../ops/window-ops.ts";

type TabGroup = chrome.tabGroups.TabGroup;

// the five bulk-bar actions as menu items over an explicit id set
// alwaysCount: window menus say "Close 1 tab" even for a lone tab — bare
// "Close" on a window header reads as "close the window"; the row menu keeps
// bare labels (the clicked tab is unambiguous there)
function appendCtxActions(ids: number[], alwaysCount = false): void {
  // filter(Boolean) drops the misses — TS cannot see that through the Boolean constructor
  const targets = ids.map((id) => state.allTabs.find((tab) => tab.id === id)).filter(Boolean) as PanelTab[];
  const actions: [label: string, run: () => void][] = [
    ["Snooze", () => snooze(ids)],
    ["Wake", () => wake(ids)],
    ["Protect", () => protectTabs(ids)],
    ["Unprotect", () => unprotectTabs(ids)],
    // Pin/Unpin only when they would do something for at least one target tab
    ...(targets.some((tab) => !tab.pinned) ? [["Pin", () => pinTabs(ids, true)] satisfies [string, () => void]] : []),
    ...(targets.some((tab) => tab.pinned) ? [["Unpin", () => pinTabs(ids, false)] satisfies [string, () => void]] : []),
    ["Close", () => closeTabs(ids)],
  ];
  const suffix = ` ${ids.length} tab${ids.length === 1 ? "" : "s"}`;
  for (const [label, run] of actions) {
    ctxAppend(ctxItem(ids.length > 1 || alwaysCount ? label + suffix : label, run));
  }
}

export function openRowMenu(event: MouseEvent, tabId: number): void {
  const ids = actionIds(tabId);
  const sourceWindows = new Set(ids.map((id) => state.allTabs.find((tab) => tab.id === id)?.windowId));
  const maps = windowMaps(state.allTabs, state.currentWindowId, state.windowMeta);
  clearCtxMenu();
  const clicked = state.allTabs.find((tab) => tab.id === tabId);
  ctxAppend(ctxTitle(ids.length > 1 ? `${ids.length} tabs selected` : clicked?.title || "Tab"), ctxDivider());
  ctxAppend(ctxItem(ids.length > 1 ? `Copy ${ids.length} URLs` : "Copy URL", () => copyUrls(ids)));
  appendCtxActions(ids);
  ctxAppend(ctxDivider());
  const { btn, submenu } = ctxSubmenu(ids.length > 1 ? `Move ${ids.length} tabs to` : "Move tab to");
  ctxAppend(btn, submenu);
  for (const windowId of orderedWindowIds(maps)) {
    // single tab: its own window is a pointless target; a mixed selection
    // keeps every window (part of it may live elsewhere)
    if (ids.length === 1 && sourceWindows.has(windowId)) {
      continue;
    }
    const name = windowGroupName(windowId, {
      currentWindowId: state.currentWindowId,
      indexes: maps.indexes,
      names: maps.names,
    });
    submenu.append(ctxItem(name, () => moveTabsToWindow(ids, windowId)));
  }
  submenu.append(ctxItem("New window", () => moveTabsToWindow(ids, null)));
  if (tabGroupsActive()) {
    const groupMenu = ctxSubmenu(ids.length > 1 ? `Move ${ids.length} tabs to group` : "Move to group");
    ctxAppend(groupMenu.btn, groupMenu.submenu);
    for (const [groupId, group] of state.tabGroups) {
      const item = ctxItem(group.title || "(unnamed group)", () => moveTabsToGroup(ids, groupId));
      const dot = document.createElement("span");
      dot.className = "win-dot";
      dot.style.background = TAB_GROUP_COLORS[group.color] ?? "#5f6368";
      item.prepend(dot);
      groupMenu.submenu.append(item);
    }
    groupMenu.submenu.append(
      ctxItem("New group…", async () => {
        // name first — Cancel moves nothing, an empty name makes an unnamed group
        const title = await askDialog({ message: "New group name", input: { placeholder: "Group name" } });
        if (typeof title !== "string") {
          return;
        }
        moveTabsToGroup(ids, null, title.trim());
      }),
    );
    const grouped = ids.filter((id) => (state.allTabs.find((tab) => tab.id === id)?.groupId ?? -1) !== -1);
    if (grouped.length > 0) {
      ctxAppend(ctxItem("Remove from group", () => ungroupTabs(grouped)));
    }
  }
  showCtxMenu(event);
}

const WINDOW_TAB_ORDERS: [UiPrefs["groupByWindowTabsOrder"], string][] = [
  ["recent", "Recently used"],
  ["same-as-window", "Same as window"],
  ["title-asc", "Title sorted A-Z"],
  ["title-desc", "Title sorted Z-A"],
];

// human labels for WINDOW_DOT_COLORS, same order
const WINDOW_DOT_COLOR_NAMES = ["Red", "Teal", "Yellow", "Green", "Purple", "Pink", "Gray", "Gold"];

// E: tab-group menu — identity actions on top, Chrome-strip controls, then
// the usual bulk actions over the group's visible tabs
export function openTabGroupMenu(
  event: MouseEvent,
  groupId: number,
  startRename: (groupId: number) => void = startRenameTabGroup,
): void {
  const group = state.tabGroups.get(groupId);
  if (!group) {
    return;
  }
  const ids = state.fullVisible.filter((tab) => tab.groupId === groupId).map((tab) => tab.id);
  clearCtxMenu();
  ctxAppend(ctxTitle(group.title || "(unnamed group)"), ctxDivider());
  ctxAppend(ctxItem("Rename group…", () => startRename(groupId)));
  const color = ctxSubmenu("Group color");
  ctxAppend(color.btn, color.submenu);
  for (const [colorName, hex] of Object.entries(TAB_GROUP_COLORS)) {
    // colorName[0]!: color names are non-empty; `as`: TAB_GROUP_COLORS is keyed by Chrome's color names
    const item = ctxItem(colorName[0]!.toUpperCase() + colorName.slice(1), () =>
      updateTabGroup(groupId, { color: colorName as TabGroup["color"] }),
    );
    const dot = document.createElement("span");
    dot.className = "win-dot";
    dot.style.background = hex;
    item.prepend(dot);
    if (colorName === group.color) {
      item.classList.add("current");
    }
    color.submenu.append(item);
  }
  ctxAppend(
    ctxItem(group.collapsed ? "Expand in tab strip" : "Collapse in tab strip", () =>
      updateTabGroup(groupId, { collapsed: !group.collapsed }),
    ),
    ctxItem(`Ungroup ${ids.length} tab${ids.length === 1 ? "" : "s"}`, () => ungroupTabs(ids)),
  );
  if (ids.length > 0) {
    ctxAppend(ctxDivider());
    appendCtxActions(ids, true);
  }
  showCtxMenu(event);
}

// Rename + Window color entries (shared by the header menu and the
// windows-list menu)
export function appendWindowIdentityItems(
  windowId: number,
  startRename: (windowId: number) => void = startRenameWindow,
): void {
  // "Pin window" — pinned windows sort to the top of the windows list
  if (pinActive()) {
    const isPinned = state.windowMeta.get(windowId)?.pinnedWindow ?? false;
    ctxAppend(ctxItem(isPinned ? "Unpin window" : "Pin window", () => setWindowPin(windowId, !isPinned)));
  }
  ctxAppend(ctxItem("Rename window…", () => startRename(windowId)));
  const color = ctxSubmenu("Window color");
  ctxAppend(color.btn, color.submenu);
  const currentColor = state.windowMeta.get(windowId)?.color;
  WINDOW_DOT_COLORS.forEach((swatch, index) => {
    const item = ctxItem(WINDOW_DOT_COLOR_NAMES[index] ?? swatch, () => setWindowColor(windowId, swatch));
    const dot = document.createElement("span");
    dot.className = "win-dot";
    dot.style.background = swatch;
    item.prepend(dot);
    if (swatch === currentColor) {
      item.classList.add("current");
    }
    color.submenu.append(item);
  });
  const auto = ctxItem("Auto", () => setWindowColor(windowId, null));
  if (!currentColor) {
    auto.classList.add("current");
  }
  color.submenu.append(auto);
}

// window group header: same actions over the window's selected tabs — or every
// visible tab when nothing in it is selected — plus a "Change order" dropdown
// driving ui.groupByWindowTabsOrder (current one marked)
export function openWindowHeaderMenu(event: MouseEvent, windowId: number): void {
  const windowTabs = state.fullVisible.filter((tab) => tab.windowId === windowId);
  const selectedHere = windowTabs.filter((tab) => state.selected.has(tab.id));
  const ids = (selectedHere.length > 0 ? selectedHere : windowTabs).map((tab) => tab.id);
  if (ids.length === 0) {
    return;
  }
  clearCtxMenu();

  // header: window display name (custom name or "Window #N")
  ctxAppend(ctxTitle(windowLabel(windowId)), ctxDivider());

  // window-identity section (WINDOW_NAMES feature only)
  if (namesActive()) {
    // "Focus window" — bring that window to front (pointless on the current one)
    if (windowId !== state.currentWindowId) {
      ctxAppend(ctxItem("Focus window", () => chrome.windows.update(windowId, { focused: true })));
    }
    // "Rename window…" + "Window color ▸" (palette swatches + Auto)
    appendWindowIdentityItems(windowId);
    ctxAppend(ctxDivider());
  }

  // "Snooze / Wake / Protect / Unprotect / Close" — the five bulk-bar actions
  // over the window's selection (or all its visible tabs)
  appendCtxActions(ids, true);
  ctxAppend(ctxDivider());

  // "Tabs Order ▸" — within-window order for the window grouping
  // (Recently used / Same as window / Title A-Z / Title Z-A, current marked)
  const { btn, submenu } = ctxSubmenu("Tabs Order");
  ctxAppend(btn, submenu);
  const current = state.ui.groupByWindowTabsOrder ?? "same-as-window";
  for (const [value, label] of WINDOW_TAB_ORDERS) {
    const item = ctxItem(label, () => {
      state.ui = { ...state.ui, groupByWindowTabsOrder: value };
      persistUiPrefs(); // options page follows through the storage listener
      render(false);
    });
    if (value === current) {
      item.classList.add("current");
    }
    submenu.append(item);
  }

  showCtxMenu(event);
}
