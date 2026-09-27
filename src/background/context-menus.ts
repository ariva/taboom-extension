// The page context menu: static items, the "Navigation stack" submenu, and the
// one queue every menu mutation runs through.
import { applyExperimental, resolveNavMode } from "../app/core.ts";
import { DEV_PREFIX, getAppName } from "../app/env.ts";
import { loadState } from "../app/storage.ts";
import { getFeatures } from "./nav-mode.ts";
import { loadHistory } from "./tab-history.ts";

// per-tab items only appear on pages we can snooze/protect; global items show everywhere
const PAGE_PATTERNS = ["http://*/*", "https://*/*", "file://*/*"];
const MENU_ITEMS: chrome.contextMenus.CreateProperties[] = [
  { id: "show-manager", title: "Show Taboom Manager" },
  { id: "sep-1", type: "separator" },
  { id: "snooze-this-tab", title: "Snooze this tab", documentUrlPatterns: PAGE_PATTERNS },
  { id: "protect-this-site", title: "Protect site", documentUrlPatterns: PAGE_PATTERNS },
  { id: "snooze-all-inactive", title: "Snooze all inactive tabs" },
];

export function createContextMenus(): Promise<unknown> {
  return enqueueMenuOp(async () => {
    await chrome.contextMenus.removeAll();
    chrome.contextMenus.create({ id: "root", title: `${DEV_PREFIX}${getAppName()}`, contexts: ["page"] });
    for (const item of MENU_ITEMS) {
      chrome.contextMenus.create({ ...item, parentId: "root", contexts: ["page"] });
    }
    menuDirty = false; // the fresh rebuild below covers any queued history pass
    await rebuildHistoryMenuNow();
  });
}

const MENU_HISTORY_MAX = 15;

// callback form: contextMenus promises need Chrome 123, we support 121
const removeMenu = (id: string) =>
  new Promise((resolve) =>
    chrome.contextMenus.remove(id, () => {
      void chrome.runtime.lastError; // "not found" on first build — expected
      resolve(undefined);
    }),
  );

// EVERY menu mutation runs through this one queue. Interleaved passes
// (createContextMenus racing rebuilds, protect-title updates landing in a
// removeAll→create gap) end in "duplicate id" / "cannot find menu item".
let menuChain: Promise<unknown> = Promise.resolve();
export function enqueueMenuOp(op: () => Promise<unknown>): Promise<unknown> {
  const run = menuChain.then(op);
  menuChain = run.catch(() => {}); // one failure must not jam the queue
  return run;
}

// "Navigation stack" submenu after a separator: newest first, radio dot marks current.
// Hidden entirely (incl. separator) when ui.historyNav is off.
// Coalesced: calls that land while a pass runs fold into one follow-up pass.
let menuDirty = false;
export function rebuildHistoryMenu(): Promise<unknown> {
  menuDirty = true;
  return enqueueMenuOp(async () => {
    if (!menuDirty) {
      return; // an earlier queued pass already rebuilt from fresh state
    }
    menuDirty = false;
    await rebuildHistoryMenuNow();
  });
}

async function rebuildHistoryMenuNow(): Promise<void> {
  const [{ ui }, rawFeatures] = await Promise.all([loadState(), getFeatures()]);
  const features = applyExperimental(rawFeatures, ui.showExperimental ?? false);
  await removeMenu("history");
  await removeMenu("sep-2");
  if (resolveNavMode(features, ui) === "off") {
    return;
  }
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
