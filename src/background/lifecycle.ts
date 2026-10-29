// Worker lifecycle: the coalesced init pass run on install / browser startup,
// and the pending-update notice.
import { filterHistory } from "../app/core.ts";
import { IS_DEV } from "../app/env.ts";
import { loadState, localStore, saveState } from "../app/storage.ts";
import { openPanelOnActionClick } from "../lib/platform/panel.ts";
import { createContextMenus } from "./context-menus.ts";
import { ensureKeepAliveAlarm } from "./keep-alive.ts";
import { applyAutoDiscardable } from "./protection.ts";
import { ensureAlarm } from "./snooze.ts";
import { withHistory } from "./tab-history.ts";

// onInstalled and onStartup both fire at a browser launch that carries a
// pending update/reload — two concurrent passes interleave their menu
// removeAll/create and double the alarm/profile work. Coalesce into one.
let initPromise: Promise<void> | null = null;
export function init(): Promise<void> {
  initPromise ??= initNow().finally(() => {
    initPromise = null;
  });
  return initPromise;
}

// One step failing (a menu id already there, `sidePanel.setPanelBehavior` missing on an
// old Chrome, a dev icon absent) must not skip the rest: the update note would keep
// showing the version now running, the sweep alarm would stay unarmed, the history
// unpruned. Each step is isolated; the failure is logged, the pass goes on.
async function step(name: string, work: () => Promise<unknown>): Promise<void> {
  try {
    await work();
  } catch (error) {
    console.debug(`init step failed: ${name}`, error);
  }
}

async function initNow(): Promise<void> {
  const state = await loadState();
  await step("save defaults", () => saveState(state)); // persist defaults on first run
  await step("snooze alarm", () => ensureAlarm(state.settings));
  await step("keep-alive alarm", ensureKeepAliveAlarm);
  await step("autoDiscardable", () => applyAutoDiscardable(state.protectionRules));
  await step("context menus", createContextMenus);
  await step("panel on action click", openPanelOnActionClick);
  if (IS_DEV) {
    await step("dev badge", markDevBuild);
  }
  // running the new version now
  await step("clear update note", () => localStore.remove(["updateAvailable", "dismissedUpdate"]));
  // history persists across extension reloads — just prune tabs that vanished meanwhile
  // (a browser start empties it first: resetHistoryOnStartup, same chain)
  await step("prune history", async () => {
    const openIds = new Set((await chrome.tabs.query({})).map((tab) => tab.id));
    await withHistory((hist) => filterHistory(hist, (id) => openIds.has(id)));
  });
}

// unpacked copy running next to the store one: blue moon + DEV badge in the toolbar
async function markDevBuild(): Promise<void> {
  await chrome.action
    .setIcon({
      // root-relative: setIcon resolves bare paths against the worker's own directory
      path: {
        16: "/icons/dev/icon16.png",
        32: "/icons/dev/icon32.png",
        48: "/icons/dev/icon48.png",
        128: "/icons/dev/icon128.png",
      },
    })
    // dist/prod loaded unpacked (e2e, manual check) has no dev icons — keep the stock one
    .catch(() => {});
  await chrome.action.setBadgeText({ text: "dev" });
  await chrome.action.setBadgeBackgroundColor({ color: "#1a63d4" });
}

// runtime.onUpdateAvailable
// An open side panel keeps the extension non-idle, deferring auto-update forever;
// surface the pending version so the panel can offer a restart.
export function noteUpdateAvailable({ version }: chrome.runtime.UpdateAvailableDetails): void {
  localStore.set({ updateAvailable: version });
}
