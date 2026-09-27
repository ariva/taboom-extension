// Group headers of the list: the header of any grouping, and the nested tab-group
// sub-headers inside a window's rows.
import { featureEnabled } from "../../../app/core.ts";
import { tabGroupColor } from "../model/index.ts";
import type { RowViewModel } from "../model/index.ts";
import { renderRow } from "./row.ts";
import { render } from "../foundation/scheduler.ts";
import { activeCollapsedSet, namesActive, pinActive, state } from "../foundation/state.ts";
import type { GroupKey, PanelTab } from "../foundation/state.ts";

type Tab = chrome.tabs.Tab;

// opens the window menu for a header's ⋯ button
export type WindowMenuOpener = (event: MouseEvent, windowId: number) => void;

// B: contiguous runs of one tab group inside a window's rows get a sub-header
// (rail color, title, count, collapse) — the list mirrors Chrome's strip
export function renderMembersWithTabGroupRuns(
  frag: DocumentFragment,
  members: PanelTab[],
  rowVm: (tab: Tab, index: number) => RowViewModel,
  index: number,
  collapsed: Set<GroupKey>,
  windowDotColor: string | null,
): number {
  let runGroupId: number | null = null;
  let runCollapsed = false;
  for (const tab of members) {
    const gid = tab.groupId ?? -1;
    if (gid !== runGroupId) {
      runGroupId = gid;
      runCollapsed = false;
      if (gid !== -1) {
        const runTabs = members.filter((t) => (t.groupId ?? -1) === gid);
        runCollapsed = collapsed.has(`tg:${gid}`);
        frag.append(renderTabGroupSubheader(gid, runTabs, runCollapsed, windowDotColor));
      }
    }
    if (gid !== -1 && runCollapsed) {
      continue; // rows of a folded run (also excluded from state.visible)
    }
    frag.append(renderRow(tab, rowVm(tab, index++)));
  }
  return index;
}

function renderTabGroupSubheader(
  groupId: number,
  tabs: PanelTab[],
  isCollapsed: boolean,
  windowDotColor: string | null | undefined,
): HTMLElement {
  const group = state.tabGroups.get(groupId);
  const header = document.createElement("div");
  header.className = "tabgroup-header";
  header.dataset.tabGroupId = String(groupId); // right-click → tab-group menu
  header.setAttribute("role", "button");
  header.tabIndex = 0;
  // same select-the-group checkbox as window headers (same flag)
  const selectedCount = tabs.filter((tab) => state.selected.has(tab.id)).length;
  if (featureEnabled(state.features, "WINDOW_GROUP_SELECT")) {
    const box = document.createElement("input");
    box.type = "checkbox";
    box.className = "group-select";
    box.checked = tabs.length > 0 && selectedCount === tabs.length;
    box.indeterminate = selectedCount > 0 && selectedCount < tabs.length;
    box.title = box.ariaLabel = `${box.checked ? "Unselect" : "Select"} group tabs`;
    box.addEventListener("click", (event) => {
      event.stopPropagation(); // header click collapses the run
      for (const tab of tabs) {
        box.checked ? state.selected.add(tab.id) : state.selected.delete(tab.id);
      }
      render(false);
    });
    header.append(box);
  }
  // hover: same info shape as window headers, prefixed so it reads as a group
  const total = state.allTabs.filter((tab) => tab.groupId === groupId).length;
  header.dataset.tip =
    `Group "${group?.title || "(unnamed group)"}"\n` +
    `${selectedCount}/${tabs.length} selected tabs\n` +
    `${tabs.length}/${total} visible tabs\n` +
    `Click to ${isCollapsed ? "expand" : "collapse"}`;
  // window membership stays visible on the group line: dot before the square
  let windowDot: HTMLSpanElement | null = null;
  if (windowDotColor !== null && windowDotColor !== undefined) {
    windowDot = document.createElement("span");
    windowDot.className = "win-dot";
    if (windowDotColor) {
      windowDot.style.background = windowDotColor;
    } else {
      windowDot.classList.add("current");
    }
  }
  const rail = document.createElement("span");
  rail.className = "tg-square";
  // a vanished group has no color → the grey fallback
  rail.style.background = tabGroupColor(group?.color) ?? "#5f6368";
  const title = document.createElement("span");
  title.className = "tg-title";
  title.textContent = group?.title || "(unnamed group)";
  const count = document.createElement("span");
  count.className = "tg-count";
  count.textContent = `${tabs.length}/${total}`; // visible/total, like window headers
  const arrow = document.createElement("span");
  arrow.className = "fold-arrow";
  arrow.textContent = isCollapsed ? "▸" : "▾";
  header.append(...(windowDot ? [windowDot] : []), rail, title, count, arrow);
  const toggle = () => {
    const set = activeCollapsedSet();
    const key = `tg:${groupId}`;
    set.has(key) ? set.delete(key) : set.add(key);
    render();
  };
  header.addEventListener("click", toggle);
  header.addEventListener("keydown", (event) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      toggle();
    }
  });
  return header;
}

