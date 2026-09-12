// Imperative shell: DOM + chrome.* effects only. All list/view logic lives in
// model.js as pure functions; this file feeds them state and applies the results.
import {
  applyExperimental,
  featureEnabled,
  hostnameOf,
  recordMetric,
  resolveColorScheme,
  resolveNavMode,
} from "../core/core.js";
import { getElementById, FOLD_ICONS } from "../core/dom.js";
import { loadFeatures, loadState, saveState } from "../core/storage.js";
import {
  bulkSummary,
  countsByFilter,
  deriveTabs,
  emptyMessage,
  fuzzyActive,
  highlightRanges,
  searchCandidates,
  domainGroupName,
  groupTabs,
  titleGroupName,
  urlGroupName,
  WINDOW_DOT_COLORS,
  windowGroupName,
  rowViewModel,
  selectVisible,
  windowMaps,
} from "./model.js";
import { markDevPage } from "../core/env.js";

markDevPage();
// state read races the features fetch instead of queuing behind the top-level await
const initialStatePromise = loadState();
const FEATURES = await loadFeatures();

// ---------- performance metrics (PERFORMANCE flag) ----------

// Samples collect during a render burst, then one storage write on the next
// task — storage.local.perfMetrics is always current (the render-triggering
// storage listener ignores perf keys, so this can't echo into more renders).
const perfBuffer = [];
let perfFlushQueued = false;

const PERF_ON = featureEnabled(FEATURES, "PERFORMANCE"); // flags are static per load

function perfMeasure(key, fn) {
  if (!PERF_ON) {
    return fn();
  }
  const start = performance.now();
  const result = fn();
  perfBuffer.push([key, performance.now() - start]);
  if (!perfFlushQueued) {
    perfFlushQueued = true;
    setTimeout(flushPerfMetrics, 0);
  }
  return result;
}

async function flushPerfMetrics() {
  perfFlushQueued = false;
  if (perfBuffer.length === 0) {
    return;
  }
  const samples = perfBuffer.splice(0);
  const { perfMetrics = {} } = await chrome.storage.local.get("perfMetrics");
  await chrome.storage.local.set({
    perfMetrics: samples.reduce((m, [key, ms]) => recordMetric(m, key, ms), perfMetrics),
  });
}

const searchInput = getElementById("search");
const filterBar = getElementById("filters");
const scopeSelect = getElementById("scope");
const sortSelect = getElementById("sort");
const listEl = getElementById("tab-list");
const bulkBar = getElementById("bulk-bar");
const bulkCount = getElementById("bulk-count");
const selectAllBox = getElementById("select-all");
const collapseAllBtn = getElementById("collapse-all");


// the single mutable state of the panel — handlers write here, render reads
const state = {
  query: "",
  filter: "all",
  scope: "all-windows",
  sort: "recent",
  sortDir: "desc", // current sort's direction state (see SORT_DIRECTIONS)
  ui: {},
  rules: [],
  features: FEATURES, // experimental-resolved copy, refreshed in refresh()
  navMode: "off", // "off" | "compact" | "traditional" — resolved in refresh()
  allTabs: [],
  derived: new Map(), // per-tab {host, haystack, protected} — rebuilt each refresh
  visible: [], // rows the user can interact with (excludes collapsed groups)
  fullVisible: [], // before collapsing — header counts + empty-state check
  collapsedGroups: new Set(), // group keys collapsed in a grouped sort (session only)
  // collapse state WITHIN a search: each search starts fully expanded (matches
  // must be visible), but groups can then be folded without touching the
  // pre-search collapse state — same split as searchScrollByFilter
  searchCollapsedGroups: new Set(),
  selected: new Set(),
  cursor: -1,
  currentWindowId: null,
  // after activating, the tab jumps in the list (top in recent/window sorts) —
  // follow it on the next event-driven re-render so it doesn't vanish off-screen
  followCurrent: false,
  pendingScroll: null, // scrollTop to apply after the next render (filter/search switches)
  windowMeta: new Map(), // windowId → { name, color } from windowProfiles (WINDOW_NAMES)
};

// WINDOW_NAMES resolved flag + user toggle — every naming surface gates on this
function namesActive() {
  return featureEnabled(state.features, "WINDOW_NAMES") && (state.ui.windowNamesEnabled ?? true);
}

// window pinning rides the names feature but has its own kill switch
function pinActive() {
  return namesActive() && featureEnabled(state.features, "WINDOW_PIN");
}

// ---------- data ----------

// animate only for user-initiated refreshes; background event echoes
// (tab/storage/focus changes — incl. renders triggered in OTHER open panels)
// re-render without a view transition
async function refresh(animate = false, preloaded = null) {
  const [persisted, tabs, win, { windowProfiles = {} }, { windowSessionMap = {} }] = await Promise.all([
    preloaded ?? loadState(), // startup passes its already-read state — no second read
    chrome.tabs.query({}),
    chrome.windows.getLastFocused(),
    chrome.storage.local.get("windowProfiles"),
    chrome.storage.session.get("windowSessionMap"),
  ]);
  state.rules = persisted.protectionRules;
  state.ui = persisted.ui;
  document.documentElement.style.fontSize = `${state.ui.fontSize ?? 1}rem`;
  // light-dark() colors resolve via color-scheme, so forcing it flips the palette
  document.documentElement.style.colorScheme = resolveColorScheme(state.ui.theme);
  // focus moved to another window: the window grouping reorders (new current
  // window jumps to the top) — without a scroll the viewport stays mid-list
  // and the current group sits above it
  if (state.currentWindowId != null && win.id !== state.currentWindowId && effectiveSort() === "window") {
    state.followCurrent = true;
  }
  state.currentWindowId = win.id;
  state.allTabs = tabs;
  // tabs closed outside the panel (or id-swapped by discard) leave stale ids
  // in the selection — prune so counts and select-all stay truthful
  const liveIds = new Set(tabs.map((tab) => tab.id));
  for (const tabId of [...state.selected]) {
    if (!liveIds.has(tabId)) {
      state.selected.delete(tabId);
    }
  }
  state.derived = deriveTabs(tabs, state.rules);
  // resolved once per refresh; the keydown handler reads this instead of
  // re-running applyExperimental (a fresh object) on every keypress
  state.features = applyExperimental(FEATURES, state.ui.showExperimental ?? false);
  // window names/colors: session map binds live chrome ids to logical profiles
  state.windowMeta = new Map();
  if (namesActive()) {
    for (const [chromeId, logicalId] of Object.entries(windowSessionMap)) {
      const profile = windowProfiles[logicalId];
      if (profile && (profile.name || profile.color || profile.pinnedWindow)) {
        state.windowMeta.set(Number(chromeId), {
          name: profile.name,
          color: profile.color,
          // model + popover read meta blindly — omit the pin when its flag is off
          pinnedWindow: featureEnabled(state.features, "WINDOW_PIN") ? profile.pinnedWindow : undefined,
        });
      }
    }
  }
  // flag turned off mid-navigation: drop the cursor so no stale outline lingers
  if (!featureEnabled(state.features, "SIDEBAR_KEYBOARD_NAVIGATION")) {
    state.cursor = -1;
  }
  state.navMode = resolveNavMode(state.features, state.ui);
  // flag-gated sorts: hide options whose flag is off, and show the effective
  // sort if a stored preference can't apply
  for (const [value, flag] of Object.entries(FLAG_GATED_SORTS)) {
    /** @type {HTMLElement} */ (sortSelect.querySelector(`option[value="${value}"]`)).hidden =
      !featureEnabled(state.features, flag);
  }
  sortSelect.value = effectiveSort();
  getElementById("hist-back").hidden = state.navMode === "off";
  getElementById("hist-forward").hidden = state.navMode === "off";
  getElementById("hist-list-btn").hidden = !featureEnabled(state.features, "NAVIGATION_DROPDOWN");
  getElementById("win-list-btn").hidden = !namesActive();
  // offered only when experimental features are on AND FUZZY_SEARCH is enabled
  // BECAUSE of that opt-in (raw flag off, resolved flag on) — drives the same
  // ui.experimental_fuzzySearch pref as the options page
  getElementById("fuzzy-label").hidden = !(
    (state.ui.showExperimental ?? false) &&
    !featureEnabled(FEATURES, "FUZZY_SEARCH") &&
    featureEnabled(state.features, "FUZZY_SEARCH")
  );
  getElementById("fuzzy-toggle").checked = state.ui.experimental_fuzzySearch ?? true;
  render(animate);
}

// ---------- render ----------

const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)");

// animate=false for high-frequency renders (typing, cursor moves) where a
// view transition would add latency and caret flicker.
// VT snapshot cost scales with per-row view-transition-names, so big lists
// (1000-tab users) skip animation entirely — snappy beats pretty there.
const VT_MAX_ROWS = 100;

