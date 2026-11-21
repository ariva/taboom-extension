// Site protection: rule edits, the autoDiscardable flag on tabs, and the
// protect menu item's title.
import { hostOf, isProtected, isSupportedUrl } from "../app/core.ts";
import { addHostRules, addUrlRules, removeRulesFor } from "../app/protection-rules.ts";
import { dropProtectionRules, editProtectionRules, loadState } from "../app/storage.ts";
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

// page already covered (by a host, domain or url rule) → every rule covering it goes
// (through the trash writer, so it is restorable); otherwise one new host rule
export async function toggleSiteProtection(tab: chrome.tabs.Tab): Promise<{ protected: boolean }> {
  const url = tab.url;
  if (!url || !hostOf(url)) {
    return { protected: false };
  }
  const { protectionRules } = await loadState();
  if (isProtected(url, protectionRules)) {
    await applyAutoDiscardable(await dropProtectionRules((rules) => removeRulesFor(rules, [url])));
    return { protected: false };
  }
  await protectHosts([hostOf(url)]); // the port stays: a dev server per port is its own site
  return { protected: true };
}

// expiresAt: a temporary rule (the row menu's duration); the expiry sweep drops it at its time
export async function protectHosts(hosts: string[], expiresAt?: number): Promise<void> {
  await applyAutoDiscardable(await editProtectionRules((rules) => addHostRules(rules, hosts, expiresAt)));
}

export async function protectUrls(urls: string[], expiresAt?: number): Promise<void> {
  await applyAutoDiscardable(await editProtectionRules((rules) => addUrlRules(rules, urls, expiresAt)));
}

// drops host rules covering the pages as well as exact url rules for them
export async function unprotectUrls(urls: string[]): Promise<void> {
  await applyAutoDiscardable(await dropProtectionRules((rules) => removeRulesFor(rules, urls)));
}

// Keep the protect menu item's title matching the active tab's protection state.
export async function syncProtectMenu(
  tab: chrome.tabs.Tab | null | undefined,
  rules?: ProtectionRule[], // a caller that already read them passes them along
): Promise<void> {
  if (!tab || !isSupportedUrl(tab.url)) {
    return;
  }
  const protectionRules = rules ?? (await loadState()).protectionRules;
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
  const { protectionRules } = await loadState();
  if (tab?.active) {
    await syncProtectMenu(tab, protectionRules);
  }
  const wanted = !isProtected(changeInfo.url, protectionRules);
  if (tab?.autoDiscardable === wanted) {
    return; // SPA route changes fire this constantly: nothing to write
  }
  try {
    await chrome.tabs.update(tabId, { autoDiscardable: wanted });
  } catch (error) {
    console.debug("autoDiscardable update failed", tabId, error);
  }
}
