// Snoozing (tab discard): the auto-snooze alarm and its pass, the pass after a browser
// start, manual snooze of one tab, and the manual-wake timestamps that reset the inactivity clock.
import { featureEnabled, isSupportedUrl, isUnloaded, selectAutoSnoozeTargets } from "../app/core.ts";
import { loadState, sessionStore } from "../app/storage.ts";
import type { Settings, WakeTimes } from "../app/types.ts";
import { isKeptAlive } from "../app/keep-alive.ts";
import { activeKeepAliveList } from "./keep-alive.ts";
import { effectiveFeatures } from "./nav-mode.ts";

const ALARM_NAME = "auto-snooze";
const STARTUP_ALARM_NAME = "snooze-on-startup";
// Chrome fires no alarm sooner than 30 s after it is set (a shorter delay is raised to 30 s in a
// packed extension); below that a timer does it — the start event has just woken the worker,
// and Chrome keeps it awake 30 s past its last event
const SHORTEST_ALARM_SECONDS = 30;

export async function ensureAlarm(settings: Settings): Promise<void> {
  await chrome.alarms.create(ALARM_NAME, {
    periodInMinutes: Math.max(1, settings.checkIntervalMinutes),
  });
}

// alarms.onAlarm — the toggle gates only the timer: the Settings button and the
// context menu are explicit requests and run with auto-snooze switched off
export function onAlarm(alarm: chrome.alarms.Alarm): void {
  if (alarm.name === ALARM_NAME) {
    loadState().then((state) => (state.settings.autoSnoozeEnabled ? autoSnoozePass() : undefined));
  }
  if (alarm.name === STARTUP_ALARM_NAME) {
    void startupSnoozePass();
  }
}

// SNOOZE_ON_STARTUP — its own option, not tied to the timer's toggle: it is "Snooze inactive
// tabs now" on a trigger. Seconds to wait after a browser start; 0 = never (or the flag is off)
async function startupSnoozeDelay(): Promise<number> {
  const { state, features } = await effectiveFeatures();
  return featureEnabled(features, "SNOOZE_ON_STARTUP") ? state.settings.snoozeOnStartupSeconds : 0;
}

// the delay is over — asked again: the option may have been set to never meanwhile
async function startupSnoozePass(): Promise<void> {
  if ((await startupSnoozeDelay()) > 0) {
    await autoSnoozePass(true);
  }
}

// runtime.onStartup (a browser start; not an extension reload or update): the restored tabs
// are snoozed in one on-demand pass after the delay — every window, the usual rules. The delay
// lets a session restore create its windows and the user click the tab they came for
export async function armStartupSnooze(): Promise<void> {
  const seconds = await startupSnoozeDelay();
  if (seconds <= 0) {
    return;
  }
  if (seconds < SHORTEST_ALARM_SECONDS) {
    setTimeout(startupSnoozePass, seconds * 1000);
    return;
  }
  await chrome.alarms.create(STARTUP_ALARM_NAME, { delayInMinutes: seconds / 60 });
}

// resolves with how many tabs were handed to discard(). onDemand: the user asked
// (Settings button, ☰ quick action, page menu) — every rule but the inactivity
// clock applies, as if each tab had already crossed the threshold
export async function autoSnoozePass(onDemand = false): Promise<number> {
  const state = await loadState();
  const settings = onDemand ? { ...state.settings, inactivityMinutes: 0 } : state.settings;
  const [tabs, keepAlive] = await Promise.all([chrome.tabs.query({}), activeKeepAliveList()]);
  // manual wakes reset the inactivity clock (storage.session: survives SW
  // idle-death, gone with the browser session like the tabs themselves)
  const openIds = new Set(tabs.map((tab) => tab.id));
  const pruned = await withWakeTimes((wakeTimes) => {
    const kept = Object.fromEntries(Object.entries(wakeTimes).filter(([tabId]) => openIds.has(Number(tabId))));
    return Object.keys(kept).length === Object.keys(wakeTimes).length ? undefined : kept;
  });
  const targets = selectAutoSnoozeTargets(tabs, settings, state.protectionRules, Date.now(), pruned, (url) =>
    isKeptAlive(keepAlive, url),
  );
  await Promise.allSettled(
    targets.map((tabId) => chrome.tabs.discard(tabId).catch((error) => console.debug("discard failed", tabId, error))),
  );
  return targets.length;
}

// Every wakeTimes mutation runs through one chain: the panel reports each woken tab
// with its own message, and two landing together both read the map before either
// writes — the last one wins and a wake is lost. Resolves with the map as written
// (or as read when `mutate` returned undefined — no write).
let wakeChain = Promise.resolve();
function withWakeTimes(mutate: (wakeTimes: WakeTimes) => WakeTimes | undefined): Promise<WakeTimes> {
  const run = wakeChain.then(async () => {
    const { wakeTimes = {} } = await sessionStore.get("wakeTimes");
    const next = mutate(wakeTimes);
    if (next) {
      await sessionStore.set({ wakeTimes: next });
    }
    return next ?? wakeTimes;
  });
  wakeChain = run.then(
    () => {},
    () => {}, // one failure must not jam the queue
  );
  return run;
}

// manual wake — restart the inactivity clock for these tabs
export async function recordWakes(tabIds: number[]): Promise<void> {
  const now = Date.now();
  await withWakeTimes((wakeTimes) => ({ ...wakeTimes, ...Object.fromEntries(tabIds.map((tabId) => [tabId, now])) }));
}

export async function snoozeTab(tabId: number): Promise<void> {
  const tab = await chrome.tabs.get(tabId);
  if (isUnloaded(tab) || !isSupportedUrl(tab.url)) {
    return;
  }
  let helperId: number | undefined;
  if (tab.active) {
    // Chrome refuses to discard the active tab; activate a neighbor first.
    const tabs = await chrome.tabs.query({ windowId: tab.windowId });
    const other = tabs.find((t) => t.id !== tabId && !isUnloaded(t)) ?? tabs.find((t) => t.id !== tabId);
    if (other) {
      await chrome.tabs.update(other.id, { active: true });
    } else {
      // lone tab in window — open a new tab to take focus so the snooze still happens
      helperId = (await chrome.tabs.create({ windowId: tab.windowId, active: true })).id;
    }
  }
  try {
    await discardTab(tabId);
  } catch (error) {
    if (helperId !== undefined) {
      // the helper only existed to take focus: a refused snooze must not leave it
      // behind (closing it hands focus back to the lone tab, the window's only other one)
      await chrome.tabs.remove(helperId).catch(() => {});
    }
    throw error;
  }
}

// the panel's bulk snooze: one message for the batch, one tab at a time inside (two active tabs of
// one window must not both get a helper New Tab); the refusals come back for one toast
export async function snoozeTabs(tabIds: number[]): Promise<{ failures: string[] }> {
  const failures: string[] = [];
  for (const tabId of tabIds) {
    try {
      await snoozeTab(tabId);
    } catch (error) {
      failures.push(error instanceof Error ? error.message : String(error));
    }
  }
  return { failures };
}

async function discardTab(tabId: number): Promise<void> {
  // discard() resolves with the post-discard Tab (its id may change!)
  let result: chrome.tabs.Tab | undefined;
  try {
    result = await chrome.tabs.discard(tabId);
  } catch {
    // right after switching focus Chrome may briefly still treat the tab as
    // active — retry once; a second failure propagates to the caller's UI
    await new Promise((resolve) => setTimeout(resolve, 200));
    result = await chrome.tabs.discard(tabId);
  }
  if (result && !result.discarded) {
    throw new Error("Chrome refused to discard this tab (playing audio or capturing media?)");
  }
}
