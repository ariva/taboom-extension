import {
  applyExperimental,
  featureEnabled,
  filterHistory,
  hostnameOf,
  isProtected,
  isSupportedUrl,
  makeRule,
  matchesRule,
  pushHistory,
  removeFromHistory,
  selectAutoSnoozeTargets,
} from "../core/core.js";
import { loadFeatures, loadState, saveState } from "../core/storage.js";

const ALARM_NAME = "auto-snooze";

// ---------- lifecycle ----------

chrome.runtime.onInstalled.addListener(init);
chrome.runtime.onStartup.addListener(init);

async function init() {
  const state = await loadState();
  await saveState(state); // persist defaults on first run
  await ensureAlarm(state.settings);
  await applyAutoDiscardable(state.protectionRules);
  await createContextMenus();
  await chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
  await chrome.storage.local.remove("updateAvailable"); // running the new version now
  // history persists across extension reloads — just prune tabs that vanished meanwhile
  const openIds = new Set((await chrome.tabs.query({})).map((tab) => tab.id));
  await chrome.storage.local.set({
    tabHistory: filterHistory(await loadHistory(), (id) => openIds.has(id)),
  });
}

// An open side panel keeps the extension non-idle, deferring auto-update forever;
// surface the pending version so the panel can offer a restart.
chrome.runtime.onUpdateAvailable.addListener(({ version }) => {
  chrome.storage.local.set({ updateAvailable: version });
});

async function ensureAlarm(settings) {
  await chrome.alarms.create(ALARM_NAME, {
    periodInMinutes: Math.max(1, settings.checkIntervalMinutes),
  });
}

// ---------- auto snooze ----------

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === ALARM_NAME) autoSnoozePass();
});

async function autoSnoozePass() {
  const state = await loadState();
  if (!state.settings.autoSnoozeEnabled) return;
  const tabs = await chrome.tabs.query({});
  for (const tabId of selectAutoSnoozeTargets(tabs, state.settings, state.protectionRules)) {
    try {
      await chrome.tabs.discard(tabId);
    } catch (error) {
      console.debug("discard failed", tabId, error);
    }
  }
}

// ---------- protection ----------

async function applyAutoDiscardable(rules) {
  const tabs = await chrome.tabs.query({});
  for (const tab of tabs) {
    if (!tab.id || !isSupportedUrl(tab.url)) continue;
    const wanted = !isProtected(tab.url, rules);
    if (tab.autoDiscardable !== wanted) {
      try {
        await chrome.tabs.update(tab.id, { autoDiscardable: wanted });
      } catch (error) {
        console.debug("autoDiscardable update failed", tab.id, error);
      }
    }
  }
}

async function toggleSiteProtection(tab) {
  const host = hostnameOf(tab.url);
  if (!host) return { protected: false };
  const state = await loadState();
  const existing = state.protectionRules.filter((rule) => matchesRule(host, rule));
  let rules;
  if (existing.length > 0) {
    const removeIds = new Set(existing.map((rule) => rule.id));
    rules = state.protectionRules.filter((rule) => !removeIds.has(rule.id));
  } else {
    rules = [...state.protectionRules, makeRule(host)];
  }
  await saveState({ protectionRules: rules });
  await applyAutoDiscardable(rules);
  return { protected: existing.length === 0 };
}

async function protectHosts(hosts) {
  const state = await loadState();
  const rules = [...state.protectionRules];
  for (const host of hosts) {
    if (!host || rules.some((rule) => matchesRule(host, rule))) continue;
    rules.push(makeRule(host));
  }
  await saveState({ protectionRules: rules });
  await applyAutoDiscardable(rules);
}

// ---------- snooze actions ----------

async function snoozeTab(tabId) {
  const tab = await chrome.tabs.get(tabId);
  if (tab.discarded || !isSupportedUrl(tab.url)) return;
  if (tab.active) {
    // Chrome refuses to discard the active tab; activate a neighbor first.
    const tabs = await chrome.tabs.query({ windowId: tab.windowId });
    const other =
      tabs.find((t) => t.id !== tabId && !t.discarded) ?? tabs.find((t) => t.id !== tabId);
    if (other) {
      await chrome.tabs.update(other.id, { active: true });
    } else {
      // lone tab in window — open a new tab to take focus so the snooze still happens
      await chrome.tabs.create({ windowId: tab.windowId, active: true });
    }
  }
  // discard() resolves with the post-discard Tab (its id may change!)
  let result;
  try {
    result = await chrome.tabs.discard(tabId);
  } catch (error) {
    // right after switching focus Chrome may briefly still treat the tab as
    // active — retry once; a second failure propagates to the caller's UI
    await new Promise((resolve) => setTimeout(resolve, 200));
    result = await chrome.tabs.discard(tabId);
  }
  if (result && !result.discarded) {
    throw new Error("Chrome refused to discard this tab (playing audio or capturing media?)");
  }
}