interface GroupHeaderOptions {
  isCollapsed: boolean;
  collapsible: boolean;
  name: string;
  dotColor: string | null; // null = no dot; "" = current window accent
  tabs: PanelTab[];
  noun: string;
  count: number;
  total: number;
  tabGroupId?: number | null;
  onMenu: WindowMenuOpener;
}

// clickable group header (any grouping): toggles collapse of the group's rows
export function renderGroupHeader(
  groupKey: GroupKey,
  { isCollapsed, collapsible, name, dotColor, tabs, noun, count, total, tabGroupId = null, onMenu }: GroupHeaderOptions,
): HTMLElement {
  const header = document.createElement("div");
  header.className = "group-header";
  if (noun === "window") {
    header.dataset.windowId = String(groupKey); // drop target for tab moves
  }
  if (tabGroupId != null) {
    header.dataset.tabGroupId = String(tabGroupId); // right-click → tab-group menu
  }
  // WINDOW_GROUP_SELECT: checkbox left of the label selects/unselects every
  // tab of this group that the current filter/search shows
  const selectedCount = tabs.filter((tab) => state.selected.has(tab.id)).length;
  if (featureEnabled(state.features, "WINDOW_GROUP_SELECT")) {
    const box = document.createElement("input");
    box.type = "checkbox";
    box.className = "group-select";
    box.checked = tabs.length > 0 && selectedCount === tabs.length;
    box.indeterminate = selectedCount > 0 && selectedCount < tabs.length;
    box.title = box.ariaLabel = `${box.checked ? "Unselect" : "Select"} ${noun} tabs`;
    box.addEventListener("click", (event) => {
      event.stopPropagation(); // header click collapses the group
      if (box.checked) {
        for (const tab of tabs) {
          state.selected.add(tab.id);
        }
      } else {
        for (const tab of tabs) {
          state.selected.delete(tab.id);
        }
      }
      render(false); // row checkboxes + bulk bar follow
    });
    header.append(box);
  }
  // window grouping: same per-window color dot the rows carry
  // (dotColor null = no dot; "" = current window accent)
  if (dotColor !== null) {
    const dot = document.createElement("span");
    // tab-group headers get the SQUARE marker (groups are squares everywhere,
    // windows are circles)
    dot.className = tabGroupId != null && tabGroupId !== -1 ? "tg-square" : "win-dot";
    if (dotColor) {
      dot.style.background = dotColor;
    } else {
      dot.classList.add("current");
    }
    header.append(dot);
  }
  const label = document.createElement("span");
  label.className = "group-label";
  label.textContent = name;
  let pin: HTMLSpanElement | null = null;
  if (noun === "window" && pinActive() && state.windowMeta.get(Number(groupKey))?.pinnedWindow) {
    pin = document.createElement("span");
    pin.className = "win-pin";
    pin.textContent = "📌";
    pin.title = "Pinned window";
  }
  // counts in their own non-shrinking span: a long name ellipsizes without
  // ever swallowing the visible/total numbers
  const counts = document.createElement("span");
  counts.className = "group-count";
  counts.textContent = `${count}/${total}`;
  header.append(label, ...(pin ? [pin] : []), counts);
  // hover: generic group info (name + how many tabs) plus the click action.
  // Custom tip (not title=): native tooltips render under the cursor and the
  // pointer hides the first line — ours sits to the right of the pointer.
  const info =
    `${tabGroupId != null && tabGroupId !== -1 ? `Group "${name}"` : name}\n` +
    `${selectedCount}/${count} selected tabs\n` +
    `${count}/${total} visible tabs`;
  if (!collapsible) {
    header.classList.add("static");
    header.dataset.tip = info;
    return header;
  }
  // ⋯ opens the same menu as header right-click — a visible, keyboard-reachable
  // trigger (hover/focus-only via CSS)
  if (noun === "window" && namesActive()) {
    const menuBtn = document.createElement("button");
    menuBtn.className = "group-menu-btn";
    menuBtn.title = menuBtn.ariaLabel = "Window actions";
    menuBtn.textContent = "⋯";
    menuBtn.addEventListener("click", (event) => {
      event.stopPropagation(); // header click = collapse
      onMenu(event, Number(groupKey));
    });
    header.append(menuBtn);
  }
  // collapse chevron right-aligned (accordion layout) — far from the
  // group-select checkbox on the left so the two targets can't be confused
  const arrow = document.createElement("span");
  arrow.className = "fold-arrow";
  arrow.textContent = isCollapsed ? "▸" : "▾";
  header.append(arrow);
  header.setAttribute("role", "button");
  header.tabIndex = 0;
  header.dataset.tip = `${info}\nClick to ${isCollapsed ? "expand" : "collapse"}`;
  const toggle = () => {
    // searches start expanded but fold freely into their own set; the
    // pre-search collapse state is untouched and resumes after
    const set = activeCollapsedSet();
    set.has(groupKey) ? set.delete(groupKey) : set.add(groupKey);
    render();
  };
  header.addEventListener("click", toggle);
  header.addEventListener("keydown", (event) => {
    if (event.target !== header) {
      return; // space on the focused group-select checkbox must not collapse
    }
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      event.stopPropagation();
      toggle();
    }
  });
  return header;
}
