import { formatAge, hostnameOf, isProtected, isSupportedUrl, matchesSearch } from "../core/core.js";
import { loadState, saveState } from "../core/storage.js";

const searchInput = document.getElementById("search");
const filterBar = document.getElementById("filters");
const scopeSelect = document.getElementById("scope");
const sortSelect = document.getElementById("sort");
const listEl = document.getElementById("tab-list");
const bulkBar = document.getElementById("bulk-bar");
const bulkCount = document.getElementById("bulk-count");
const selectAllBox = document.getElementById("select-all");

let state = { filter: "all", scope: "all-windows", sort: "recent", query: "" };
let uiPrefs = {};
let rules = [];
let allTabs = [];
let visible = [];
let selected = new Set();
let cursor = -1;
let currentWindowId = null;

// ---------- data ----------

async function refresh() {
  const [persisted, tabs, win] = await Promise.all([
    loadState(),
    chrome.tabs.query({}),
    chrome.windows.getLastFocused(),
  ]);
  rules = persisted.protectionRules;
  uiPrefs = persisted.ui;
  document.documentElement.style.fontSize = `${uiPrefs.fontSize ?? 1}rem`;
  currentWindowId = win.id;
  allTabs = tabs;
  render();
}

function filteredTabs() {
  const now = Date.now();
  let tabs = allTabs.filter((tab) => matchesSearch(tab, state.query));
  if (state.scope === "current-window") {
    tabs = tabs.filter((tab) => tab.windowId === currentWindowId);
  }
  switch (state.filter) {
    case "awake": tabs = tabs.filter((tab) => !tab.discarded); break;
    case "snoozed": tabs = tabs.filter((tab) => tab.discarded); break;
    case "protected": tabs = tabs.filter((tab) => isProtected(tab.url, rules)); break;
  }
  const last = (tab) => tab.lastAccessed ?? now;
  switch (state.sort) {
    case "recent": tabs.sort((a, b) => last(b) - last(a)); break;
    case "oldest": tabs.sort((a, b) => last(a) - last(b)); break;
    case "title": tabs.sort((a, b) => (a.title ?? "").localeCompare(b.title ?? "")); break;
    case "domain": tabs.sort((a, b) => hostnameOf(a.url).localeCompare(hostnameOf(b.url))); break;
  }
  return tabs;
}

function counts() {
  return {
    all: allTabs.length,
    awake: allTabs.filter((tab) => !tab.discarded).length,
    snoozed: allTabs.filter((tab) => tab.discarded).length,
    protected: allTabs.filter((tab) => isProtected(tab.url, rules)).length,
  };
}

// ---------- render ----------

const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)");

// animate=false for high-frequency renders (typing, cursor moves) where a
// view transition would add latency and caret flicker
function render(animate = true) {
  if (animate && document.startViewTransition && !reducedMotion.matches) {
    document.startViewTransition(renderNow);
  } else {
    renderNow();
  }
}

function renderNow() {
  const byFilter = counts();
  for (const button of filterBar.querySelectorAll("button")) {
    const name = button.dataset.filter;
    button.querySelector(".count").textContent = byFilter[name];
    button.setAttribute("aria-pressed", String(name === state.filter));
  }

  listEl.classList.toggle("compact", uiPrefs.density === "compact");
  visible = filteredTabs();
  cursor = Math.min(cursor, visible.length - 1);
  listEl.textContent = "";
  if (visible.length === 0) {
    const empty = document.createElement("div");
    empty.className = "empty";
    empty.textContent = state.query
      ? "No tabs match — press Esc to clear the search."
      : state.filter === "snoozed"
        ? "Nothing snoozed yet. Hover a tab and use the pause button."
        : state.filter === "protected"
          ? "No protected tabs. Use the shield button on a tab to protect its site."
          : "No open tabs.";
    listEl.append(empty);
  }
  const now = Date.now();
  visible.forEach((tab, index) => listEl.append(renderRow(tab, index, now)));
  renderBulkBar();
}

