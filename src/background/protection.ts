// Site protection: rule edits, the autoDiscardable flag on tabs, and the
// protect menu item's title.
import { hostnameOf, isProtected, isSupportedUrl } from "../app/core.ts";
import { addHostRules, removeHostRules, toggleHostRule } from "../app/protection-rules.ts";
import { loadState, saveState } from "../app/storage.ts";
import type { ProtectionRule } from "../app/types.ts";
import { enqueueMenuOp } from "./context-menus.ts";

export async function applyAutoDiscardable(rules: ProtectionRule[]): Promise<void> {
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

export async function toggleSiteProtection(tab: chrome.tabs.Tab): Promise<{ protected: boolean }> {
  const host = hostnameOf(tab.url);
  if (!host) {
    return { protected: false };
  }
  const state = await loadState();
  const toggled = toggleHostRule(state.protectionRules, host);
  await saveState({ protectionRules: toggled.rules });
  await applyAutoDiscardable(toggled.rules);
  return { protected: toggled.protected };
}

export async function protectHosts(hosts: string[]): Promise<void> {
  const state = await loadState();
  const rules = addHostRules(state.protectionRules, hosts);
  await saveState({ protectionRules: rules });
  await applyAutoDiscardable(rules);
}

export async function unprotectHosts(hosts: string[]): Promise<void> {
  const state = await loadState();
  const rules = removeHostRules(state.protectionRules, hosts);
  await saveState({ protectionRules: rules });
  await applyAutoDiscardable(rules);
}

// Keep the protect menu item's title matching the active tab's protection state.
export async function syncProtectMenu(tab: chrome.tabs.Tab | null | undefined): Promise<void> {
  if (!tab || !isSupportedUrl(tab.url)) {
    return;
  }
  const { protectionRules } = await loadState();
  const title = isProtected(tab.url, protectionRules) ? "Remove site protection" : "Protect site";
  await enqueueMenuOp(
    () =>
      new Promise((resolve) =>
        chrome.contextMenus.update("protect-this-site", { title }, () => {
          void chrome.runtime.lastError; // item may be gone mid-rebuild — expected
          resolve(undefined);
        }),
      ),
  );
}

// tabs.onUpdated
// Re-evaluate protection flag when a tab navigates to a different URL.
export async function reprotectOnNavigation(
  tabId: number,
  changeInfo: chrome.tabs.OnUpdatedInfo,
  tab: chrome.tabs.Tab,
): Promise<void> {
  if (!changeInfo.url || !isSupportedUrl(changeInfo.url)) {
    return;
  }
  if (tab?.active) {
    await syncProtectMenu(tab);
  }
  const { protectionRules } = await loadState();
  try {
    await chrome.tabs.update(tabId, {
      autoDiscardable: !isProtected(changeInfo.url, protectionRules),
    });
  } catch (error) {
    console.debug("autoDiscardable update failed", tabId, error);
  }
}
