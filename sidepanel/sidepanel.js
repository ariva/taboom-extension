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
import { getElementById } from "../core/dom.js";
import { loadFeatures, loadState, saveState } from "../core/storage.js";
import {
  bulkSummary,
  countsByFilter,
  deriveTabs,
  emptyMessage,
  searchCandidates,
  groupByWindow,
  groupHeader,
  rowViewModel,
  selectVisible,
  windowMaps,
} from "./model.js";

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

const FOLD_ICONS = {
  fold: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 3l4 4 4-4M4 9l4 4 4-4"/></svg>',
  unfold: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7l4-4 4 4M4 13l4-4 4 4"/></svg>',
};

// the single mutable state of the panel — handlers write here, render reads
const state = {
  query: "",
  filter: "all",
  scope: "all-windows",
  sort: "recent",
  ui: {},
  rules: [],
  features: FEATURES, // experimental-resolved copy, refreshed in refresh()
  navMode: "off", // "off" | "compact" | "traditional" — resolved in refresh()
  allTabs: [],
  derived: new Map(), // per-tab {host, haystack, protected} — rebuilt each refresh
  visible: [], // rows the user can interact with (excludes collapsed groups)
  fullVisible: [], // before collapsing — header counts + empty-state check
  collapsedWindows: new Set(), // windowIds collapsed in group-by-window view (session only)
  selected: new Set(),
  cursor: -1,
  currentWindowId: null,
  // after activating, the tab jumps in the list (top in recent/window sorts) —
  // follow it on the next event-driven re-render so it doesn't vanish off-screen
  followCurrent: false,
  pendingScroll: null, // scrollTop to apply after the next render (filter/search switches)
};

// ---------- data ----------

// animate only for user-initiated refreshes; background event echoes
// (tab/storage/focus changes — incl. renders triggered in OTHER open panels)
// re-render without a view transition
async function refresh(animate = false, preloaded = null) {
  const [persisted, tabs, win] = await Promise.all([
    preloaded ?? loadState(), // startup passes its already-read state — no second read
    chrome.tabs.query({}),
    chrome.windows.getLastFocused(),
  ]);
  state.rules = persisted.protectionRules;
  state.ui = persisted.ui;
  document.documentElement.style.fontSize = `${state.ui.fontSize ?? 1}rem`;
  // light-dark() colors resolve via color-scheme, so forcing it flips the palette
  document.documentElement.style.colorScheme = resolveColorScheme(state.ui.theme);
  state.currentWindowId = win.id;
  state.allTabs = tabs;
  state.derived = deriveTabs(tabs, state.rules);
  // resolved once per refresh; the keydown handler reads this instead of
  // re-running applyExperimental (a fresh object) on every keypress
  state.features = applyExperimental(FEATURES, state.ui.showExperimental ?? false);
  // flag turned off mid-navigation: drop the cursor so no stale outline lingers
  if (!featureEnabled(state.features, "SIDEBAR_KEYBOARD_NAVIGATION")) {
    state.cursor = -1;
  }
  state.navMode = resolveNavMode(state.features, state.ui);
  getElementById("hist-back").hidden = state.navMode === "off";
  getElementById("hist-forward").hidden = state.navMode === "off";
  getElementById("hist-list-btn").hidden = !featureEnabled(state.features, "NAVIGATION_DROPDOWN");
  render(animate);
}

// ---------- render ----------

const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)");

// animate=false for high-frequency renders (typing, cursor moves) where a
// view transition would add latency and caret flicker.
// VT snapshot cost scales with per-row view-transition-names, so big lists
// (1000-tab users) skip animation entirely — snappy beats pretty there.
const VT_MAX_ROWS = 100;

// an active search auto-expands: matches must never hide under a collapsed group
function effectiveCollapsed() {
  return state.sort === "window" && !state.query ? state.collapsedWindows : new Set();
}