function renderRow(tab, index, now) {
  const row = document.createElement("div");
  row.className = "row" + (index === cursor ? " cursor" : "");
  if (tab.discarded) row.classList.add("snoozed");
  if (tab.active) row.classList.add("active-tab");
  row.setAttribute("role", "option");
  row.style.viewTransitionName = `tab-${tab.id}`;

  const checkbox = document.createElement("input");
  checkbox.type = "checkbox";
  checkbox.checked = selected.has(tab.id);
  checkbox.ariaLabel = "Select tab";
  checkbox.addEventListener("click", (event) => {
    event.stopPropagation();
    checkbox.checked ? selected.add(tab.id) : selected.delete(tab.id);
    renderBulkBar();
  });

  const favicon = document.createElement("span");
  favicon.className = "favicon";
  if (isSupportedUrl(tab.url)) {
    // Chrome's local favicon cache — no network request to the site
    const url = new URL(chrome.runtime.getURL("/_favicon/"));
    url.searchParams.set("pageUrl", tab.url);
    url.searchParams.set("size", "16");
    const img = document.createElement("img");
    img.src = url.toString();
    img.width = img.height = 16;
    img.addEventListener("error", () => img.remove());
    favicon.append(img);
  } else {
    favicon.textContent = (hostnameOf(tab.url)[0] ?? "•").toUpperCase();
  }

  const main = document.createElement("div");
  main.className = "main";
  const title = document.createElement("div");
  title.className = "title";
  title.textContent = (tab.discarded ? "⏸ " : "") + (tab.title || tab.url || "(untitled)");
  const meta = document.createElement("div");
  meta.className = "meta";
  const host = document.createElement("span");
  host.className = "host";
  host.textContent = hostnameOf(tab.url) || tab.url || "";
  meta.append(host);
  if (!tab.active && tab.lastAccessed) {
    const age = document.createElement("span");
    age.textContent = formatAge(now - tab.lastAccessed);
    meta.append(age);
  }
  for (const [label, kind] of badges(tab)) {
    const badge = document.createElement("span");
    badge.className = kind ? `badge ${kind}` : "badge";
    badge.textContent = label;
    meta.append(badge);
  }
  main.append(title, meta);

  const actions = document.createElement("div");
  actions.className = "actions";
  if (!tab.discarded && isSupportedUrl(tab.url)) {
    actions.append(actionButton("snooze", "Snooze", () => snooze([tab.id])));
  }
  const tabProtected = isProtected(tab.url, rules);
  actions.append(
    actionButton("protect", tabProtected ? "Unprotect site" : "Protect site", () =>
      chrome.runtime.sendMessage({ type: "toggle-site-protection", tabId: tab.id }),
    ),
    actionButton("close", "Close", () => closeTabs([tab.id])),
  );

  row.append(checkbox, favicon, main, actions);
  row.addEventListener("click", () => activate(tab));
  return row;
}

function badges(tab) {
  const list = [];
  if (tab.discarded) list.push(["snoozed", "warn"]);
  if (isProtected(tab.url, rules)) list.push(["protected", "ok"]);
  if (tab.pinned) list.push(["pinned", ""]);
  if (tab.audible) list.push(["🔊", ""]);
  return list;
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
  bulkBar.hidden = selected.size === 0;
  bulkCount.textContent = `${selected.size} selected`;
  const selectedVisible = visible.filter((tab) => selected.has(tab.id)).length;
  selectAllBox.checked = visible.length > 0 && selectedVisible === visible.length;
  selectAllBox.indeterminate = selectedVisible > 0 && selectedVisible < visible.length;
  selectAllBox.title = selectAllBox.checked ? "Unselect all" : `Select all ${visible.length} shown`;
}

// ---------- actions ----------

async function activate(tab) {
  await chrome.windows.update(tab.windowId, { focused: true });
  await chrome.tabs.update(tab.id, { active: true });
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
  selected.clear();
  refresh();
}

async function closeTabs(tabIds) {
  // Native confirm for multi-close; upgrade to undo snackbar if it annoys
  if (tabIds.length > 1 && !confirm(`Close ${tabIds.length} tabs?`)) return;
  try {
    await chrome.tabs.remove(tabIds);
  } catch (error) {
    console.debug("close failed", error);
  }
  selected.clear();
  refresh();
}

async function protectSelected() {
  const hosts = [...selected]
    .map((tabId) => allTabs.find((tab) => tab.id === tabId))
    .filter(Boolean)
    .map((tab) => hostnameOf(tab.url))
    .filter(Boolean);
  await chrome.runtime.sendMessage({ type: "protect-hosts", hosts: [...new Set(hosts)] });
  selected.clear();
  refresh();
}

// ---------- events ----------

searchInput.addEventListener("input", () => {
  state.query = searchInput.value;
  cursor = state.query ? 0 : -1;
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
    ui: { ...uiPrefs, defaultFilter: state.filter, scope: state.scope, sort: state.sort },
  });
}

// Select/unselect everything currently visible (i.e. matching search + filter).
selectAllBox.addEventListener("change", () => {
  if (selectAllBox.checked) {
    for (const tab of visible) selected.add(tab.id);
  } else {
    for (const tab of visible) selected.delete(tab.id);
  }
  render(false);
});

document.getElementById("settings-btn").addEventListener("click", () => {
  chrome.runtime.openOptionsPage();
});

document.getElementById("bulk-snooze").addEventListener("click", () => snooze([...selected]));
document.getElementById("bulk-protect").addEventListener("click", protectSelected);
document.getElementById("bulk-close").addEventListener("click", () => closeTabs([...selected]));
document.getElementById("bulk-clear").addEventListener("click", () => {
  selected.clear();
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
    if (visible.length === 0) return;
    cursor = event.key === "ArrowDown"
      ? Math.min(cursor + 1, visible.length - 1)
      : Math.max(cursor - 1, 0);
    render(false);
    listEl.querySelector(".cursor")?.scrollIntoView({ block: "nearest" });
    return;
  }
  if (event.key === "Enter" && cursor >= 0 && visible[cursor]) {
    activate(visible[cursor]);
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
