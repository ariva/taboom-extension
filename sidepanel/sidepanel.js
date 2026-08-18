// Imperative shell: DOM + chrome.* effects only. All list/view logic lives in
// model.js as pure functions; this file feeds them state and applies the results.
import {
  applyExperimental,
  featureEnabled,
  hostnameOf,
  recordMetric,
  resolveColorScheme,
} from "../core/core.js";
import { loadFeatures, loadState, saveState } from "../core/storage.js";
import {
  bulkSummary,
  countsByFilter,
  emptyMessage,
  groupByWindow,
  groupHeader,
  rowViewModel,
  selectVisible,
  windowMaps,
} from "./model.js";

const FEATURES = await loadFeatures();

// ---------- performance metrics (PERFORMANCE flag) ----------

const perfBuffer = [];

function perfMeasure(key, fn) {
  if (!featureEnabled(FEATURES, "PERFORMANCE")) return fn();
  const start = performance.now();
  const result = fn();
  perfBuffer.push([key, performance.now() - start]);
  return result;
}

// buffered: a write per render would re-trigger our own storage listener each time
// (ponytail: the 10s flush still echoes one extra render per interval — fine at this rate)
async function flushPerfMetrics() {
  if (perfBuffer.length === 0) return;
  const samples = perfBuffer.splice(0);
  const { perfMetrics = {} } = await chrome.storage.local.get("perfMetrics");
  await chrome.storage.local.set({
    perfMetrics: samples.reduce((m, [key, ms]) => recordMetric(m, key, ms), perfMetrics),
  });
}
setInterval(flushPerfMetrics, 10_000).unref?.(); // unref: don't hold the node test process open
globalThis.addEventListener?.("pagehide", flushPerfMetrics);

const searchInput = document.getElementById("search");
const filterBar = document.getElementById("filters");
const scopeSelect = document.getElementById("scope");
const sortSelect = document.getElementById("sort");
const listEl = document.getElementById("tab-list");
const bulkBar = document.getElementById("bulk-bar");
const bulkCount = document.getElementById("bulk-count");
const selectAllBox = document.getElementById("select-all");
const collapseAllBtn = document.getElementById("collapse-all");

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
  allTabs: [],
  visible: [], // rows the user can interact with (excludes collapsed groups)
  fullVisible: [], // before collapsing — header counts + empty-state check
  collapsedWindows: new Set(), // windowIds collapsed in group-by-window view (session only)
  selected: new Set(),
  cursor: -1,
  currentWindowId: null,
  // after activating, the tab jumps in the list (top in recent/window sorts) —
  // follow it on the next event-driven re-render so it doesn't vanish off-screen
  followCurrent: false,
};

// ---------- data ----------

