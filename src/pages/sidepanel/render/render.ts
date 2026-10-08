// The list renderer: render() derives what is visible and picks animated or plain,
// renderNow() rebuilds the list DOM; plus the chrome that follows every render
// (row-height feedback, fold-all button, bulk bar).
import { FOLD_ICONS } from "../../../lib/dom.ts";
import { hideCtxMenu } from "../../../lib/ui/context-menu.ts";
import { bulkBar, bulkCount, collapseAllBtn, filterBar, listEl, selectAllBox } from "../foundation/elements.ts";
import { openWindowHeaderMenu } from "../menus/menus.ts";
import {
  bulkSummary,
  countsByFilter,
  emptyMessage,
  fuzzyActive,
  groupTabs,
  rowViewModel,
  searchCandidates,
  selectVisible,
  tabGroupColor,
  windowMaps,
} from "../model/index.ts";
import type { FilterName, RowViewModel } from "../model/index.ts";
import { perfMeasure } from "../foundation/perf.ts";
import { renderGroupHeader, renderMembersWithTabGroupRuns } from "./headers.ts";
import { renderRow } from "./row.ts";
import { effectiveCollapsed, GROUPINGS, renderSortDirButton } from "./sorting.ts";
import type { PanelRun } from "./sorting.ts";
import { activeCollapsedSet, effectiveSort, nestedTabGroupsActive, state } from "../foundation/state.ts";
import type { GroupKey } from "../foundation/state.ts";
import { refillWindowsPopoverIfOpen } from "../windows-popover/popover.ts";

type Tab = chrome.tabs.Tab;

const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)");

// animate=false for high-frequency renders (typing, cursor moves) where a
// view transition would add latency and caret flicker.
// VT snapshot cost scales with per-row view-transition-names, so big lists
// (1000-tab users) skip animation entirely — snappy beats pretty there.
const VT_MAX_ROWS = 100;

export function render(animate = true): void {
  // selectVisible only filters/sorts the PanelTabs it was given
  state.fullVisible = selectVisible(state.allTabs, { ...state, sort: effectiveSort(), now: Date.now() });
  const collapsed = effectiveCollapsed();
  const grouping = GROUPINGS[effectiveSort()];
  state.visible = grouping ? state.fullVisible.filter((tab) => !collapsed.has(grouping.key(tab))) : state.fullVisible;
  if (effectiveSort() === "window" && nestedTabGroupsActive()) {
    state.visible = state.visible.filter(
      (tab) => (tab.groupId ?? -1) === -1 || !effectiveCollapsed().has(`tg:${tab.groupId}`),
    );
  }
  const heavy = Math.max(state.visible.length, listEl.childElementCount) > VT_MAX_ROWS;
  if (animate && !heavy && document.startViewTransition && !reducedMotion.matches) {
    document.startViewTransition(renderNow);
  } else {
    renderNow();
  }
}

export function renderNow(): void {
  perfMeasure("sidepanel.render", renderNowImpl);
}

function renderNowImpl(): void {
  // any re-render (selection change, tab/window events, background refresh)
  // invalidates the open context menu's ids — close it rather than act stale
  hideCtxMenu();
  // active search: chips count found items (what clicking each filter would show)
  const counted = state.query ? searchCandidates(state.allTabs, state) : state.allTabs;
  const byFilter = countsByFilter(counted, state.derived);
  for (const button of filterBar.querySelectorAll("button")) {
    const name = button.dataset.filter;
    // static markup: every filter button has its .count span and a FilterName in data-filter
    button.querySelector(".count")!.textContent = String(byFilter[name as FilterName]);
    button.setAttribute("aria-pressed", String(name === state.filter));
  }

  listEl.classList.toggle("compact", state.ui.density === "compact");
  state.cursor = Math.min(state.cursor, state.visible.length - 1);
  // build everything into a fragment: one live-DOM mutation instead of N appends
  const frag = document.createDocumentFragment();
  if (state.fullVisible.length === 0) {
    const empty = document.createElement("div");
    empty.className = "empty";
    empty.textContent = emptyMessage(state.query, state.filter);
    frag.append(empty);
  }

  const maps = windowMaps(state.allTabs, state.currentWindowId, state.windowMeta);
  const now = Date.now();
  // tokenized once per render — rows highlight their matches while searching
  const queryTokens = state.query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
  const rowVm = (tab: Tab, index: number): RowViewModel =>
    rowViewModel(tab, {
      index,
      cursor: state.cursor,
      now,
      currentWindowId: state.currentWindowId,
      derived: state.derived,
      selected: state.selected,
      dotColors: maps.dotColors,
      indexes: maps.indexes,
      queryTokens,
      fuzzy: fuzzyActive(state),
    });

  let foldableGroups: PanelRun[] = [];
  let anythingToFold = false;
  const sort = effectiveSort();
  const grouping = GROUPINGS[sort];
  if (grouping) {
    const collapsed = effectiveCollapsed();
    const groups: PanelRun[] = groupTabs(state.fullVisible, grouping.key);
    const collapsible = groups.length > 1; // lone group: nothing to fold away
    anythingToFold = collapsible;
    if (collapsible) {
      foldableGroups = groups;
    }
    // per-group totals in one pass (visible count = the group's own length)
    const totals = new Map<GroupKey, number>();
    for (const tab of state.allTabs) {
      const key = grouping.key(tab);
      totals.set(key, (totals.get(key) ?? 0) + 1);
    }
    let index = 0;
    for (const [groupKey, members] of groups) {
      const isCollapsed = collapsible && collapsed.has(groupKey);
      frag.append(
        renderGroupHeader(groupKey, {
          isCollapsed,
          collapsible,
          name: grouping.name(groupKey, maps),
          // window grouping: per-window dot; tab-group grouping: Chrome group color
          // (`groupKey as number`: the window / group-tabgroup groupings key by numeric id)
          dotColor:
            sort === "window" && maps.dotColors.size > 0
              ? (maps.dotColors.get(groupKey as number) ?? null)
              : sort === "group-tabgroup" && groupKey !== -1
                ? (tabGroupColor(state.tabGroups.get(groupKey as number)?.color) ?? null)
                : null,
          tabGroupId: sort === "group-tabgroup" ? (groupKey as number) : null, // -1 = "No group" (drop = ungroup)
          tabs: members,
          noun: grouping.noun,
          count: members.length,
          total: totals.get(groupKey) ?? 0,
          onMenu: openWindowHeaderMenu,
        }),
      );
      if (isCollapsed) {
        continue;
      }
      if (sort === "window" && nestedTabGroupsActive()) {
        index = renderMembersWithTabGroupRuns(
          frag,
          members,
          rowVm,
          index,
          collapsed,
          maps.dotColors.size > 0 ? (maps.dotColors.get(groupKey as number) ?? null) : null, // window id
        );
        continue;
      }
      for (const tab of members) {
        frag.append(renderRow(tab, rowVm(tab, index++)));
      }
    }
  } else {
    state.visible.forEach((tab, index) => {
      frag.append(renderRow(tab, rowVm(tab, index)));
    });
  }
  listEl.replaceChildren(frag);
  syncRowHeight();
  renderCollapseAllButton(foldableGroups, anythingToFold);
  renderSortDirButton(grouping, anythingToFold);

  if (state.pendingScroll != null) {
    listEl.scrollTop = state.pendingScroll;
    state.pendingScroll = null;
  }

  if (state.followCurrent) {
    state.followCurrent = false;
    // top first (group headers/padding show), then the minimal scroll that
    // reveals the current row — near the top both hold, far down the row wins
    listEl.scrollTop = 0;
    const current = listEl.querySelector(".row.current");
    current?.scrollIntoView({ block: "nearest" });
  }
  if (state.revealCurrent) {
    state.revealCurrent = false;
    listEl.querySelector(".row.current")?.scrollIntoView({ block: "nearest" });
  }
  renderBulkBar();
  refillWindowsPopoverIfOpen();
}

