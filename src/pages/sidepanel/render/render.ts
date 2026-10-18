// The list renderer: render() derives what is visible and picks animated or plain,
// renderNow() rebuilds the list DOM; plus the chrome that follows every render
// (row-height feedback, fold-all button, bulk bar).
import { splitPairEdges } from "../../../app/split.ts";
import { enabledTags, splitTagQuery, tagColorHex } from "../../../app/tags.ts";
import { FOLD_ICONS } from "../../../lib/dom.ts";
import { hideCtxMenu } from "../../../lib/ui/context-menu.ts";
import {
  bulkBar,
  bulkCount,
  collapseAllBtn,
  filterBar,
  listEl,
  parkedUndoBtn,
  selectAllBox,
} from "../foundation/elements.ts";
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
import { renderGroupHeader, renderMembersWithTabGroupRuns, renderSplitSubheader } from "./headers.ts";
import { pillFit, syncMetaFit } from "./meta-fit.ts";
import { revealRow } from "./reveal.ts";
import { nestedInGroup, renderRow } from "./row.ts";
import { effectiveCollapsed, GROUPINGS, renderSortDirButton } from "./sorting.ts";
import type { PanelRun } from "./sorting.ts";
import { activeCollapsedSet, effectiveSort, nestedTabGroupsActive, parkedScope, state } from "../foundation/state.ts";
import type { GroupKey, PanelTab } from "../foundation/state.ts";
import { refillTagAssignPickerIfOpen } from "../input/tag-assign-picker.ts";
import { refillTagsPickerIfOpen } from "../input/tags-chip.ts";
import { refillWindowsPopoverIfOpen, syncQuickLaunchButton } from "../windows-popover/popover.ts";

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

// the pill fit is measured from the rendered rows: when the line width or font changed since the
// last render (first paint, resize, font size setting), render once more — same task, no flash
let refitting = false;
function renderNowImpl(): void {
  renderList();
  if (!refitting && syncMetaFit()) {
    refitting = true;
    try {
      renderList();
    } finally {
      refitting = false;
    }
  }
}

function renderList(): void {
  // any re-render (selection change, tab/window events, background refresh)
  // invalidates the open context menu's ids — close it rather than act stale
  hideCtxMenu();
  // active search: chips count found items (what clicking each filter would show)
  const counted = state.query ? searchCandidates(state.allTabs, state) : state.allTabs;
  const byFilter = countsByFilter(counted, state.derived, state.tagFilter);
  for (const button of filterBar.querySelectorAll("button")) {
    const name = button.dataset.filter;
    // static markup: every filter button has its count span (the Tags chip's is .tag-count, so
    // the four plain chips stay the ".count" set) and a FilterName in data-filter
    const count = button.querySelector(".count, .tag-count");
    if (count) {
      count.textContent = String(byFilter[name as FilterName]);
    }
    button.setAttribute("aria-pressed", String(name === state.filter));
  }
  renderTagsChip();

  listEl.classList.toggle("compact", state.ui.density === "compact");
  state.cursor = Math.min(state.cursor, state.visible.length - 1);
  // build everything into a fragment: one live-DOM mutation instead of N appends
  const frag = document.createDocumentFragment();
  if (state.fullVisible.length === 0) {
    const empty = document.createElement("div");
    empty.className = "empty";
    empty.textContent = emptyMessage(state.query, state.filter, parkedScope());
    frag.append(empty);
  }

  const maps = windowMaps(state.allTabs, state.currentWindowId, state.windowMeta);
  const now = Date.now();
  // tokenized once per render — rows highlight their matches while searching (#tokens light badges)
  const { text: queryTokens, tags: tagTokens } = splitTagQuery(state.query);
  const splitEdges = splitPairEdges(state.visible); // the render order: where each split's header goes
  // the Split sub-header goes right before a pair's first row, in every render path
  const splitHeaderFor = (tab: PanelTab, nested: boolean): HTMLElement | null => {
    const edge = splitEdges.get(tab.id);
    if (edge !== "first" && edge !== "only") {
      return null;
    }
    const at = state.visible.indexOf(tab);
    return renderSplitSubheader(state.visible.slice(at, at + (edge === "first" ? 2 : 1)), nested);
  };
  const appendRow = (frag: DocumentFragment, tab: PanelTab, index: number): void => {
    const header = splitHeaderFor(tab, false);
    if (header) {
      frag.append(header);
    }
    frag.append(renderRow(tab, rowVm(tab, index)));
  };
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
      tagTokens,
      fuzzy: fuzzyActive(state),
      parked: parkedScope(),
      fit: pillFit(nestedInGroup(tab) || (tab.id !== undefined && splitEdges.has(tab.id))),
      splitEdges,
    });

  let foldableGroups: PanelRun[] = [];
  let anythingToFold = false;
  const sort = effectiveSort();
  const grouping = GROUPINGS[sort];
  if (grouping) {
    const collapsed = effectiveCollapsed();
    const groups: PanelRun[] = groupTabs(state.fullVisible, grouping.key);
    // lone group: nothing to fold away — except a parked window, whose header is the thing
    // the user acts on (fold it to get its rows out of the way, the ⋯ stays)
    const collapsible = groups.length > 1 || parkedScope();
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
                : sort === "group-tag" && groupKey !== ""
                  ? tagColorHex(state.tags.find((tag) => tag.id === groupKey)?.color)
                  : null,
          tabGroupId: sort === "group-tabgroup" ? (groupKey as number) : null, // -1 = "No group" (drop = ungroup)
          tagHeader: sort === "group-tag" && groupKey !== "", // square marker like a tab group
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
          splitHeaderFor,
        );
        continue;
      }
      for (const tab of members) {
        appendRow(frag, tab, index++);
      }
    }
  } else {
    state.visible.forEach((tab, index) => {
      appendRow(frag, tab, index);
    });
  }
  listEl.replaceChildren(frag);
  syncRowHeight();
  syncHeaderHeight();
  renderCollapseAllButton(foldableGroups, anythingToFold);
  renderSortDirButton(grouping, anythingToFold);

  if (state.pendingScroll != null) {
    listEl.scrollTop = state.pendingScroll;
    state.pendingScroll = null;
  }

  if (state.followCurrent || state.revealCurrent) {
    // a row activated from the list must not jump under the click: the minimal scroll (the
    // tab-switch refresh that follows sets revealCurrent too — the click wins); every other
    // reveal puts the current row at the top
    const align = state.followCurrent ? "nearest" : "start";
    state.followCurrent = false;
    state.revealCurrent = false;
    const current = listEl.querySelector<HTMLElement>(".row.current");
    if (current) {
      revealRow(current, align);
    }
  }
  renderBulkBar();
  // Parked windows scope: the newest Remove (window, group or tab) can be undone right here
  parkedUndoBtn.hidden = !(parkedScope() && state.parkedTrashCount > 0);
  parkedUndoBtn.textContent = `Undo remove (${state.parkedTrashCount})`;
  syncQuickLaunchButton();
  refillWindowsPopoverIfOpen();
  refillTagsPickerIfOpen();
  refillTagAssignPickerIfOpen();
}

