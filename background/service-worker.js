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

// features.json can't change without an extension reload — fetch it once per
// worker life instead of on every context-menu rebuild
let featuresPromise;
const getFeatures = () => (featuresPromise ??= loadFeatures());

// Resolved NAVIGATION_STACK gate, cached — the whole history machinery
// (a storage write per tab switch + menu rebuild chain) is skipped when off.
// ui.showExperimental affects the resolution, so ui changes invalidate it.
let navStackPromise = null;
function navStackEnabled() {
  navStackPromise ??= (async () => {
    const [{ ui }, features] = await Promise.all([loadState(), getFeatures()]);
    return featureEnabled(
      applyExperimental(features, ui.showExperimental ?? false),
      "NAVIGATION_STACK",
    );
  })();
  return navStackPromise;
}

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
  await withHistory((hist) => filterHistory(hist, (id) => openIds.has(id)));
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
  await Promise.allSettled(
    selectAutoSnoozeTargets(tabs, state.settings, state.protectionRules).map((tabId) =>
      chrome.tabs.discard(tabId).catch((error) => console.debug("discard failed", tabId, error)),
    ),
  );
}

// ---------- protection ----------

async function applyAutoDiscardable(rules) {
  const tabs = await chrome.tabs.query({});
  await Promise.allSettled(
    tabs
      .filter((tab) => tab.id && isSupportedUrl(tab.url))
      .map((tab) => {
        const wanted = !isProtected(tab.url, rules);
        if (tab.autoDiscardable === wanted) {
          return null;
        }
        return chrome.tabs
          .update(tab.id, { autoDiscardable: wanted })
          .catch((error) => console.debug("autoDiscardable update failed", tab.id, error));
      }),
  );
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
  if (changes.ui) {
    navStackPromise = null; // showExperimental may have flipped the resolved flag
  }
  if (changes.settings) {
    // recreate only when the interval actually changed — any settings save hits this
    const oldInterval = /** @type {any} */ (changes.settings.oldValue)?.checkIntervalMinutes;
    const newInterval = /** @type {any} */ (changes.settings.newValue)?.checkIntervalMinutes;
    if (oldInterval !== newInterval) {
      await ensureAlarm(changes.settings.newValue);
    }
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
/** @returns {Promise<{stack: number[], cursor: number}>} */
async function loadHistory() {
  const { tabHistory } = /** @type {{tabHistory?: {stack: number[], cursor: number}}} */ (
    await chrome.storage.local.get("tabHistory")
  );
  return tabHistory ?? { stack: [], cursor: -1 };
}

// Every tabHistory mutation runs through one chain. Closing the active tab
// fires onActivated (neighbor) and onRemoved (closed tab) essentially at once;
// unserialized, their read-modify-writes interleave and the last writer
// resurrects the closed id or loses the cursor move.
let historyChain = Promise.resolve();
function withHistory(mutate) {
  const run = historyChain.then(async () => {
    const hist = await loadHistory();
    const next = await mutate(hist);
    // pushHistory's no-op returns the same stack ref + cursor — skip the write
    if (next && !(next.stack === hist.stack && next.cursor === hist.cursor)) {
      await chrome.storage.local.set({ tabHistory: next });
    }
  });
  historyChain = run.catch(() => {}); // one failure must not jam the queue
  return run;
}

let expectedActivation = null; // our own jump's tabId — don't re-push it

function isOwnJump(tabId) {
  if (expectedActivation !== tabId) return false;
  expectedActivation = null; // cursor already moved by the jump
  return true;
}

async function recordActivation(tabId) {
  if (!(await navStackEnabled())) {
    return; // feature off: zero writes per tab switch
  }
  if (isOwnJump(tabId)) return;
  await withHistory((hist) => pushHistory(hist, tabId));
}

chrome.tabs.onActivated.addListener(({ tabId }) => recordActivation(tabId));

// Switching windows changes the current tab without any onActivated (the target
// window's active tab is unchanged) — record it here or it never enters history.
chrome.windows.onFocusChanged.addListener(async (windowId) => {
  if (windowId === chrome.windows.WINDOW_ID_NONE) return;
  const [tab] = await chrome.tabs.query({ active: true, windowId });
  if (tab?.id) await recordActivation(tab.id);
});

chrome.tabs.onRemoved.addListener((tabId) =>
  // NOT gated on the nav-stack flag: a stack recorded while the feature was on
  // must not keep dead tab ids after it's toggled off. Sweeps ALL closed ids.
  withHistory(async (hist) => {
    if (hist.stack.length === 0) {
      return null; // default installs: no write
    }
    const open = new Set((await chrome.tabs.query({})).map((tab) => tab.id));
    open.delete(tabId); // this close may still be listed by the query
    const next = filterHistory(hist, (id) => open.has(id));
    return next.stack.length === hist.stack.length ? null : next;
  }),
);

// Discarding (snoozing!) or prerender-committing a tab REPLACES its id with no
// onRemoved for the old one — the trail entry would turn into "(closed tab)"
// while the tab is still open. Swap the id in place, cursor untouched.
chrome.tabs.onReplaced.addListener((addedTabId, removedTabId) =>
  withHistory((hist) => {
    if (!hist.stack.includes(removedTabId)) {
      return null;
    }
    return { ...hist, stack: hist.stack.map((id) => (id === removedTabId ? addedTabId : id)) };
  }),
);

async function historyJump(cursor) {
  await withHistory(async (hist) => {
    if (cursor < 0 || cursor >= hist.stack.length) {
      return null;
    }
    const tabId = hist.stack[cursor];
    try {
      const tab = await chrome.tabs.get(tabId);
      expectedActivation = tabId;
      await chrome.windows.update(tab.windowId, { focused: true });
      await chrome.tabs.update(tabId, { active: true });
      return { ...hist, cursor };
    } catch {
      // tab already gone (e.g. closed while worker slept) — drop it, stay put
      expectedActivation = null;
      return removeFromHistory(hist, tabId);
    }
  });
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
/** @type {chrome.contextMenus.CreateProperties[]} */
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
      resolve(undefined);
    }),
  );

// "Navigation stack" submenu after a separator: newest first, radio dot marks current.
// Hidden entirely (incl. separator) when ui.historyNav is off.
async function rebuildHistoryMenu() {
  const [{ ui }, rawFeatures] = await Promise.all([loadState(), getFeatures()]);
  const features = applyExperimental(rawFeatures, ui.showExperimental ?? false);
  await removeMenu("history");
  await removeMenu("sep-2");
  if (!featureEnabled(features, "NAVIGATION_STACK") || ui.historyNav === false) return;
  const { stack, cursor } = await loadHistory(); // only read when the menu will exist
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