function render(animate = true) {
  state.fullVisible = selectVisible(state.allTabs, { ...state, now: Date.now() });
  const collapsed = effectiveCollapsed();
  state.visible = state.fullVisible.filter((tab) => !collapsed.has(tab.windowId));
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

  const maps = windowMaps(state.allTabs, state.currentWindowId);
  const now = Date.now();
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
    });

  let foldableGroups = [];
  let anythingToFold = false;
  if (state.sort === "window") {
    const collapsed = effectiveCollapsed();
    const groups = groupByWindow(state.fullVisible);
    const collapsible = groups.length > 1; // lone window: nothing to fold away
    anythingToFold = collapsible;
    if (collapsible && !state.query) foldableGroups = groups;
    // per-window totals in one pass (visible count = the group's own length)
    const totals = new Map();
    for (const tab of state.allTabs) {
      totals.set(tab.windowId, (totals.get(tab.windowId) ?? 0) + 1);
    }
    let index = 0;
    for (const [windowId, groupTabs] of groups) {
      const isCollapsed = collapsible && collapsed.has(windowId);
      frag.append(renderGroupHeader(windowId, {
        isCollapsed,
        indexes: maps.indexes,
        collapsible,
        count: groupTabs.length,
        total: totals.get(windowId) ?? 0,
        tabs: groupTabs,
        dotColors: maps.dotColors,
      }));
      if (isCollapsed) continue;
      for (const tab of groupTabs) frag.append(renderRow(tab, rowVm(tab, index++)));
    }
  } else {
    state.visible.forEach((tab, index) => frag.append(renderRow(tab, rowVm(tab, index))));
  }
  listEl.replaceChildren(frag);
  syncRowHeight();
  renderCollapseAllButton(foldableGroups, anythingToFold);

  if (state.pendingScroll != null) {
    listEl.scrollTop = state.pendingScroll;
    state.pendingScroll = null;
  }

  if (state.followCurrent) {
    state.followCurrent = false;
    const current = listEl.querySelector(".row.current");
    // topmost row → scroll fully to top so headers/padding show; else just reveal it
    if (current === listEl.querySelector(".row")) {
      listEl.scrollTop = 0;
    } else {
      current?.scrollIntoView({ block: "nearest" });
    }
  }
  renderBulkBar();
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
  collapseAllBtn.hidden = state.sort !== "window" || !anythingToFold;
  if (collapseAllBtn.hidden) return;
  collapseAllBtn.disabled = groups.length === 0;
  const allCollapsed =
    groups.length > 0 && groups.every(([windowId]) => state.collapsedWindows.has(windowId));
  collapseAllBtn.innerHTML = allCollapsed ? FOLD_ICONS.unfold : FOLD_ICONS.fold;
  collapseAllBtn.title = collapseAllBtn.ariaLabel = allCollapsed ? "Expand all" : "Collapse all";
  collapseAllBtn.dataset.groups = JSON.stringify(groups.map(([windowId]) => windowId));
}

collapseAllBtn.addEventListener("click", () => {
  const windowIds = JSON.parse(collapseAllBtn.dataset.groups ?? "[]");
  const allCollapsed = windowIds.every((id) => state.collapsedWindows.has(id));
  if (allCollapsed) {
    state.collapsedWindows.clear();
  } else {
    for (const id of windowIds) state.collapsedWindows.add(id);
  }
  render();
});