// Grouping registry: a grouped sort = a key function + a header-label builder.
// Add future groupings (domain, ...) here — collapse, fold-all, and the
// group-select checkbox come for free.
const GROUPINGS = {
  window: {
    noun: "window",
    key: (tab) => tab.windowId,
    name: (windowId, maps) =>
      windowGroupName(windowId, {
        currentWindowId: state.currentWindowId,
        indexes: maps.indexes,
        names: maps.names,
      }),
  },
  "group-title": {
    key: (tab) => tab.title ?? "",
    name: (title) => titleGroupName(title),
    noun: "group",
  },
  "group-domain": {
    key: (tab) => state.derived.get(tab.id)?.host ?? "",
    name: (host) => domainGroupName(host),
    noun: "group",
  },
  "group-url": {
    key: (tab) => tab.url ?? "",
    name: (url) => urlGroupName(url),
    noun: "group",
  },
};

// sorts that only exist while their feature flag is on (option hidden + a
// stored preference falls back to the window grouping)
const FLAG_GATED_SORTS = {
  "group-title": "GROUP_BY_TITLE",
  "group-domain": "GROUP_BY_DOMAIN",
  "group-url": "GROUP_BY_URL",
};

// Direction metadata per sort. Paired sorts (recent/oldest) swap the dropdown
// option itself. Flat sorts cycle asc⇄desc. Grouped sorts are TRI-state:
// "none" (natural order) → "desc" (most visible tabs first) → "asc" (fewest) →
// back to "none". states[0] is the canonical/first-time state.
const SORT_DIRECTIONS = {
  recent: { states: ["desc"], inverse: "oldest" },
  oldest: { states: ["asc"], inverse: "recent" },
  title: { states: ["asc", "desc"] },
  domain: { states: ["asc", "desc"] },
  window: { states: ["none", "desc", "asc"] },
  "group-title": { states: ["desc", "asc", "none"] }, // biggest groups first by default
  "group-domain": { states: ["desc", "asc", "none"] },
  "group-url": { states: ["desc", "asc", "none"] },
};

function canonicalDir(sort) {
  return (SORT_DIRECTIONS[sort] ?? { states: ["asc"] }).states[0];
}

// initial direction when a sort becomes active: canonical, unless the user
// opted into per-sort memory ("Sort memory: Remember previous" in options)
function initialDirFor(sort) {
  if ((state.ui.sortDirMode ?? "default") === "remember") {
    return state.ui.sortDirections?.[sort] ?? canonicalDir(sort);
  }
  return canonicalDir(sort);
}

const sortDirBtn = getElementById("sort-dir");

const DIR_TITLES = {
  none: "Default Sorting — click to sort by tab count, most first",
  desc: "Descending / most tabs first — click for ascending / fewest first",
  asc: "Ascending / fewest tabs first — click for next order",
};

// same shape as renderCollapseAllButton: one function owns the whole button,
// called only from render(). Hidden when a grouped sort has a lone group —
// same rule as the fold-all toggle.
function renderSortDirButton(grouping, anythingToFold) {
  sortDirBtn.hidden = Boolean(grouping) && !anythingToFold;
  if (sortDirBtn.hidden) { return; }
  const meta = SORT_DIRECTIONS[effectiveSort()] ?? { states: ["asc"] };
  const dir = meta.inverse ? meta.states[0] : state.sortDir;
  sortDirBtn.dataset.dir = dir;
  sortDirBtn.title = sortDirBtn.ariaLabel = DIR_TITLES[dir];
}

sortDirBtn.addEventListener("click", () => {
  const meta = SORT_DIRECTIONS[effectiveSort()];
  if (meta?.inverse) {
    // smart pair swap: e.g. Recently used ⇄ Least recently used
    state.sort = meta.inverse;
    sortSelect.value = meta.inverse;
    state.sortDir = canonicalDir(state.sort);
  } else {
    const states = meta?.states ?? ["asc", "desc"];
    state.sortDir = states[(states.indexOf(state.sortDir) + 1) % states.length];
  }
  resetScrollPositions(); // new order = saved positions meaningless; start at top
  persistUiPrefs();
  render(!state.query);
});

// flag-gated sort selected while its flag is off: fall back to the window
// grouping for display — the stored preference is not rewritten
function effectiveSort() {
  const flag = FLAG_GATED_SORTS[state.sort];
  if (flag && !featureEnabled(state.features, flag)) {
    return "window";
  }
  return state.sort;
}

// the collapse set in effect: searches get their own (fresh per search)
function activeCollapsedSet() {
  return state.query ? state.searchCollapsedGroups : state.collapsedGroups;
}

function effectiveCollapsed() {
  return GROUPINGS[effectiveSort()] ? activeCollapsedSet() : new Set();
}

function render(animate = true) {
  state.fullVisible = selectVisible(state.allTabs, { ...state, sort: effectiveSort(), now: Date.now() });
  const collapsed = effectiveCollapsed();
  const grouping = GROUPINGS[effectiveSort()];
  state.visible = grouping
    ? state.fullVisible.filter((tab) => !collapsed.has(grouping.key(tab)))
    : state.fullVisible;
  const heavy = Math.max(state.visible.length, listEl.childElementCount) > VT_MAX_ROWS;
  if (animate && !heavy && document.startViewTransition && !reducedMotion.matches) {
    document.startViewTransition(renderNow);
  } else {
    renderNow();
  }
}

function renderNow() {
  perfMeasure("sidepanel.render", renderNowImpl);
}