// Feed the real row height back into the content-visibility placeholder
// (--row-h). Offscreen rows use the placeholder for layout, so any gap between
// it and the true height (fonts per OS, fontSize/density settings) makes a
// restored scrollTop land rows off the saved position. Runs BEFORE the
// pendingScroll restore so the restore maps through corrected heights.
// the ask dialog sits right under the header (banners and the fuzzy label change its height)
let lastHeaderHeight = -1; // -1: the first measurement always writes (a 0 px header in tests included)
function syncHeaderHeight(): void {
  // static markup: the panel has one <header>
  const height = document.querySelector("header")!.getBoundingClientRect().height;
  if (height !== lastHeaderHeight) {
    lastHeaderHeight = height;
    document.documentElement.style.setProperty("--header-h", `${height}px`);
  }
}

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

// the Tags chip names its ticked tags: "Tags" (any), "● work" (one) or "2 tags"; the
// picker's tick list is rebuilt from state by its own module (input/tags-chip.ts)
function renderTagsChip(): void {
  const label = filterBar.querySelector('button[data-filter="tags"] .chip-label');
  if (!label) {
    return;
  }
  const ticked = enabledTags(state.tags).filter((tag) => state.tagFilter.has(tag.id));
  const [one] = ticked;
  label.textContent = ticked.length === 0 ? "Tags" : one && ticked.length === 1 ? one.name : `${ticked.length} tags`;
  const dot = filterBar.querySelector<HTMLElement>('button[data-filter="tags"] .tag-dot');
  if (dot) {
    dot.hidden = ticked.length !== 1;
    dot.style.background = one ? tagColorHex(one.color) : "";
  }
}

function renderBulkBar(): void {
  const summary = bulkSummary(state.visible, state.selected);
  // bar is always visible; empty selection disables the actions instead
  for (const button of bulkBar.querySelectorAll("button")) {
    button.disabled = summary.hidden;
  }
  // Parked rows are not tabs: the four tab actions hide; the count and the ✕ stay, the
  // ticked rows act through the row menu (Move / Open / Remove over the selection)
  for (const id of ["bulk-snooze", "bulk-wake", "bulk-protect", "bulk-close"]) {
    // static markup: the four buttons live in #bulk-bar
    bulkBar.querySelector<HTMLElement>(`#${id}`)!.hidden = parkedScope();
  }
  bulkCount.textContent = summary.text;
  selectAllBox.checked = summary.allChecked;
  selectAllBox.indeterminate = summary.indeterminate;
  selectAllBox.title = summary.selectAllTitle;
}