// clickable group header: toggles collapse of that window's rows
function renderGroupHeader(windowId, { isCollapsed, indexes, collapsible, count, total, tabs, dotColors }) {
  const header = document.createElement("div");
  header.className = "group-header";
  // WINDOW_GROUP_SELECT: checkbox left of the window label selects/unselects
  // every tab of this window that the current filter/search shows
  if (featureEnabled(state.features, "WINDOW_GROUP_SELECT")) {
    const box = document.createElement("input");
    box.type = "checkbox";
    box.className = "group-select";
    const selectedCount = tabs.filter((tab) => state.selected.has(tab.id)).length;
    box.checked = tabs.length > 0 && selectedCount === tabs.length;
    box.indeterminate = selectedCount > 0 && selectedCount < tabs.length;
    box.title = box.ariaLabel = box.checked ? "Unselect window tabs" : "Select window tabs";
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
  // same per-window color dot the rows carry (accent for the current window)
  if (dotColors.size > 0) {
    const dot = document.createElement("span");
    dot.className = "win-dot";
    const color = dotColors.get(windowId);
    if (color) {
      dot.style.background = color;
    } else {
      dot.classList.add("current");
    }
    header.append(dot);
  }
  const label = document.createElement("span");
  label.className = "group-label";
  label.textContent = groupHeader(windowId, {
    count,
    total,
    currentWindowId: state.currentWindowId,
    indexes,
  });
  header.append(label);
  if (!collapsible) {
    header.classList.add("static");
    return header;
  }
  // collapse chevron right-aligned (accordion layout) — far from the
  // group-select checkbox on the left so the two targets can't be confused
  const arrow = document.createElement("span");
  arrow.className = "fold-arrow";
  arrow.textContent = isCollapsed ? "▸" : "▾";
  header.append(arrow);
  header.setAttribute("role", "button");
  header.tabIndex = 0;
  header.title = isCollapsed ? "Expand" : "Collapse";
  const toggle = () => {
    if (state.query) return; // search shows everything; collapse resumes after
    state.collapsedWindows.has(windowId)
      ? state.collapsedWindows.delete(windowId)
      : state.collapsedWindows.add(windowId);
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

function renderRowImpl(tab, vm) {
  const row = /** @type {HTMLElement} */ (ROW_TEMPLATE.content.firstElementChild.cloneNode(true));
  row.className = vm.classes.join(" ");
  row.style.viewTransitionName = vm.viewTransitionName;
  row.dataset.tabId = String(tab.id);

  /** @type {HTMLInputElement} */ (row.querySelector("input")).checked = vm.checked;

  const dot = /** @type {HTMLElement} */ (row.querySelector(".win-dot"));
  if (vm.dot) {
    if (vm.dot.color) {
      dot.style.background = vm.dot.color;
    } else {
      dot.classList.add("current");
    }
    dot.title = vm.dot.title;
  } else {
    dot.remove();
  }

  const favicon = row.querySelector(".favicon");
  if (vm.favicon.pageUrl) {
    favicon.append(faviconImg(vm.favicon.pageUrl));
  } else {
    favicon.textContent = vm.favicon.letter;
  }

  row.querySelector(".title").textContent = vm.title;
  row.querySelector(".host").textContent = vm.host;
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

// One delegated click listener instead of ~6 listeners per row — with big
// lists that's thousands of listener allocations saved on every render.
listEl.addEventListener("click", (event) => {
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
    renderBulkBar();
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

async function snooze(tabIds) {
  const failures = [];
  for (const tabId of tabIds) {
    const response = await chrome.runtime.sendMessage({ type: "snooze-tab", tabId });
    if (response?.error) failures.push(response.error);
  }
  if (failures.length > 0) {
    toast(`Could not snooze ${failures.length} tab(s): ${failures[0]}`);
  }
  state.selected.clear();
  refresh(true);
}

// background reload of snoozed tabs — wakes without switching to them;
// non-discarded tabs are skipped so a mixed selection never force-reloads live pages
async function wake(tabIds) {
  const snoozed = tabIds.filter(
    (tabId) => state.allTabs.find((tab) => tab.id === tabId)?.discarded,
  );
  await Promise.all(snoozed.map((tabId) => chrome.tabs.reload(tabId).catch(() => {})));
  state.selected.clear();
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
  state.selected.clear();
  refresh(true);
}

async function protectSelected() {
  const hosts = [...state.selected]
    .map((tabId) => state.allTabs.find((tab) => tab.id === tabId))
    .filter(Boolean)
    .map((tab) => hostnameOf(tab.url))
    .filter(Boolean);
  await chrome.runtime.sendMessage({ type: "protect-hosts", hosts: [...new Set(hosts)] });
  state.selected.clear();
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
  }
  if (!value) {
    searchScrollByFilter.clear(); // search over — in-results positions are stale
  }
  state.query = value;
  // search narrowed the current filter to nothing while matches exist elsewhere:
  // auto-select All so the results aren't hidden behind the filter (not
  // persisted — the user didn't choose it)
  if (value && state.filter !== "all" && featureEnabled(state.features, "SEARCH_AUTO_SELECT_ALL")) {
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
  resetScrollPositions();
  persistUiPrefs();
  render(!state.query);
});

// JSON of the ui object this panel just persisted — its storage echo is skipped
// (the click handler already rendered that state; without this every filter/
// scope/sort click renders twice and re-queries all tabs 150ms later)
let lastOwnUiWrite = null;

function persistUiPrefs() {
  const ui = { ...state.ui, defaultFilter: state.filter, scope: state.scope, sort: state.sort };
  state.ui = ui;
  lastOwnUiWrite = JSON.stringify(ui);
  saveState({ ui });
}

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
getElementById("bulk-protect").addEventListener("click", protectSelected);
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
  const ignored = ["perfMetrics", "perfSnapshots", "tabHistory"];
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
  scopeSelect.value = state.scope;
  sortSelect.value = state.sort;
  refresh(false, persisted); // search input focuses itself via the autofocus attribute
});

// ---------- update notice ----------

// reload() applies the deferred update (an open panel blocks auto-install)
const updateBanner = getElementById("update-banner");
updateBanner.addEventListener("click", () => chrome.runtime.reload());
async function syncUpdateBanner() {
  const { updateAvailable } = await chrome.storage.local.get("updateAvailable");
  if (updateAvailable) updateBanner.textContent = `Update ${updateAvailable} ready — restart Taboom`;
  updateBanner.hidden = !updateAvailable;
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
  const { dotColors } = windowMaps(allTabs, state.currentWindowId);
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
