// storage.onChanged reactions: settings / rules / ui / history edits made by
// the pages re-apply the alarm, protection flags, nav mode and menus.
import { dedupeHistory } from "../app/core.ts";
import { DEFAULTS } from "../app/core.ts";
import type { ProtectionRule, Settings } from "../app/types.ts";
import { createContextMenus, rebuildHistoryMenu } from "./context-menus.ts";
import { ensureKeepAliveAlarm, keepAliveSettingChanged, restartKeepAlive, syncKeepAliveMenu } from "./keep-alive.ts";
import { invalidateNavMode, navMode } from "./nav-mode.ts";
import { applyAutoDiscardable, syncProtectMenu } from "./protection.ts";
import { ensureAlarm } from "./snooze.ts";
import { withHistory } from "./tab-history.ts";

export async function onStorageChanged(
  changes: { [key: string]: chrome.storage.StorageChange },
  area: string,
): Promise<void> {
  if (area !== "local") {
    return;
  }
  if (changes.ui) {
    invalidateNavMode(); // mode dropdown / showExperimental may have changed it
    // switching to compact: dedupe once (newest occurrence wins) so compact's
    // move-cursor-to-first-occurrence never lands on a stale duplicate
    if ((await navMode()) === "compact") {
      await withHistory((hist) => (new Set(hist.stack).size === hist.stack.length ? null : dedupeHistory(hist)));
    }
  }
  if (changes.settings) {
    // recreate only when the interval actually changed — any settings save hits this
    // StorageChange values are `unknown`; "settings" is only ever written as Settings (saveState)
    const oldInterval = (changes.settings.oldValue as Partial<Settings> | undefined)?.checkIntervalMinutes;
    const newInterval = (changes.settings.newValue as Partial<Settings> | undefined)?.checkIntervalMinutes;
    if (oldInterval !== newInterval) {
      await ensureAlarm(changes.settings.newValue as Settings);
    }
    if (
      keepAliveSettingChanged(
        changes.settings.oldValue as Partial<Settings> | undefined,
        changes.settings.newValue as Partial<Settings> | undefined,
      )
    ) {
      await createContextMenus(); // the checkbox item exists only while enabled
      const enabled =
        (changes.settings.newValue as Partial<Settings> | undefined)?.keepAliveEnabled ??
        DEFAULTS.settings.keepAliveEnabled;
      if (enabled) {
        await restartKeepAlive();
      }
      await ensureKeepAliveAlarm();
    }
  }
  if (changes.keepAlive) {
    // options-page edits (remove, interval override) and the panel's marks
    await ensureKeepAliveAlarm();
    const [active] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    await syncKeepAliveMenu(active);
  }
  if (changes.protectionRules) {
    // StorageChange values are `unknown`; "protectionRules" is only ever written as ProtectionRule[]
    await applyAutoDiscardable((changes.protectionRules.newValue as ProtectionRule[] | undefined) ?? []);
    const [active] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    await syncProtectMenu(active);
  }
  if (changes.tabHistory || changes.ui) {
    await rebuildHistoryMenu();
  }
}