// animate only for user-initiated refreshes; background event echoes
// (tab/storage/focus changes — incl. renders triggered in OTHER open panels)
// re-render without a view transition
async function refresh(animate = false) {
  const [persisted, tabs, win] = await Promise.all([
    loadState(),
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
  const features = applyExperimental(FEATURES, state.ui.showExperimental ?? false);
  const historyNav = featureEnabled(features, "NAVIGATION_STACK") && (state.ui.historyNav ?? true);
  document.getElementById("hist-back").hidden = !historyNav;
  document.getElementById("hist-forward").hidden = !historyNav;
  document.getElementById("hist-list-btn").hidden = !featureEnabled(features, "NAVIGATION_DROPDOWN");
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
  const byFilter = countsByFilter(state.allTabs, state.rules);
  for (const button of filterBar.querySelectorAll("button")) {
    const name = button.dataset.filter;
    button.querySelector(".count").textContent = byFilter[name];
    button.setAttribute("aria-pressed", String(name === state.filter));
  }

  listEl.classList.toggle("compact", state.ui.density === "compact");
  state.cursor = Math.min(state.cursor, state.visible.length - 1);
  listEl.textContent = "";
  if (state.fullVisible.length === 0) {
    const empty = document.createElement("div");
    empty.className = "empty";
    empty.textContent = emptyMessage(state.query, state.filter);
    listEl.append(empty);
  }

  const maps = windowMaps(state.allTabs, state.currentWindowId);
  const now = Date.now();
  const rowVm = (tab, index) =>
    rowViewModel(tab, {
      index,
      cursor: state.cursor,
      now,
      currentWindowId: state.currentWindowId,
      rules: state.rules,
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
    let index = 0;
    for (const [windowId, groupTabs] of groups) {
      const isCollapsed = collapsible && collapsed.has(windowId);
      listEl.append(renderGroupHeader(windowId, isCollapsed, maps.indexes, collapsible));
      if (isCollapsed) continue;
      for (const tab of groupTabs) listEl.append(renderRow(tab, rowVm(tab, index++)));
    }
  } else {
    state.visible.forEach((tab, index) => listEl.append(renderRow(tab, rowVm(tab, index))));
  }
  renderCollapseAllButton(foldableGroups, anythingToFold);

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
function renderGroupHeader(windowId, isCollapsed, indexes, collapsible) {
  const header = document.createElement("div");
  header.className = "group-header";
  header.textContent = groupHeader(windowId, {
    visible: state.fullVisible,
    tabs: state.allTabs,
    currentWindowId: state.currentWindowId,
    indexes,
    collapsed: isCollapsed,
    collapsible,
  });
  if (!collapsible) {
    header.classList.add("static");
    return header;
  }
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
  return perfMeasure("sidepanel.renderRow", () => renderRowImpl(tab, vm));
}

function renderRowImpl(tab, vm) {
  const row = document.createElement("div");
  row.className = vm.classes.join(" ");
  row.setAttribute("role", "option");
  row.style.viewTransitionName = vm.viewTransitionName;

  const checkbox = document.createElement("input");
  checkbox.type = "checkbox";
  checkbox.checked = vm.checked;
  checkbox.ariaLabel = "Select tab";
  checkbox.addEventListener("click", (event) => {
    event.stopPropagation();
    checkbox.checked ? state.selected.add(tab.id) : state.selected.delete(tab.id);
    renderBulkBar();
  });

  const favicon = document.createElement("span");
  favicon.className = "favicon";
  if (vm.favicon.pageUrl) {
    favicon.append(faviconImg(vm.favicon.pageUrl));
  } else {
    favicon.textContent = vm.favicon.letter;
  }

  const main = document.createElement("div");
  main.className = "main";
  const title = document.createElement("div");
  title.className = "title";
  title.textContent = vm.title;
  const meta = document.createElement("div");
  meta.className = "meta";
  const host = document.createElement("span");
  host.className = "host";
  host.textContent = vm.host;
  meta.append(host);
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
  main.append(title, meta);

  const actions = document.createElement("div");
  actions.className = "actions";
  if (vm.canSnooze) {
    actions.append(actionButton("snooze", "Snooze", () => snooze([tab.id])));
  }
  actions.append(
    actionButton(vm.protected ? "unprotect" : "protect", vm.protectLabel, () =>
      chrome.runtime.sendMessage({ type: "toggle-site-protection", tabId: tab.id }),
    ),
    actionButton("close", "Close", () => closeTabs([tab.id])),
  );

  if (vm.dot) {
    const dot = document.createElement("span");
    dot.className = "win-dot";
    if (vm.dot.color) dot.style.background = vm.dot.color;
    else dot.classList.add("current");
    dot.title = vm.dot.title;
    row.append(checkbox, dot, favicon, main, actions);
  } else {
    row.append(checkbox, favicon, main, actions);
  }
  row.addEventListener("click", () => activate(tab));
  return row;
}

// inline SVGs: unicode glyphs (⏸ 🛡 ✕) render at wildly different sizes/baselines per platform
const ICONS = {
  snooze: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M6 3v10M10 3v10"/></svg>',
  protect: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"><path d="M8 1.8 13.2 3.7V8c0 3.2-2.3 5.1-5.2 6.2C5.1 13.1 2.8 11.2 2.8 8V3.7Z"/></svg>',
  unprotect: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"><path d="M8 1.8 13.2 3.7V8c0 3.2-2.3 5.1-5.2 6.2C5.1 13.1 2.8 11.2 2.8 8V3.7Z"/><path stroke-linecap="round" d="M3 2.5l10 11"/></svg>',
  close: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M4 4l8 8M12 4l-8 8"/></svg>',
};

function actionButton(icon, label, onClick) {
  const button = document.createElement("button");
  button.innerHTML = ICONS[icon];
  button.title = label;
  button.ariaLabel = label;
  button.addEventListener("click", (event) => {
    event.stopPropagation();
    onClick();
  });
  return button;
}

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
  const el = document.getElementById("toast");
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

searchInput.addEventListener("input", () => {
  state.query = searchInput.value;
  state.cursor = state.query ? 0 : -1;
  render(false);
});

filterBar.addEventListener("click", (event) => {
  const button = event.target.closest("button[data-filter]");
  if (!button) return;
  state.filter = button.dataset.filter;
  persistUiPrefs();
  render();
});

scopeSelect.addEventListener("change", () => {
  state.scope = scopeSelect.value;
  persistUiPrefs();
  render();
});

sortSelect.addEventListener("change", () => {
  state.sort = sortSelect.value;
  persistUiPrefs();
  render();
});

function persistUiPrefs() {
  saveState({
    ui: { ...state.ui, defaultFilter: state.filter, scope: state.scope, sort: state.sort },
  });
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

document.getElementById("settings-btn").addEventListener("click", () => {
  chrome.runtime.openOptionsPage();
});

document.getElementById("bulk-snooze").addEventListener("click", () => snooze([...state.selected]));
document.getElementById("bulk-wake").addEventListener("click", () => wake([...state.selected]));
document.getElementById("bulk-protect").addEventListener("click", protectSelected);
document.getElementById("bulk-close").addEventListener("click", () => closeTabs([...state.selected]));
document.getElementById("bulk-clear").addEventListener("click", () => {
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
    searchInput.value = "";
    state.query = "";
    render(false);
    searchInput.focus();
    return;
  }
  if (event.key === "ArrowDown" || event.key === "ArrowUp") {
    event.preventDefault();
    if (state.visible.length === 0) return;
    state.cursor = event.key === "ArrowDown"
      ? Math.min(state.cursor + 1, state.visible.length - 1)
      : Math.max(state.cursor - 1, 0);
    render(false);
    listEl.querySelector(".cursor")?.scrollIntoView({ block: "nearest" });
    return;
  }
  if (event.key === "Enter" && state.cursor >= 0 && state.visible[state.cursor]) {
    activate(state.visible[state.cursor]);
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
  chrome.tabs.onUpdated,
  chrome.tabs.onActivated,
  chrome.tabs.onRemoved,
  chrome.tabs.onMoved,
  chrome.tabs.onAttached,
  chrome.tabs.onDetached,
  chrome.windows.onFocusChanged,
  chrome.storage.onChanged,
]) {
  event.addListener(scheduleRefresh);
}

// ---------- init ----------

loadState().then((persisted) => {
  state.filter = persisted.ui.defaultFilter;
  state.scope = persisted.ui.scope;
  state.sort = persisted.ui.sort;
  scopeSelect.value = state.scope;
  sortSelect.value = state.sort;
  refresh();
  searchInput.focus();
});

// ---------- update notice ----------

// reload() applies the deferred update (an open panel blocks auto-install)
const updateBanner = document.getElementById("update-banner");
updateBanner.addEventListener("click", () => chrome.runtime.reload());
async function syncUpdateBanner() {
  const { updateAvailable } = await chrome.storage.local.get("updateAvailable");
  if (updateAvailable) updateBanner.textContent = `Update ${updateAvailable} ready — restart Taboom`;
  updateBanner.hidden = !updateAvailable;
}
syncUpdateBanner();
chrome.storage.onChanged.addListener(syncUpdateBanner);

// ---------- tab history nav (back / forward across tabs) ----------

const histBack = document.getElementById("hist-back");
const histForward = document.getElementById("hist-forward");
const histPop = document.getElementById("history-pop");

histBack.addEventListener("click", () => chrome.runtime.sendMessage({ type: "history-back" }));
histForward.addEventListener("click", () => chrome.runtime.sendMessage({ type: "history-forward" }));

async function getTabHistory() {
  const { tabHistory } = await chrome.storage.local.get("tabHistory");
  return tabHistory ?? { stack: [], cursor: -1 };
}

async function syncHistoryButtons() {
  const { stack, cursor } = await getTabHistory();
  histBack.disabled = cursor <= 0;
  histForward.disabled = cursor >= stack.length - 1;
}

// populate on open (popovertarget handles show/hide natively)
document.getElementById("hist-list-btn").addEventListener("click", fillHistoryPopover);

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
  heading.textContent = "Navigation stack";
  const close = document.createElement("button");
  close.className = "icon-btn";
  close.title = close.ariaLabel = "Close";
  close.innerHTML = ICONS.close;
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
    num.textContent = index + 1;

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
    histPop.append(row);
  }
}

// browser back-button behavior: right-click an arrow opens the history list.
// Open on pointerup, not on contextmenu: the gesture's own pointer events
// otherwise light-dismiss the popover the instant it shows.
for (const arrow of [histBack, histForward]) {
  arrow.addEventListener("contextmenu", (event) => event.preventDefault());
  arrow.addEventListener("pointerup", async (event) => {
    if (event.button !== 2) return;
    await fillHistoryPopover();
    try {
      histPop.showPopover?.();
    } catch {} // already open
  });
}

syncHistoryButtons();
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && changes.tabHistory) syncHistoryButtons();
});
