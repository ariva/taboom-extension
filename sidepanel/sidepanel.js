// Imperative shell: DOM + chrome.* effects only. All list/view logic lives in
// model.js as pure functions; this file feeds them state and applies the results.
import { hostnameOf, resolveColorScheme } from "../core/core.js";
import { loadState, saveState } from "../core/storage.js";
import {
  bulkSummary,
  countsByFilter,
  emptyMessage,
  groupHeader,
  rowViewModel,
  selectVisible,
  windowMaps,
} from "./model.js";

const searchInput = document.getElementById("search");
const filterBar = document.getElementById("filters");
const scopeSelect = document.getElementById("scope");
const sortSelect = document.getElementById("sort");
const listEl = document.getElementById("tab-list");
const bulkBar = document.getElementById("bulk-bar");
const bulkCount = document.getElementById("bulk-count");
const selectAllBox = document.getElementById("select-all");

// the single mutable state of the panel — handlers write here, render reads
const state = {
  query: "",
  filter: "all",
  scope: "all-windows",
  sort: "recent",
  ui: {},
  rules: [],
  allTabs: [],
  visible: [],
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
  render(animate);
}

// ---------- render ----------

const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)");

// animate=false for high-frequency renders (typing, cursor moves) where a
// view transition would add latency and caret flicker.
// VT snapshot cost scales with per-row view-transition-names, so big lists
// (1000-tab users) skip animation entirely — snappy beats pretty there.
const VT_MAX_ROWS = 100;

function render(animate = true) {
  state.visible = selectVisible(state.allTabs, { ...state, now: Date.now() });
  const heavy = Math.max(state.visible.length, listEl.childElementCount) > VT_MAX_ROWS;
  if (animate && !heavy && document.startViewTransition && !reducedMotion.matches) {
    document.startViewTransition(renderNow);
  } else {
    renderNow();
  }
}

function renderNow() {
  const byFilter = countsByFilter(state.allTabs, state.rules);
  for (const button of filterBar.querySelectorAll("button")) {
    const name = button.dataset.filter;
    button.querySelector(".count").textContent = byFilter[name];
    button.setAttribute("aria-pressed", String(name === state.filter));
  }

  listEl.classList.toggle("compact", state.ui.density === "compact");
  state.cursor = Math.min(state.cursor, state.visible.length - 1);
  listEl.textContent = "";
  if (state.visible.length === 0) {
    const empty = document.createElement("div");
    empty.className = "empty";
    empty.textContent = emptyMessage(state.query, state.filter);
    listEl.append(empty);
  }

  const maps = windowMaps(state.allTabs, state.currentWindowId);
  const now = Date.now();
  let prevWindowId;
  state.visible.forEach((tab, index) => {
    if (state.sort === "window" && tab.windowId !== prevWindowId) {
      prevWindowId = tab.windowId;
      const header = document.createElement("div");
      header.className = "group-header";
      header.textContent = groupHeader(tab.windowId, {
        visible: state.visible,
        tabs: state.allTabs,
        currentWindowId: state.currentWindowId,
        indexes: maps.indexes,
      });
      listEl.append(header);
    }
    const vm = rowViewModel(tab, {
      index,
      cursor: state.cursor,
      now,
      currentWindowId: state.currentWindowId,
      rules: state.rules,
      selected: state.selected,
      dotColors: maps.dotColors,
      indexes: maps.indexes,
    });
    listEl.append(renderRow(tab, vm));
  });

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

// translate a row view-model into DOM; wires event handlers to actions
function renderRow(tab, vm) {
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
    // Chrome's local favicon cache — no network request to the site
    const url = new URL(chrome.runtime.getURL("/_favicon/"));
    url.searchParams.set("pageUrl", vm.favicon.pageUrl);
    url.searchParams.set("size", "16");
    const img = document.createElement("img");
    img.src = url.toString();
    img.width = img.height = 16;
    img.addEventListener("error", () => img.remove());
    favicon.append(img);
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
    actionButton("protect", vm.protectLabel, () =>
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
  bulkBar.hidden = summary.hidden;
  bulkCount.textContent = summary.text;
  selectAllBox.checked = summary.allChecked;
  selectAllBox.indeterminate = summary.indeterminate;
  selectAllBox.title = summary.selectAllTitle;
}

// ---------- actions ----------

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
