// Temporary protection rules and keep-alive marks (T-0157): one alarm, a minute apart while any
// entry carries an expiry, drops the expired ones through the removal writers — an expired entry
// is a removal like any other, so Settings → Restore last removal brings it back.
import { hasExpiring, isExpired, unexpired } from "../app/expiry.ts";
import { dropProtectionRules, localStore, removeKeepAlive } from "../app/storage.ts";
import { applyAutoDiscardable } from "./protection.ts";

const ALARM_NAME = "expiry";

export async function ensureExpiryAlarm(): Promise<void> {
  const { protectionRules = [], keepAlive = [] } = await localStore.get(["protectionRules", "keepAlive"]);
  if (!hasExpiring(protectionRules) && !hasExpiring(keepAlive)) {
    await chrome.alarms.clear(ALARM_NAME);
    return;
  }
  await chrome.alarms.create(ALARM_NAME, { periodInMinutes: 1 });
}

// alarms.onAlarm
export function onExpiryAlarm(alarm: chrome.alarms.Alarm): void {
  if (alarm.name === ALARM_NAME) {
    expirySweep();
  }
}

export async function expirySweep(): Promise<void> {
  const now = Date.now();
  // the matchers already ignore an expired rule; the flag on its tabs follows the list here
  await applyAutoDiscardable(await dropProtectionRules((rules) => unexpired(rules, now)));
  const { keepAlive = [] } = await localStore.get("keepAlive");
  const expired = keepAlive.filter((mark) => isExpired(mark, now)).map((mark) => mark.url);
  if (expired.length > 0) {
    await removeKeepAlive(expired);
  }
  await ensureExpiryAlarm();
}