function renderNowImpl() {
  // any re-render (selection change, tab/window events, background refresh)
  // invalidates the open context menu's ids — close it rather than act stale
  hideCtxMenu();
  // active search: chips count found items (what clicking each filter would show)
  const counted = state.query ? searchCandidates(state.allTabs, state) : state.allTabs;
  const byFilter = countsByFilter(counted, state.derived);
  for (const button of filterBar.querySelectorAll("button")) {
    const name = button.dataset.filter;
    button.querySelector(".count").textContent = String(byFilter[name]);
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
  const rowVm = (tab, index) =>
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

  let foldableGroups = [];
  let anythingToFold = false;
  const sort = effectiveSort();
  const grouping = GROUPINGS[sort];
  if (grouping) {
    const collapsed = effectiveCollapsed();
    const groups = groupTabs(state.fullVisible, grouping.key);
    const collapsible = groups.length > 1; // lone group: nothing to fold away
    anythingToFold = collapsible;
    if (collapsible) foldableGroups = groups;
    // per-group totals in one pass (visible count = the group's own length)
    const totals = new Map();
    for (const tab of state.allTabs) {
      const key = grouping.key(tab);
      totals.set(key, (totals.get(key) ?? 0) + 1);
    }
    let index = 0;
    for (const [groupKey, members] of groups) {
      const isCollapsed = collapsible && collapsed.has(groupKey);
      frag.append(renderGroupHeader(groupKey, {
        isCollapsed,
        collapsible,
        name: grouping.name(groupKey, maps),
        // window color dot only makes sense for the window grouping
        dotColor:
          sort === "window" && maps.dotColors.size > 0
            ? (maps.dotColors.get(groupKey) ?? null)
            : null,
        tabs: members,
        noun: grouping.noun,
        count: members.length,
        total: totals.get(groupKey) ?? 0,
      }));
      if (isCollapsed) continue;
      for (const tab of members) frag.append(renderRow(tab, rowVm(tab, index++)));
    }
  } else {
    state.visible.forEach((tab, index) => frag.append(renderRow(tab, rowVm(tab, index))));
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
  renderBulkBar();
  refillWindowsPopoverIfOpen();
}

// Feed the real row height back into the content-visibility placeholder
// (--row-h). Offscreen rows use the placeholder for layout, so any gap between
// it and the true height (fonts per OS, fontSize/density settings) makes a
// restored scrollTop land rows off the saved position. Runs BEFORE the
// pendingScroll restore so the restore maps through corrected heights.
let lastRowHeight = 0;
function syncRowHeight() {
  const row = /** @type {HTMLElement | null} */ (listEl.querySelector(".row"));
  if (!row) {
    return;
  }
  row.style.contentVisibility = "visible"; // may be offscreen: force real layout to measure
  const cs = window.getComputedStyle(row);
  // fractional measure (clientHeight rounds to int; a sub-px error still adds
  // up to half a row over a long list)
  const height =
    row.getBoundingClientRect().height -
    parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom) -
    parseFloat(cs.borderTopWidth) - parseFloat(cs.borderBottomWidth);
  row.style.contentVisibility = "";
  if (height > 0 && height !== lastRowHeight) {
    lastRowHeight = height;
    listEl.style.setProperty("--row-h", `${height}px`);
  }
}

// toolbar fold/unfold-all toggle; visible in Group by window with 2+ window
// groups (hidden for a lone window), disabled while a search is active
function renderCollapseAllButton(groups, anythingToFold) {
  collapseAllBtn.hidden = !GROUPINGS[effectiveSort()] || !anythingToFold;
  if (collapseAllBtn.hidden) return;
  collapseAllBtn.disabled = groups.length === 0;
  const allCollapsed =
    groups.length > 0 && groups.every(([windowId]) => activeCollapsedSet().has(windowId));
  collapseAllBtn.innerHTML = allCollapsed ? FOLD_ICONS.unfold : FOLD_ICONS.fold;
  collapseAllBtn.title = collapseAllBtn.ariaLabel = allCollapsed ? "Click to Expand" : "Click to Collapse";
  collapseAllBtn.dataset.groups = JSON.stringify(groups.map(([windowId]) => windowId));
}

collapseAllBtn.addEventListener("click", () => {
  const windowIds = JSON.parse(collapseAllBtn.dataset.groups ?? "[]");
  const set = activeCollapsedSet();
  const allCollapsed = windowIds.every((id) => set.has(id));
  if (allCollapsed) {
    set.clear();
  } else {
    for (const id of windowIds) set.add(id);
  }
  render();
});

// S2: windows list as a popover (same shell as the history popover) — one row
// per window with dot, name and stats; click focuses the window, right-click
// opens the window menu (popover closes first: the ctx menu is not in the
// top layer and would render underneath it).
const winListBtn = getElementById("win-list-btn");
const winPop = getElementById("windows-pop");

winListBtn.addEventListener("click", fillWindowsPopover);

function fillWindowsPopover() {
  // anchored under the titlebar, right-aligned with the buttons
  const anchor = winListBtn.getBoundingClientRect();
  winPop.style.top = `${anchor.bottom + 4}px`;
  winPop.style.right = "8px";
  winPop.style.left = "auto";
  const maps = windowMaps(state.allTabs, state.currentWindowId, state.windowMeta);
  winPop.textContent = "";

  const head = document.createElement("div");
  head.className = "win-head";
  const heading = document.createElement("span");
  heading.className = "muted";
  heading.textContent = `Windows (${maps.indexes.size})`;
  const close = document.createElement("button");
  close.type = "button";
  close.className = "win-close";
  close.textContent = "Close";
  close.addEventListener("click", () => winPop.hidePopover?.());
  head.append(heading, close);
  winPop.append(head);

  // current window first, the rest alphabetical by display name
  const labelOf = (windowId) =>
    windowGroupName(windowId, {
      currentWindowId: state.currentWindowId,
      indexes: maps.indexes,
      names: maps.names,
    });
  // current window first, pinned windows next, the rest ABC by display name
  const pinRank = (windowId) =>
    pinActive() && state.windowMeta.get(windowId)?.pinnedWindow ? 0 : 1;
  const ordered = [...maps.indexes.keys()].sort((a, b) => {
    if (a === state.currentWindowId || b === state.currentWindowId) {
      return a === state.currentWindowId ? -1 : 1;
    }
    return (
      pinRank(a) - pinRank(b) ||
      labelOf(a).localeCompare(labelOf(b), undefined, { numeric: true, sensitivity: "base" })
    );
  });
  for (const windowId of ordered) {
    const tabs = state.allTabs.filter((tab) => tab.windowId === windowId);
    const snoozed = tabs.filter((tab) => tab.discarded).length;
    const awake = tabs.length - snoozed; // filter-chip terminology: awake = not snoozed
    const row = document.createElement("button");
    row.type = "button";
    row.className = windowId === state.currentWindowId ? "win-row current" : "win-row";
    row.dataset.windowId = String(windowId); // right-click → window menu
    const dot = document.createElement("span");
    dot.className = "win-dot";
    const color = maps.dotColors.get(windowId);
    if (color) {
      dot.style.background = color;
    } else {
      dot.classList.add("current");
    }
    const name = document.createElement("span");
    name.className = "win-title";
    name.textContent = labelOf(windowId);
    let pin = null;
    if (pinActive() && state.windowMeta.get(windowId)?.pinnedWindow) {
      pin = document.createElement("span");
      pin.className = "win-pin";
      pin.textContent = "📌";
      pin.title = "Pinned window";
    }
    const stats = document.createElement("span");
    stats.className = "win-stats muted";
    stats.textContent = `${tabs.length} tab${tabs.length === 1 ? "" : "s"} · ${awake} awake · ${snoozed} snoozed`;
    row.append(dot, name, ...(pin ? [pin] : []), stats);
    // native title, not #hover-tip: the popover lives in the top layer and
    // draws over any fixed-position tip; the browser tooltip renders above it
    const pinned = tabs.filter((tab) => tab.pinned).length;
    const audible = tabs.filter((tab) => tab.audible).length;
    const activeTab = tabs.find((tab) => tab.active);
    row.title = [
      labelOf(windowId),
      `${tabs.length} tab${tabs.length === 1 ? "" : "s"} · ${awake} awake · ${snoozed} snoozed`,
      `${pinned} pinned · ${audible} audible`,
      activeTab ? `Active tab: ${activeTab.title || activeTab.url}` : null,
    ].filter(Boolean).join("\n");
    row.addEventListener("click", () => {
      winPop.hidePopover?.();
      chrome.windows.update(windowId, { focused: true }).catch(() => {});
    });
    // ⋯ beside the row (a button can't nest one) — same window menu as right-click
    const menuBtn = document.createElement("button");
    menuBtn.type = "button";
    menuBtn.className = "win-menu-btn";
    menuBtn.title = menuBtn.ariaLabel = "Window actions";
    menuBtn.textContent = "⋯";
    menuBtn.addEventListener("click", (event) => {
      event.stopPropagation();
      openWindowListMenu(event, windowId);
    });
    const item = document.createElement("div");
    item.className = "win-item";
    item.append(row, menuBtn);
    winPop.append(item);
  }
}

// renders happen on every tab/storage event — keep an open popover current,
// but never yank a rename input out from under the user
function refillWindowsPopoverIfOpen() {
  if (winPopOpen() && !winPop.querySelector(".rename-input")) {
    fillWindowsPopover();
  }
}

function winPopOpen() {
  try {
    return winPop.matches(":popover-open");
  } catch {
    return false; // happy-dom: selector unsupported
  }
}

// popover="manual": no light dismiss — close on outside click, Escape (below,
// shared with the ctx menu) and window blur; clicks in the ctx menu keep it open
document.addEventListener("click", (event) => {
  const target = /** @type {HTMLElement} */ (event.target);
  if (winPopOpen() && !winPop.contains(target) && !winListBtn.contains(target) && !ctxMenu.contains(target)) {
    winPop.hidePopover?.();
  }
});

winPop.addEventListener("contextmenu", (event) => {
  const row = /** @type {HTMLElement | null} */ (
    /** @type {HTMLElement} */ (event.target).closest(".win-row")
  );
  if (!row) {
    return;
  }
  event.preventDefault();
  // windows popover stays open behind — the ctx menu is a manual popover
  // shown after it, so it stacks above in the top layer
  openWindowListMenu(event, Number(row.dataset.windowId));
});

// clickable group header (any grouping): toggles collapse of the group's rows
function renderGroupHeader(groupKey, { isCollapsed, collapsible, name, dotColor, tabs, noun, count, total }) {
  const header = document.createElement("div");
  header.className = "group-header";
  if (noun === "window") {
    header.dataset.windowId = String(groupKey); // drop target for tab moves
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
    dot.className = "win-dot";
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
  let pin = null;
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
    `${name}\n` +
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
      openWindowHeaderMenu(event, Number(groupKey));
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

// translate a row view-model into DOM; wires event handlers to actions
function renderRow(tab, vm) {
  if (!PERF_ON) {
    return renderRowImpl(tab, vm); // skip the per-row closure allocation
  }
  return perfMeasure("sidepanel.renderRow", () => renderRowImpl(tab, vm));
}

// cloneNode of the #row-template skeleton beats ~10 createElement calls plus
// per-button innerHTML SVG parsing on every row of every render
const ROW_TEMPLATE = /** @type {HTMLTemplateElement} */ (
  /** @type {unknown} */ (getElementById("row-template"))
);

// text with the model's highlight ranges wrapped in <mark> (plain textContent
// when there is nothing to mark — the common non-search path stays cheap)
function setTextWithMarks(el, text, ranges) {
  if (!ranges || ranges.length === 0) {
    el.textContent = text;
    return;
  }
  el.textContent = "";
  let pos = 0;
  for (const [start, end] of ranges) {
    if (start > pos) {
      el.append(text.slice(pos, start));
    }
    const mark = document.createElement("mark");
    mark.textContent = text.slice(start, end);
    el.append(mark);
    pos = end;
  }
  if (pos < text.length) {
    el.append(text.slice(pos));
  }
}

function renderRowImpl(tab, vm) {
  const row = /** @type {HTMLElement} */ (ROW_TEMPLATE.content.firstElementChild.cloneNode(true));
  row.className = vm.classes.join(" ");
  row.style.viewTransitionName = vm.viewTransitionName;
  row.dataset.tabId = String(tab.id);
  row.draggable = true; // drag onto another window's rows/header to move
  if (tab.url) {
    row.dataset.tip = tab.url; // full URL in the hover tip (titles ellipsize)
  }

  /** @type {HTMLInputElement} */ (row.querySelector("input")).checked = vm.checked;

  const dot = /** @type {HTMLElement} */ (row.querySelector(".win-dot"));
  if (vm.dot) {
    if (vm.dot.color) {
      dot.style.background = vm.dot.color;
    } else {
      dot.classList.add("current");
    }
    dot.title = vm.dot.title;
    // active-tab left bar picks this up ("" = current window → accent fallback)
    if (vm.dot.color) {
      row.style.setProperty("--win-color", vm.dot.color);
    }
  } else {
    dot.remove();
  }

  const favicon = row.querySelector(".favicon");
  if (vm.favicon.pageUrl) {
    favicon.append(faviconImg(vm.favicon.pageUrl));
  } else {
    favicon.textContent = vm.favicon.letter;
  }

  setTextWithMarks(/** @type {HTMLElement} */ (row.querySelector(".title")), vm.title, vm.titleRanges);
  setTextWithMarks(/** @type {HTMLElement} */ (row.querySelector(".host")), vm.host, vm.hostRanges);
  const meta = row.querySelector(".meta");
  if (vm.age) {
    const age = document.createElement("span");
    age.textContent = vm.age;
    meta.append(age);
  }
  for (const [label, kind] of vm.badges) {
    const badge = document.createElement("span");
    badge.className = kind ? `badge ${kind}` : "badge";
    badge.textContent = label;
    meta.append(badge);
  }

  if (!vm.canSnooze) {
    row.querySelector('[data-action="snooze"]').remove();
  }
  // template ships both protect variants; drop the one this row doesn't need
  row.querySelector(vm.protected ? '[data-icon="protect"]' : '[data-icon="unprotect"]').remove();
  const protect = /** @type {HTMLElement} */ (row.querySelector('[data-action="toggle-protect"]'));
  protect.title = protect.ariaLabel = vm.protectLabel;
  return row;
}

// Custom hover tip for group headers, offset right+below the pointer so the
// cursor never covers the text (native title tooltips can't be positioned).
const hoverTip = document.createElement("div");
hoverTip.id = "hover-tip";
hoverTip.hidden = true;
document.body.append(hoverTip);

function moveHoverTip(event) {
  hoverTip.style.left = `${Math.min(event.clientX + 14, window.innerWidth - hoverTip.offsetWidth - 4)}px`;
  hoverTip.style.top = `${Math.min(event.clientY + 18, window.innerHeight - hoverTip.offsetHeight - 4)}px`;
}

listEl.addEventListener("mouseover", (event) => {
  const target = /** @type {HTMLElement} */ (event.target);
  // buttons/checkboxes carry their own native tooltips — don't stack ours on top
  const carrier = target.closest("button, input")
    ? null
    : /** @type {HTMLElement | null} */ (target.closest(".group-header, .row"));
  if (!carrier || !carrier.dataset.tip) {
    hoverTip.hidden = true;
    return;
  }
  const tip = carrier.dataset.tip;
  // row tip = the URL — while searching, mark the matched tokens in it too
  if (carrier.classList.contains("row") && state.query.trim()) {
    const tokens = state.query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
    setTextWithMarks(hoverTip, tip, highlightRanges(tip, tokens, fuzzyActive(state)));
  } else {
    hoverTip.textContent = tip;
  }
  hoverTip.hidden = false;
  moveHoverTip(event);
});
listEl.addEventListener("mousemove", (event) => {
  if (!hoverTip.hidden) {
    moveHoverTip(event);
  }
});
listEl.addEventListener("mouseleave", () => (hoverTip.hidden = true));
listEl.addEventListener("scroll", () => (hoverTip.hidden = true), { passive: true });

// One delegated click listener instead of ~6 listeners per row — with big
// lists that's thousands of listener allocations saved on every render.
listEl.addEventListener("click", (event) => {
  hoverTip.hidden = true; // toggling changes the tip text; rehover shows fresh
  const target = /** @type {HTMLElement} */ (event.target);
  const row = /** @type {HTMLElement | null} */ (target.closest(".row"));
  if (!row) {
    return; // group headers keep their own handlers
  }
  const tabId = Number(row.dataset.tabId);
  if (target.matches('input[type="checkbox"]')) {
    if (/** @type {HTMLInputElement} */ (target).checked) {
      state.selected.add(tabId);
    } else {
      state.selected.delete(tabId);
    }
    render(false); // group checkboxes + header tips reflect selection too
    return;
  }
  const button = /** @type {HTMLElement | null} */ (target.closest("[data-action]"));
  switch (button?.dataset.action) {
    case "snooze":
      snooze([tabId]);
      return;
    case "toggle-protect":
      chrome.runtime.sendMessage({ type: "toggle-site-protection", tabId });
      return;
    case "close":
      closeTabs([tabId]);
      return;
  }
  const tab = state.allTabs.find((t) => t.id === tabId);
  if (tab) {
    activate(tab);
  }
});

// ---------- move tabs between windows (drag & drop + context menu) ----------

let draggedTabId = null; // dataTransfer is unreadable during dragover — track here
let dropTargetEl = null;

function clearDropTarget() {
  dropTargetEl?.classList.remove("drop-target");
  dropTargetEl = null;
}

// in-window reorder only makes sense while the list mirrors the real tab
// strip: Group by window with the "Same as window" tab order
function reorderActive() {
  return effectiveSort() === "window" && (state.ui.groupByWindowTabsOrder ?? "same-as-window") === "same-as-window";
}

// What a drop on this element would do: {windowId, index} or null (invalid).
// Cross-window: any row of the target window (drop lands AT that row's strip
// position) or its group header (appends at the end). Same window: only a row,
// and only while reorderActive() — that is the drag-to-reorder gesture.
function dropSpec(target) {
  const source = state.allTabs.find((tab) => tab.id === draggedTabId);
  if (!source) {
    return null;
  }
  const row = /** @type {HTMLElement | null} */ (target.closest(".row"));
  const targetTab = row
    ? state.allTabs.find((tab) => tab.id === Number(row.dataset.tabId))
    : null;
  const header = /** @type {HTMLElement | null} */ (target.closest(".group-header"));
  const windowId =
    targetTab?.windowId ?? (header?.dataset.windowId ? Number(header.dataset.windowId) : null);
  if (windowId == null) {
    return null;
  }
  if (windowId === source.windowId) {
    if (!reorderActive() || !targetTab || targetTab.id === draggedTabId) {
      return null;
    }
    return { windowId, index: targetTab.index ?? -1 };
  }
  return { windowId, index: targetTab?.index ?? -1 };
}

// dragging (or right-clicking) a selected row acts on the whole selection
function actionIds(tabId) {
  return state.selected.has(tabId) ? [...state.selected] : [tabId];
}

async function moveTabsToWindow(tabIds, windowId, index = -1) {
  if (windowId == null) {
    // new window: it is created around the first tab, the rest follow
    const [first, ...rest] = tabIds;
    const win = await chrome.windows.create({ tabId: first });
    if (rest.length > 0) {
      await chrome.tabs.move(rest, { windowId: win.id, index: -1 });
    }
  } else {
    await chrome.tabs.move(tabIds, { windowId, index });
  }
  refresh(true);
}

listEl.addEventListener("dragstart", (event) => {
  const row = /** @type {HTMLElement} */ (event.target).closest?.(".row");
  if (!row) {
    return;
  }
  draggedTabId = Number(/** @type {HTMLElement} */ (row).dataset.tabId);
  event.dataTransfer?.setData("text/plain", String(draggedTabId));
  if (event.dataTransfer) {
    event.dataTransfer.effectAllowed = "move";
  }
});

listEl.addEventListener("dragover", (event) => {
  if (draggedTabId == null) {
    return;
  }
  const spec = dropSpec(/** @type {HTMLElement} */ (event.target));
  if (!spec) {
    clearDropTarget();
    return; // not a valid target — the browser shows the no-drop cursor
  }
  event.preventDefault();
  if (event.dataTransfer) {
    event.dataTransfer.dropEffect = "move";
  }
  const el = /** @type {HTMLElement} */ (event.target).closest(".group-header, .row");
  if (el !== dropTargetEl) {
    clearDropTarget();
    dropTargetEl = /** @type {HTMLElement} */ (el);
    dropTargetEl?.classList.add("drop-target");
  }
});

listEl.addEventListener("drop", (event) => {
  if (draggedTabId == null) {
    return;
  }
  const spec = dropSpec(/** @type {HTMLElement} */ (event.target));
  if (!spec) {
    return;
  }
  event.preventDefault();
  moveTabsToWindow(actionIds(draggedTabId), spec.windowId, spec.index);
  draggedTabId = null;
  clearDropTarget();
});

listEl.addEventListener("dragend", () => {
  draggedTabId = null;
  clearDropTarget();
});

// right-click on a row: in-page menu moving the tab (or the selection, when
// the clicked row is part of it) to another window / a new window
const ctxMenu = document.createElement("div");
ctxMenu.id = "ctx-menu";
ctxMenu.hidden = true;
// manual popover: promoted to the top layer so it can sit ABOVE the windows
// popover (plain z-index never beats the top layer). "manual" = no light
// dismiss, our own click-away/Escape handlers keep working.
ctxMenu.setAttribute("popover", "manual");
document.body.append(ctxMenu);

function hideCtxMenu() {
  ctxMenu.hidden = true;
  try {
    ctxMenu.hidePopover();
  } catch {
    // not open / no popover API (tests) — the hidden attr already did the job
  }
}

function ctxItem(label, run) {
  const item = document.createElement("button");
  item.className = "ctx-item";
  item.textContent = label;
  item.addEventListener("click", () => {
    hideCtxMenu();
    run();
  });
  return item;
}

// "<label> ▸" toggle + nested dropdown: hover auto-expands, click toggles.
// Accordion: opening one folds the menu's other submenus; wandering over
// plain items leaves it open (deliberate — see ctx menu handlers below)
const SUBMENU_HOVER_DELAY_MS = 500;

function ctxSubmenu(label) {
  const btn = document.createElement("button");
  btn.className = "ctx-item ctx-move";
  const caret = document.createElement("span");
  caret.className = "ctx-caret";
  caret.textContent = "▸";
  btn.append(`${label} `, caret); // caret pushed right via CSS for breathing room
  const submenu = document.createElement("div");
  submenu.className = "ctx-submenu";
  submenu.hidden = true;
  // caret mirrors the expanded state: ▸ folded, ▾ open (like group headers)
  const setOpen = (open) => {
    if (open) {
      for (const other of /** @type {NodeListOf<HTMLElement>} */ (
        ctxMenu.querySelectorAll(".ctx-submenu")
      )) {
        if (other !== submenu && !other.hidden) {
          other.hidden = true;
          const otherCaret = other.previousElementSibling?.querySelector(".ctx-caret");
          if (otherCaret) {
            otherCaret.textContent = "▸";
          }
        }
      }
    }
    submenu.hidden = !open;
    caret.textContent = open ? "▾" : "▸";
  };
  let hoverTimer = null;
  btn.addEventListener("click", (clickEvent) => {
    clickEvent.stopPropagation(); // the document click-away handler must not close the menu
    clearTimeout(hoverTimer); // a pending hover-open must not undo a click-fold
    setOpen(submenu.hidden);
  });
  // hover intent: a cursor traveling past the toggle (e.g. down to Focus
  // window) must not expand it — open only after it settles for a beat
  btn.addEventListener("mouseenter", () => {
    hoverTimer = setTimeout(() => setOpen(true), SUBMENU_HOVER_DELAY_MS);
  });
  btn.addEventListener("mouseleave", () => clearTimeout(hoverTimer));
  return { btn, submenu };
}

function ctxTitle(text) {
  const title = document.createElement("div");
  title.className = "ctx-title";
  title.textContent = text;
  return title;
}

// display name of a window (custom name or "Window #N") for menu headers
function windowLabel(windowId) {
  const maps = windowMaps(state.allTabs, state.currentWindowId, state.windowMeta);
  return windowGroupName(windowId, {
    currentWindowId: state.currentWindowId,
    indexes: maps.indexes,
    names: maps.names,
  });
}

function ctxDivider() {
  const divider = document.createElement("div");
  divider.className = "ctx-divider";
  return divider;
}

// the five bulk-bar actions as menu items over an explicit id set
function appendCtxActions(ids) {
  /** @type {[string, () => void][]} */
  const actions = [
    ["Snooze", () => snooze(ids)],
    ["Wake", () => wake(ids)],
    ["Protect", () => protectTabs(ids)],
    ["Unprotect", () => unprotectTabs(ids)],
    ["Close", () => closeTabs(ids)],
  ];
  for (const [label, run] of actions) {
    ctxMenu.append(ctxItem(ids.length > 1 ? `${label} ${ids.length} tabs` : label, run));
  }
}

function showCtxMenu(event) {
  // every menu build ends here — stamp an X in the top-right corner
  const close = document.createElement("button");
  close.type = "button";
  close.className = "ctx-close";
  close.title = close.ariaLabel = "Close menu";
  close.innerHTML =
    '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M4 4l8 8M12 4l-8 8"/></svg>';
  close.addEventListener("click", hideCtxMenu);
  ctxMenu.prepend(close);
  ctxMenu.hidden = false;
  try {
    ctxMenu.showPopover();
  } catch {
    // already open / no popover API (tests) — visible via hidden=false anyway
  }
  ctxMenu.style.left = `${Math.max(0, Math.min(event.clientX, window.innerWidth - ctxMenu.offsetWidth - 4))}px`;
  ctxMenu.style.top = `${Math.max(0, Math.min(event.clientY, window.innerHeight - ctxMenu.offsetHeight - 4))}px`;
}

function openRowMenu(event, tabId) {
  const ids = actionIds(tabId);
  const sourceWindows = new Set(
    ids.map((id) => state.allTabs.find((tab) => tab.id === id)?.windowId),
  );
  const maps = windowMaps(state.allTabs, state.currentWindowId, state.windowMeta);
  ctxMenu.textContent = "";
  const clicked = state.allTabs.find((tab) => tab.id === tabId);
  ctxMenu.append(
    ctxTitle(ids.length > 1 ? `${ids.length} tabs selected` : clicked?.title || "Tab"),
    ctxDivider(),
  );
  appendCtxActions(ids);
  ctxMenu.append(ctxDivider());
  const { btn, submenu } = ctxSubmenu(ids.length > 1 ? `Move ${ids.length} tabs to` : "Move tab to");
  ctxMenu.append(btn, submenu);
  for (const windowId of [...maps.indexes.keys()]) {
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
  showCtxMenu(event);
}

const WINDOW_TAB_ORDERS = [
  ["recent", "Recently used"],
  ["same-as-window", "Same as window"],
  ["title-asc", "Title sorted A-Z"],
  ["title-desc", "Title sorted Z-A"],
];

// human labels for WINDOW_DOT_COLORS, same order
const WINDOW_DOT_COLOR_NAMES = ["Red", "Teal", "Yellow", "Green", "Purple", "Pink", "Gray", "Gold"];

async function setWindowPin(windowId, pinned) {
  await chrome.runtime.sendMessage({ type: "window-pin", windowId, pinned }).catch(() => {});
  refresh(true);
}

async function setWindowColor(windowId, color) {
  await chrome.runtime.sendMessage({ type: "window-set-color", windowId, color }).catch(() => {});
  refresh(true);
}

// swap the header label for an input; Enter/blur commit, Esc cancels.
// An event-driven re-render mid-edit rebuilds the header and ends the edit —
// rare and harmless (rename again), not worth pausing renders for.
function buildRenameInput(windowId, onDone) {
  const input = document.createElement("input");
  input.className = "rename-input";
  input.value = state.windowMeta.get(windowId)?.name ?? "";
  input.placeholder = "Window name";
  input.addEventListener("click", (event) => event.stopPropagation()); // header click = collapse
  let cancelled = false;
  input.addEventListener("keydown", (event) => {
    event.stopPropagation(); // list keyboard nav / popover Esc must not fire mid-edit
    if (event.key === "Enter") {
      input.blur();
    }
    if (event.key === "Escape") {
      cancelled = true;
      input.blur();
    }
  });
  input.addEventListener("blur", async () => {
    if (!cancelled) {
      // empty commits too — it clears the name back to the default label
      await chrome.runtime
        .sendMessage({ type: "window-rename", windowId, name: input.value })
        .catch(() => {});
    }
    onDone();
  });
  return input;
}

function startRenameWindow(windowId) {
  const label = listEl.querySelector(`.group-header[data-window-id="${windowId}"] .group-label`);
  if (!label) {
    return;
  }
  const input = buildRenameInput(windowId, () => refresh(false));
  label.replaceWith(input);
  input.focus();
  input.select();
}

// rename without leaving the windows popover: swap the row's name for the input
function startRenameWindowInList(windowId) {
  const title = winPop.querySelector(`.win-row[data-window-id="${windowId}"] .win-title`);
  if (!title) {
    return;
  }
  const input = buildRenameInput(windowId, () => {
    fillWindowsPopover(); // fresh name in place, popover stays open
    refresh(false);
  });
  title.replaceWith(input);
  input.focus();
  input.select();
}

// Rename + Window color entries (shared by the header menu and the
// windows-list menu)
function appendWindowIdentityItems(windowId, startRename = startRenameWindow) {
  // "Pin window" — pinned windows sort to the top of the windows list
  if (pinActive()) {
    const isPinned = state.windowMeta.get(windowId)?.pinnedWindow ?? false;
    ctxMenu.append(ctxItem(isPinned ? "Unpin window" : "Pin window", () => setWindowPin(windowId, !isPinned)));
  }
  ctxMenu.append(ctxItem("Rename window…", () => startRename(windowId)));
  const color = ctxSubmenu("Window color");
  ctxMenu.append(color.btn, color.submenu);
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

// windows-list rows get a window-scoped menu only — no tab bulk actions,
// no Tabs Order (those belong to the header of a visible tab group)
function openWindowListMenu(event, windowId) {
  ctxMenu.textContent = "";
  ctxMenu.append(ctxTitle(windowLabel(windowId)), ctxDivider());
  if (windowId !== state.currentWindowId) {
    ctxMenu.append(ctxItem("Focus window", () => chrome.windows.update(windowId, { focused: true })));
  }
  appendWindowIdentityItems(windowId, startRenameWindowInList);
  showCtxMenu(event);
}

// window group header: same actions over the window's selected tabs — or every
// visible tab when nothing in it is selected — plus a "Change order" dropdown
// driving ui.groupByWindowTabsOrder (current one marked)
function openWindowHeaderMenu(event, windowId) {
  const windowTabs = state.fullVisible.filter((tab) => tab.windowId === windowId);
  const selectedHere = windowTabs.filter((tab) => state.selected.has(tab.id));
  const ids = (selectedHere.length > 0 ? selectedHere : windowTabs).map((tab) => tab.id);
  if (ids.length === 0) {
    return;
  }
  ctxMenu.textContent = "";

  // header: window display name (custom name or "Window #N")
  ctxMenu.append(ctxTitle(windowLabel(windowId)), ctxDivider());

  // window-identity section (WINDOW_NAMES feature only)
  if (namesActive()) {
    // "Focus window" — bring that window to front (pointless on the current one)
    if (windowId !== state.currentWindowId) {
      ctxMenu.append(ctxItem("Focus window", () => chrome.windows.update(windowId, { focused: true })));
    }
    // "Rename window…" + "Window color ▸" (palette swatches + Auto)
    appendWindowIdentityItems(windowId);
    ctxMenu.append(ctxDivider());
  }

  // "Snooze / Wake / Protect / Unprotect / Close" — the five bulk-bar actions
  // over the window's selection (or all its visible tabs)
  appendCtxActions(ids);
  ctxMenu.append(ctxDivider());

  // "Tabs Order ▸" — within-window order for the window grouping
  // (Recently used / Same as window / Title A-Z / Title Z-A, current marked)
  const { btn, submenu } = ctxSubmenu("Tabs Order");
  ctxMenu.append(btn, submenu);
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

listEl.addEventListener("contextmenu", (event) => {
  const target = /** @type {HTMLElement} */ (event.target);
  const header = /** @type {HTMLElement | null} */ (target.closest(".group-header"));
  const row = /** @type {HTMLElement | null} */ (target.closest(".row"));
  if (!header?.dataset.windowId && !row) {
    return; // non-window headers/empty space keep the native menu
  }
  event.preventDefault();
  hoverTip.hidden = true;
  if (header?.dataset.windowId) {
    openWindowHeaderMenu(event, Number(header.dataset.windowId));
  } else if (row) {
    openRowMenu(event, Number(row.dataset.tabId));
  }
});

// cursor wandering back up to the plain actions folds the Move-to dropdown
// (mirrors the hover that opened it)
// an expanded submenu stays expanded while the cursor visits plain items —
// only opening another submenu (accordion in ctxSubmenu) or closing the menu folds it

document.addEventListener("click", hideCtxMenu);
window.addEventListener("blur", hideCtxMenu); // focus left for another window/tab
// capture phase: an Esc that closes the menu must not also clear the search
document.addEventListener(
  "keydown",
  (event) => {
    if (event.key === "Escape" && !ctxMenu.hidden) {
      hideCtxMenu();
      event.stopPropagation();
    } else if (event.key === "Escape" && winPopOpen()) {
      winPop.hidePopover?.();
      event.stopPropagation();
    }
  },
  true,
);
listEl.addEventListener("scroll", hideCtxMenu, { passive: true });

// row action icons live in #row-template now; this one is for the history popover
const ICONS = {
  close: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M4 4l8 8M12 4l-8 8"/></svg>',
};

function renderBulkBar() {
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

// ---------- actions ----------

// Chrome's local favicon cache — no network request to the site
function faviconImg(pageUrl) {
  const url = new URL(chrome.runtime.getURL("/_favicon/"));
  url.searchParams.set("pageUrl", pageUrl);
  url.searchParams.set("size", "16");
  const img = document.createElement("img");
  img.src = url.toString();
  img.loading = "lazy"; // don't fetch favicons for offscreen rows up front
  img.width = img.height = 16;
  img.addEventListener("error", () => img.remove());
  return img;
}

async function activate(tab) {
  await chrome.windows.update(tab.windowId, { focused: true });
  await chrome.tabs.update(tab.id, { active: true });
  state.followCurrent = true;
}

let toastTimer;
function toast(message) {
  const el = getElementById("toast");
  el.textContent = message;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (el.hidden = true), 5000);
}

// an action consumes only the tabs it acted on — the rest of the selection
// survives (a row-button action must not wipe an unrelated multi-select)
function unselect(tabIds) {
  for (const tabId of tabIds) {
    state.selected.delete(tabId);
  }
}

async function snooze(tabIds) {
  const failures = [];
  for (const tabId of tabIds) {
    const response = await chrome.runtime.sendMessage({ type: "snooze-tab", tabId });
    if (response?.error) failures.push(response.error);
  }
  if (failures.length > 0) {
    toast(`Could not snooze ${failures.length} tab(s): ${failures[0]}`);
  }
  unselect(tabIds);
  refresh(true);
}

// background reload of snoozed tabs — wakes without switching to them;
// non-discarded tabs are skipped so a mixed selection never force-reloads live pages
async function wake(tabIds) {
  const snoozed = tabIds.filter(
    (tabId) => state.allTabs.find((tab) => tab.id === tabId)?.discarded,
  );
  await Promise.all(snoozed.map((tabId) => chrome.tabs.reload(tabId).catch(() => {})));
  unselect(tabIds);
  refresh(true);
}

async function closeTabs(tabIds) {
  // Native confirm for multi-close; upgrade to undo snackbar if it annoys
  if (tabIds.length > 1 && !confirm(`Close ${tabIds.length} tabs?`)) return;
  try {
    await chrome.tabs.remove(tabIds);
  } catch (error) {
    console.debug("close failed", error);
  }
  unselect(tabIds);
  refresh(true);
}

function hostsOf(tabIds) {
  const hosts = tabIds
    .map((tabId) => state.allTabs.find((tab) => tab.id === tabId))
    .filter(Boolean)
    .map((tab) => hostnameOf(tab.url))
    .filter(Boolean);
  return [...new Set(hosts)];
}

async function protectTabs(tabIds) {
  await chrome.runtime.sendMessage({ type: "protect-hosts", hosts: hostsOf(tabIds) });
  unselect(tabIds);
  refresh(true);
}

async function unprotectTabs(tabIds) {
  await chrome.runtime.sendMessage({ type: "unprotect-hosts", hosts: hostsOf(tabIds) });
  unselect(tabIds);
  refresh(true);
}

// ---------- events ----------

// Scroll positions are remembered per filter — in two separate worlds, so they
// can't clobber each other: scrollByFilter holds normal-browsing positions
// (restored when the search is cleared), searchScrollByFilter holds positions
// within the current search results (restored when switching filters mid-search,
// discarded when the search ends).
const scrollByFilter = new Map();
const searchScrollByFilter = new Map();

function setQuery(value) {
  if (value && !state.query) {
    scrollByFilter.set(state.filter, listEl.scrollTop); // entering search
    state.searchCollapsedGroups.clear(); // every search starts fully expanded
  }
  if (!value) {
    searchScrollByFilter.clear(); // search over — in-results positions are stale
    state.searchCollapsedGroups.clear();
  }
  state.query = value;
  // search narrowed the current filter to nothing while matches exist elsewhere:
  // auto-select All so the results aren't hidden behind the filter (not
  // persisted — the user didn't choose it)
  if (
    value &&
    state.filter !== "all" &&
    featureEnabled(state.features, "SEARCH_AUTO_SELECT_ALL") &&
    (state.ui.searchEmptyFilter ?? "keep") === "all" // user opted in (options: Customization)
  ) {
    const found = countsByFilter(searchCandidates(state.allTabs, state), state.derived);
    if (found[state.filter] === 0 && found.all > 0) {
      state.filter = "all";
    }
  }
  state.cursor = value ? 0 : -1;
  state.pendingScroll = value ? 0 : (scrollByFilter.get(state.filter) ?? 0);
  render(false);
}

searchInput.addEventListener("input", () => {
  setQuery(searchInput.value);
});

filterBar.addEventListener("click", (event) => {
  const button = /** @type {HTMLElement | null} */ (
    /** @type {HTMLElement} */ (event.target).closest("button[data-filter]")
  );
  if (!button) return;
  // per-filter scroll memory applies while searching too, but in-search
  // positions live in their own map so pre-search spots survive the search
  const scrollMap = state.query ? searchScrollByFilter : scrollByFilter;
  scrollMap.set(state.filter, listEl.scrollTop);
  state.filter = button.dataset.filter;
  state.pendingScroll = scrollMap.get(state.filter) ?? 0;
  persistUiPrefs();
  // mid-search the old/new filtered sets barely overlap — a view transition
  // cross-fades two unrelated lists (reads as ghosting), so skip animation
  render(!state.query);
});

// scope/sort change = a different list — start at top, and saved per-filter
// positions from the old view are meaningless now
function resetScrollPositions() {
  scrollByFilter.clear();
  searchScrollByFilter.clear();
  state.pendingScroll = 0;
}

scopeSelect.addEventListener("change", () => {
  state.scope = scopeSelect.value;
  resetScrollPositions();
  persistUiPrefs();
  render(!state.query);
});

sortSelect.addEventListener("change", () => {
  state.sort = sortSelect.value;
  state.sortDir = initialDirFor(state.sort);
  state.collapsedGroups.clear(); // keys from another grouping are meaningless
  state.searchCollapsedGroups.clear();
  resetScrollPositions();
  persistUiPrefs();
  render(!state.query);
});

// JSON of the ui object this panel just persisted — its storage echo is skipped
// (the click handler already rendered that state; without this every filter/
// scope/sort click renders twice and re-queries all tabs 150ms later)
let lastOwnUiWrite = null;

function persistUiPrefs() {
  const ui = {
    ...state.ui,
    defaultFilter: state.filter,
    scope: state.scope,
    sort: state.sort,
    // every sort remembers its last direction (only applied when the user's
    // Sort memory option is "remember")
    sortDirections: { ...(state.ui.sortDirections ?? {}), [state.sort]: state.sortDir },
  };
  state.ui = ui;
  lastOwnUiWrite = JSON.stringify(ui);
  saveState({ ui });
}

// fuzzy checkbox next to search = the same ui.experimental_fuzzySearch pref
// the options page exposes; re-render re-ranks the active search immediately
getElementById("fuzzy-toggle").addEventListener("change", () => {
  state.ui = { ...state.ui, experimental_fuzzySearch: getElementById("fuzzy-toggle").checked };
  persistUiPrefs();
  render(false);
});

// Select/unselect everything currently visible (i.e. matching search + filter).
selectAllBox.addEventListener("change", () => {
  if (selectAllBox.checked) {
    for (const tab of state.visible) state.selected.add(tab.id);
  } else {
    for (const tab of state.visible) state.selected.delete(tab.id);
  }
  render(false);
});

getElementById("settings-btn").addEventListener("click", () => {
  chrome.runtime.openOptionsPage();
});

getElementById("bulk-snooze").addEventListener("click", () => snooze([...state.selected]));
getElementById("bulk-wake").addEventListener("click", () => wake([...state.selected]));
getElementById("bulk-protect").addEventListener("click", () => protectTabs([...state.selected]));
getElementById("bulk-close").addEventListener("click", () => closeTabs([...state.selected]));
getElementById("bulk-clear").addEventListener("click", () => {
  state.selected.clear();
  render();
});

document.addEventListener("keydown", (event) => {
  if (event.key === "/" && document.activeElement !== searchInput) {
    event.preventDefault();
    searchInput.focus();
    return;
  }
  if (event.key === "Escape") {
    // open history popover: the browser closes it on this same Esc (native
    // light dismiss) — don't also clear the search underneath
    if (isPopoverOpen()) {
      return;
    }
    searchInput.value = "";
    setQuery("");
    searchInput.focus();
    return;
  }
  const keyboardNav = featureEnabled(state.features, "SIDEBAR_KEYBOARD_NAVIGATION");
  if (event.key === "ArrowDown" || event.key === "ArrowUp") {
    if (!keyboardNav) return;
    event.preventDefault();
    if (state.visible.length === 0) return;
    const next = event.key === "ArrowDown"
      ? Math.min(state.cursor + 1, state.visible.length - 1)
      : Math.max(state.cursor - 1, 0);
    // move the cursor class directly — a full render per keypress is ~90ms on big lists
    const rows = listEl.querySelectorAll(".row");
    rows[state.cursor]?.classList.remove("cursor");
    state.cursor = next;
    rows[next]?.classList.add("cursor");
    rows[next]?.scrollIntoView({ block: "nearest" });
    return;
  }
  if (event.key === "Enter" && keyboardNav && state.cursor >= 0 && state.visible[state.cursor]) {
    activate(state.visible[state.cursor]);
    // activated tab jumps to the top of the list — put the cursor back on it
    state.cursor = 0;
  }
});

// Tab/storage events → debounced refresh. Querying Chrome fresh each time
// avoids incremental-cache sync bugs; cheap for a few hundred tabs.
let refreshTimer;
function scheduleRefresh() {
  clearTimeout(refreshTimer);
  refreshTimer = setTimeout(refresh, 150);
}

for (const event of [
  chrome.tabs.onCreated,
  chrome.tabs.onActivated,
  chrome.tabs.onRemoved,
  chrome.tabs.onMoved,
  chrome.tabs.onAttached,
  chrome.tabs.onDetached,
  chrome.windows.onFocusChanged,
]) {
  event.addListener(scheduleRefresh);
}

// onUpdated fires for every tab's loading progress — with hundreds of tabs that's
// a constant stream; only changes the list actually shows should trigger a render
const RENDERED_TAB_PROPS = ["title", "url", "favIconUrl", "discarded", "audible", "pinned"];
chrome.tabs.onUpdated.addListener((_tabId, changeInfo) => {
  if (RENDERED_TAB_PROPS.some((prop) => prop in changeInfo)) scheduleRefresh();
});

// our own perf flush + history bookkeeping write storage constantly — don't
// let those echo back into renders (history buttons have their own listener)
chrome.storage.onChanged.addListener((changes) => {
  const ignored = [
    "perfMetrics", "perfSnapshots", "tabHistory", "updateAvailable", "dismissedUpdate",
    "windowProfiles", "windowSessionMap", // identity bookkeeping churns on every tab event
  ];
  const relevant = Object.keys(changes).filter((key) => !ignored.includes(key));
  if (relevant.length === 0) {
    return;
  }
  // this panel's own ui-prefs write echoing back — already rendered that state
  if (
    relevant.length === 1 &&
    relevant[0] === "ui" &&
    JSON.stringify(changes.ui.newValue) === lastOwnUiWrite
  ) {
    lastOwnUiWrite = null;
    return;
  }
  scheduleRefresh();
});

// ---------- init ----------

initialStatePromise.then((persisted) => {
  state.filter = persisted.ui.defaultFilter;
  state.scope = persisted.ui.scope;
  state.sort = persisted.ui.sort;
  state.ui = persisted.ui; // initialDirFor reads sortDirMode/sortDirections
  state.sortDir = initialDirFor(state.sort);
  scopeSelect.value = state.scope;
  sortSelect.value = state.sort;
  refresh(false, persisted); // search input focuses itself via the autofocus attribute
});

// ---------- update notice ----------

// reload() applies the deferred update (an open panel blocks auto-install)
const updateBanner = getElementById("update-banner");
const updateRestart = getElementById("update-restart");
// reload ONLY from the restart button — a listener on the banner container
// Deferred out of the click stack: runtime.reload() tears this very document
// down, and doing that mid-handler is a known crashy path (esp. unpacked).
updateRestart.addEventListener("click", () => setTimeout(() => chrome.runtime.reload(), 0));

// dismiss = remember THIS version; the nudge returns only for a newer update
getElementById("update-dismiss").addEventListener("click", async () => {
  const { updateAvailable } = await chrome.storage.local.get("updateAvailable");
  await chrome.storage.local.set({ dismissedUpdate: updateAvailable });
  // the storage echo re-runs syncUpdateBanner in every open panel
});

async function syncUpdateBanner() {
  const { updateAvailable, dismissedUpdate, ui } = /** @type {Record<string, any>} */ (
    await chrome.storage.local.get(["updateAvailable", "dismissedUpdate", "ui"])
  );
  const show =
    Boolean(updateAvailable) &&
    updateAvailable !== dismissedUpdate &&
    !(ui?.hideUpdateBanner ?? false);
  if (show) {
    updateRestart.textContent = `Update ${updateAvailable} ready — click to update or restart Taboom`;
    updateRestart.title = "Click to restart Taboom and apply the update";
  }
  updateBanner.hidden = !show;
}
syncUpdateBanner();
chrome.storage.onChanged.addListener(syncUpdateBanner);

// ---------- tab history nav (back / forward across tabs) ----------

const histBack = getElementById("hist-back");
const histForward = getElementById("hist-forward");
const histListBtn = getElementById("hist-list-btn");
const histPop = getElementById("history-pop");

function isPopoverOpen() {
  try {
    return histPop.matches(":popover-open");
  } catch {
    return false; // happy-dom: selector unsupported
  }
}

// Focus tracking: losing focus (user clicked into the page or another window)
// closes any open popup; both transitions are announced — no consumer yet,
// hook points for future focus-aware behavior.
window.addEventListener("focus", () => {
  chrome.runtime.sendMessage({ type: "sidebar-focused" }).catch(() => {}); // SW may be asleep
});
window.addEventListener("blur", () => {
  try {
    histPop.hidePopover?.();
  } catch {} // already hidden
  try {
    winPop.hidePopover?.();
  } catch {} // already hidden
  chrome.runtime.sendMessage({ type: "sidebar-no-focus" }).catch(() => {});
});

// navigation mode switched (options page, any window): close an open popup —
// its rows and header belong to the previous mode. storage.onChanged already
// broadcasts to every panel, so no extra message plumbing is needed.
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "local" || !changes.ui) {
    return;
  }
  const oldNav = /** @type {any} */ (changes.ui.oldValue)?.historyNav;
  const newNav = /** @type {any} */ (changes.ui.newValue)?.historyNav;
  if (oldNav !== newNav) {
    try {
      histPop.hidePopover?.();
    } catch {} // already hidden
  }
});

// caret flips while the popover is open; the toggle event fires on every close
// path (button click, light dismiss, Esc), so the icon can't get stuck
histPop.addEventListener("toggle", (event) => {
  const open = /** @type {{newState?: string}} */ (event).newState === "open";
  histListBtn.classList.toggle("open", open);
  histListBtn.title = histListBtn.ariaLabel = open
    ? "Hide Navigation History"
    : "Show Navigation History";
});

histBack.addEventListener("click", () => {
  if (consumeLongPress()) {
    return; // the hold opened the popover; don't also navigate
  }
  chrome.runtime.sendMessage({ type: "history-back" });
});
histForward.addEventListener("click", () => {
  if (consumeLongPress()) {
    return;
  }
  chrome.runtime.sendMessage({ type: "history-forward" });
});

/** @returns {Promise<{stack: number[], cursor: number}>} */
async function getTabHistory() {
  const { tabHistory } = /** @type {{tabHistory?: {stack: number[], cursor: number}}} */ (
    await chrome.storage.local.get("tabHistory")
  );
  return tabHistory ?? { stack: [], cursor: -1 };
}

async function syncHistoryButtons() {
  const { stack, cursor } = await getTabHistory();
  histBack.disabled = cursor <= 0;
  histForward.disabled = cursor >= stack.length - 1;
}

// populate on open (popovertarget handles show/hide natively)
histListBtn.addEventListener("click", fillHistoryPopover);

async function fillHistoryPopover() {
  // anchor just below the nav buttons, left-aligned (CSS anchor positioning needs Chrome 125+)
  const anchor = histForward.parentElement.getBoundingClientRect();
  histPop.style.top = `${anchor.bottom + 4}px`;
  histPop.style.left = `${Math.max(4, anchor.left)}px`;
  const { stack, cursor } = await getTabHistory();
  const allTabs = await chrome.tabs.query({});
  const byId = new Map(allTabs.map((t) => [t.id, t]));
  const { dotColors } = windowMaps(allTabs, state.currentWindowId, state.windowMeta);
  histPop.textContent = "";

  const head = document.createElement("div");
  head.className = "hist-head";
  const heading = document.createElement("span");
  heading.className = "muted";
  heading.textContent =
    state.navMode === "compact" ? "Compact Navigation History" : "Navigation History";
  // text label, not an X: the per-entry X buttons mean "remove entry" — the
  // popup's own dismiss must not look like one of them
  const close = document.createElement("button");
  close.type = "button";
  close.className = "hist-close";
  close.textContent = "Close";
  close.addEventListener("click", () => histPop.hidePopover?.());
  head.append(heading, close);
  histPop.append(head);
  if (stack.length === 0) {
    const empty = document.createElement("div");
    empty.className = "muted";
    empty.textContent = "No tab history yet.";
    histPop.append(empty);
    return;
  }
  // newest on top; numbering counts from the oldest, so #1 sits at the bottom
  for (let index = stack.length - 1; index >= 0; index--) {
    const tab = byId.get(stack[index]);
    const row = document.createElement("button");
    row.type = "button";
    row.className = index === cursor ? "hist-row current" : "hist-row";

    const num = document.createElement("span");
    num.className = "hist-num muted";
    num.textContent = String(index + 1);

    const icon = document.createElement("span");
    icon.className = "favicon";
    if (tab?.url) icon.append(faviconImg(tab.url));

    const title = document.createElement("span");
    title.className = "hist-title";
    title.textContent = tab ? tab.title || tab.url : "(closed tab)";

    row.append(num, icon, title);
    if (dotColors.size > 0 && tab) {
      const dot = document.createElement("span");
      dot.className = "win-dot";
      const color = dotColors.get(tab.windowId);
      if (color) dot.style.background = color;
      else dot.classList.add("current");
      row.insertBefore(dot, icon);
    }
    row.addEventListener("click", () => {
      chrome.runtime.sendMessage({ type: "history-jump", index });
      histPop.hidePopover?.();
    });

    // per-entry remove; the tabHistory storage echo live-refreshes the open
    // popup, so indexes stay correct after each removal. Sibling of the row
    // button — buttons can't nest.
    const removeBtn = document.createElement("button");
    removeBtn.type = "button";
    removeBtn.className = "icon-btn hist-x";
    removeBtn.title = removeBtn.ariaLabel = "Remove from history";
    removeBtn.innerHTML = ICONS.close;
    removeBtn.addEventListener("click", () => {
      chrome.runtime.sendMessage({ type: "history-remove", index }).catch(() => {});
    });

    const item = document.createElement("div");
    item.className = "hist-item";
    item.append(row, removeBtn);
    histPop.append(item);
  }
}

// Browser back-button behavior: right-click OR long-press an arrow opens the
// history list. Both open on pointerup, never mid-gesture: the gesture's own
// remaining pointer events otherwise light-dismiss the popover the instant it
// shows. The hold timer only ARMS the long-press; release opens.
const LONG_PRESS_MS = 500;
let longPressTimer;
let longPressArmed = false;
// openness at gesture START: native light dismiss may close the popup on the
// pointerdown itself, so by pointerup it always reads closed — without this
// snapshot a right-click on an arrow would close-then-instantly-reopen
let popoverWasOpen = false;

// click fires right after the opening pointerup — swallow exactly one
function consumeLongPress() {
  const armed = longPressArmed;
  longPressArmed = false;
  return armed;
}

async function openHistoryPopover() {
  await fillHistoryPopover();
  try {
    histPop.showPopover?.();
  } catch {} // already open
}

for (const arrow of [histBack, histForward]) {
  arrow.addEventListener("contextmenu", (event) => event.preventDefault());
  arrow.addEventListener("pointerdown", (event) => {
    popoverWasOpen = isPopoverOpen(); // any button — before light dismiss races us
    if (event.button !== 0) {
      return;
    }
    longPressArmed = false;
    clearTimeout(longPressTimer);
    longPressTimer = setTimeout(() => (longPressArmed = true), LONG_PRESS_MS);
  });
  for (const type of ["pointerleave", "pointercancel"]) {
    arrow.addEventListener(type, () => clearTimeout(longPressTimer));
  }
  arrow.addEventListener("pointerup", async (event) => {
    clearTimeout(longPressTimer);
    if (event.button !== 2 && !(event.button === 0 && longPressArmed)) {
      return;
    }
    // toggle: popup was open when the gesture started → this gesture closes it
    if (popoverWasOpen) {
      try {
        histPop.hidePopover?.();
      } catch {} // light dismiss already closed it
      return;
    }
    await openHistoryPopover();
  });
}

syncHistoryButtons();
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "local" || !changes.tabHistory) {
    return;
  }
  syncHistoryButtons();
  // popover open (in THIS panel — every window's panel gets this event, so all
  // open popups converge on the same trail): live-refresh its rows
  if (isPopoverOpen()) {
    fillHistoryPopover();
  }
});