// Feed the real row height back into the content-visibility placeholder
// (--row-h). Offscreen rows use the placeholder for layout, so any gap between
// it and the true height (fonts per OS, fontSize/density settings) makes a
// restored scrollTop land rows off the saved position. Runs BEFORE the
// pendingScroll restore so the restore maps through corrected heights.
let lastRowHeight = 0;
function syncRowHeight(): void {
  const row = listEl.querySelector<HTMLElement>(".row");
  if (!row) {
    return;
  }
  row.style.contentVisibility = "visible"; // may be offscreen: force real layout to measure
  const cs = window.getComputedStyle(row);
  // fractional measure (clientHeight rounds to int; a sub-px error still adds
  // up to half a row over a long list)
  const height =
    row.getBoundingClientRect().height -
    parseFloat(cs.paddingTop) -
    parseFloat(cs.paddingBottom) -
    parseFloat(cs.borderTopWidth) -
    parseFloat(cs.borderBottomWidth);
  row.style.contentVisibility = "";
  if (height > 0 && height !== lastRowHeight) {
    lastRowHeight = height;
    listEl.style.setProperty("--row-h", `${height}px`);
  }
}

// toolbar fold/unfold-all toggle; visible in Group by window with 2+ window
// groups (hidden for a lone window), disabled while a search is active
function renderCollapseAllButton(groups: PanelRun[], anythingToFold: boolean): void {
  collapseAllBtn.hidden = !GROUPINGS[effectiveSort()] || !anythingToFold;
  if (collapseAllBtn.hidden) {
    return;
  }
  collapseAllBtn.disabled = groups.length === 0;
  const allCollapsed = groups.length > 0 && groups.every(([windowId]) => activeCollapsedSet().has(windowId));
  collapseAllBtn.innerHTML = allCollapsed ? FOLD_ICONS.unfold : FOLD_ICONS.fold;
  collapseAllBtn.title = collapseAllBtn.ariaLabel = allCollapsed ? "Click to Expand" : "Click to Collapse";
  collapseAllBtn.dataset.groups = JSON.stringify(groups.map(([windowId]) => windowId));
}

collapseAllBtn.addEventListener("click", () => {
  const windowIds: GroupKey[] = JSON.parse(collapseAllBtn.dataset.groups ?? "[]");
  const set = activeCollapsedSet();
  const allCollapsed = windowIds.every((id) => set.has(id));
  if (allCollapsed) {
    set.clear();
  } else {
    for (const id of windowIds) {
      set.add(id);
    }
  }
  render();
});

function renderBulkBar(): void {
  const summary = bulkSummary(state.visible, state.selected);
  // bar is always visible; empty selection disables the actions instead
  for (const button of bulkBar.querySelectorAll("button")) {
    button.disabled = summary.hidden;
  }
  bulkCount.textContent = summary.text;
  selectAllBox.checked = summary.allChecked;
  selectAllBox.indeterminate = summary.indeterminate;
  selectAllBox.title = summary.selectAllTitle;
}