// ---------- messages from side panel / options ----------

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  handleMessage(message)
    .then((result) => sendResponse(result ?? { ok: true }))
    .catch((error) => sendResponse({ error: String(error) }));
  return true;
});

async function handleMessage(message) {
  switch (message.type) {
    case "snooze-tab":
      return snoozeTab(message.tabId);
    case "toggle-site-protection":
      return toggleSiteProtection(await chrome.tabs.get(message.tabId));
    case "protect-hosts":
      return protectHosts(message.hosts);
    case "snooze-all-inactive":
      return autoSnoozePass();
    case "history-back":
      return loadHistory().then((h) => historyJump(h.cursor - 1));
    case "history-forward":
      return loadHistory().then((h) => historyJump(h.cursor + 1));
    case "history-jump":
      return historyJump(message.index);
    default:
      throw new Error(`unknown message ${message.type}`);
  }
}

// ---------- settings / rules changes ----------

chrome.storage.onChanged.addListener(async (changes, area) => {
  if (area !== "local") return;
  if (changes.settings) {
    await ensureAlarm(changes.settings.newValue);
  }
  if (changes.protectionRules) {
    await applyAutoDiscardable(changes.protectionRules.newValue ?? []);
    const [active] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    await syncProtectMenu(active);
  }
  if (changes.tabHistory || changes.ui) {
    await rebuildHistoryMenu();
  }
});

// Keep the protect menu item's title matching the active tab's protection state.
async function syncProtectMenu(tab) {
  if (!tab || !isSupportedUrl(tab.url)) return;
  const { protectionRules } = await loadState();
  chrome.contextMenus.update("protect-this-site", {
    title: isProtected(tab.url, protectionRules)
      ? "Remove site protection"
      : "Protect site",
  });
}

chrome.tabs.onActivated.addListener(async ({ tabId }) => {
  syncProtectMenu(await chrome.tabs.get(tabId).catch(() => null));
});

// ---------- tab history (back/forward across tabs) ----------

// storage.local: history survives worker sleeps, extension reloads, and browser restarts
async function loadHistory() {
  const { tabHistory } = await chrome.storage.local.get("tabHistory");
  return tabHistory ?? { stack: [], cursor: -1 };
}

let expectedActivation = null; // our own jump's tabId — don't re-push it

function isOwnJump(tabId) {
  if (expectedActivation !== tabId) return false;
  expectedActivation = null; // cursor already moved by the jump
  return true;
}

async function recordActivation(tabId) {
  if (isOwnJump(tabId)) return;
  const hist = await loadHistory();
  await chrome.storage.local.set({ tabHistory: pushHistory(hist, tabId) });
}

chrome.tabs.onActivated.addListener(({ tabId }) => recordActivation(tabId));

// Switching windows changes the current tab without any onActivated (the target
// window's active tab is unchanged) — record it here or it never enters history.
chrome.windows.onFocusChanged.addListener(async (windowId) => {
  if (windowId === chrome.windows.WINDOW_ID_NONE) return;
  const [tab] = await chrome.tabs.query({ active: true, windowId });
  if (tab?.id) await recordActivation(tab.id);
});

chrome.tabs.onRemoved.addListener(async (tabId) => {
  const hist = await loadHistory();
  await chrome.storage.local.set({ tabHistory: removeFromHistory(hist, tabId) });
});

async function historyJump(cursor) {
  const hist = await loadHistory();
  if (cursor < 0 || cursor >= hist.stack.length) return;
  const tabId = hist.stack[cursor];
  try {
    const tab = await chrome.tabs.get(tabId);
    expectedActivation = tabId;
    await chrome.storage.local.set({ tabHistory: { ...hist, cursor } });
    await chrome.windows.update(tab.windowId, { focused: true });
    await chrome.tabs.update(tabId, { active: true });
  } catch {
    // tab already gone (e.g. closed while worker slept) — drop it, stay put
    expectedActivation = null;
    await chrome.storage.local.set({ tabHistory: removeFromHistory(hist, tabId) });
  }
}