// ---------- panel-open tracking + restore banner ----------
// The held port tells the service worker THIS window has a panel; the SW
// persists that on the window's logical profile. On load we ask which OTHER
// windows had a panel before the update/restart and offer to reopen them —
// the banner click supplies the user gesture sidePanel.open() requires.

async function trackPanelOpen() {
  const win = await chrome.windows.getCurrent();
  const connect = () => {
    const port = chrome.runtime.connect({ name: `sidepanel:${win.id}` });
    // the worker gets idle-killed routinely — reconnect so the flag stays live
    port.onDisconnect.addListener(() => setTimeout(connect, 1000));
  };
  connect();
  return win.id;
}

trackPanelOpen().then(async (windowId) => {
  const response = await chrome.runtime
    .sendMessage({ type: "panels-to-restore", excludeWindowId: windowId })
    .catch(() => null);
  const windows = response?.windows ?? [];
  if (windows.length === 0) {
    return;
  }
  const { ui } = /** @type {Record<string, any>} */ (await chrome.storage.local.get("ui"));
  const mode = ui?.onExtensionUpdate ?? "banner";
  const forget = () =>
    chrome.runtime.sendMessage({ type: "panels-restore-dismiss", windowIds: windows }).catch(() => {});
  if (mode === "none") {
    forget(); // same as dismissing the banner — those windows aren't offered again
    return;
  }
  const reopenAll = async () => {
    let allOpened = true;
    for (const id of windows) {
      await chrome.sidePanel.open({ windowId: id }).catch(() => { allOpened = false; });
    }
    return allOpened;
  };
  // sidePanel.open() wants a user gesture; a fresh page has none, so "auto"
  // is best-effort — when Chrome refuses, fall through to the banner
  if (mode === "auto" && (await reopenAll())) {
    return;
  }
  const banner = getElementById("restore-banner");
  getElementById("restore-open").textContent =
    `Side panel was open in ${windows.length} other window${windows.length > 1 ? "s" : ""} — restore?`;
  getElementById("restore-open").addEventListener("click", async () => {
    await reopenAll();
    banner.hidden = true;
  });
  getElementById("restore-dismiss").addEventListener("click", () => {
    banner.hidden = true;
    forget();
  });
  banner.hidden = false;
});