// Re-evaluate protection flag when a tab navigates to a different URL.
chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  if (!changeInfo.url || !isSupportedUrl(changeInfo.url)) return;
  if (tab?.active) await syncProtectMenu(tab);
  const { protectionRules } = await loadState();
  try {
    await chrome.tabs.update(tabId, {
      autoDiscardable: !isProtected(changeInfo.url, protectionRules),
    });
  } catch (error) {
    console.debug("autoDiscardable update failed", tabId, error);
  }
});

// ---------- keyboard commands ----------

chrome.commands.onCommand.addListener(async (command) => {
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  if (!tab) return;
  switch (command) {
    case "open-tab-manager":
      await chrome.sidePanel.open({ windowId: tab.windowId });
      break;
    case "snooze-current-tab":
      await snoozeTab(tab.id);
      break;
    case "toggle-protection":
      await toggleSiteProtection(tab);
      break;
  }
});

// ---------- context menus ----------

// per-tab items only appear on pages we can snooze/protect; global items show everywhere
const PAGE_PATTERNS = ["http://*/*", "https://*/*", "file://*/*"];
const MENU_ITEMS = [
  { id: "show-manager", title: "Show Taboom Manager" },
  { id: "sep-1", type: "separator" },
  { id: "snooze-this-tab", title: "Snooze this tab", documentUrlPatterns: PAGE_PATTERNS },
  { id: "protect-this-site", title: "Protect site", documentUrlPatterns: PAGE_PATTERNS },
  { id: "snooze-all-inactive", title: "Snooze all inactive tabs" },
];

async function createContextMenus() {
  await chrome.contextMenus.removeAll();
  chrome.contextMenus.create({ id: "root", title: "Taboom - Tabs Manager", contexts: ["page"] });
  for (const item of MENU_ITEMS) {
    chrome.contextMenus.create({ ...item, parentId: "root", contexts: ["page"] });
  }
  await rebuildHistoryMenu();
}

const MENU_HISTORY_MAX = 15;

// callback form: contextMenus promises need Chrome 123, we support 121
const removeMenu = (id) =>
  new Promise((resolve) =>
    chrome.contextMenus.remove(id, () => {
      void chrome.runtime.lastError; // "not found" on first build — expected
      resolve();
    }),
  );

// "Navigation stack" submenu after a separator: newest first, radio dot marks current.
// Hidden entirely (incl. separator) when ui.historyNav is off.
async function rebuildHistoryMenu() {
  const [{ ui }, { stack, cursor }, rawFeatures] = await Promise.all([
    loadState(),
    loadHistory(),
    loadFeatures(),
  ]);
  const features = applyExperimental(rawFeatures, ui.showExperimental ?? false);
  await removeMenu("history");
  await removeMenu("sep-2");
  if (!featureEnabled(features, "NAVIGATION_STACK") || ui.historyNav === false) return;
  chrome.contextMenus.create({ id: "sep-2", type: "separator", parentId: "root", contexts: ["page"] });
  chrome.contextMenus.create({
    id: "history",
    parentId: "root",
    title: "Navigation stack",
    contexts: ["page"],
    enabled: stack.length > 0,
  });
  const byId = new Map((await chrome.tabs.query({})).map((tab) => [tab.id, tab]));
  const from = stack.length - 1;
  for (let index = from; index > from - MENU_HISTORY_MAX && index >= 0; index--) {
    const tab = byId.get(stack[index]);
    const title = tab?.title || tab?.url || "(closed tab)";
    chrome.contextMenus.create({
      id: `hist-${index}`,
      parentId: "history",
      type: "radio",
      checked: index === cursor,
      title: title.length > 50 ? `${title.slice(0, 49)}…` : title,
      contexts: ["page"],
    });
  }
}

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (typeof info.menuItemId === "string" && info.menuItemId.startsWith("hist-")) {
    return historyJump(Number(info.menuItemId.slice(5)));
  }
  switch (info.menuItemId) {
    case "show-manager":
      if (tab) await chrome.sidePanel.open({ windowId: tab.windowId });
      break;
    case "snooze-this-tab":
      if (tab) await snoozeTab(tab.id);
      break;
    case "protect-this-site":
      if (tab && isSupportedUrl(tab.url)) await toggleSiteProtection(tab);
      break;
    case "snooze-all-inactive":
      await autoSnoozePass();
      break;
  }
});
