// Window identity (logical ids stable across restarts), the per-window profile
// patches (name / color / pin / panelOpen), and panel-open tracking + restore.
import { localStore, sessionStore } from "../app/storage.ts";
import { buildFingerprint, expireProfiles, matchProfiles, windowsToRestore } from "../app/window-identity.ts";
import type { WindowFingerprint, WindowProfile } from "../app/types.ts";

// ---------- window identity (logical ids stable across restarts) ----------
// Every window gets a logical id kept in storage.session (chromeWindowId →
// logicalId); its content fingerprint lives in storage.local.windowProfiles.
// Chrome wipes storage.session on browser restart but not on extension
// reload — an empty map with stored profiles means "restart": recover the
// ids by fingerprint matching before minting fresh ones.

const PROFILE_DEBOUNCE_MS = 400;
const PROFILE_TTL_MS = 14 * 24 * 3_600_000;
let profileTimer: ReturnType<typeof setTimeout> | null = null;

export function scheduleProfileRefresh(): void {
  clearTimeout(profileTimer ?? undefined); // clearTimeout's typing rejects null
  profileTimer = setTimeout(() => refreshWindowProfiles().catch(() => {}), PROFILE_DEBOUNCE_MS);
}

// tabs.onUpdated
export function refreshOnTabChange(_tabId: number, changeInfo: chrome.tabs.OnUpdatedInfo): void {
  if (changeInfo.url || changeInfo.pinned !== undefined) {
    scheduleProfileRefresh();
  }
}

async function refreshWindowProfiles(): Promise<void> {
  const [allTabs, windows] = await Promise.all([chrome.tabs.query({}), chrome.windows.getAll().catch(() => [])]);
  const byWindow = new Map<number, chrome.tabs.Tab[]>();
  for (const tab of allTabs) {
    if (!byWindow.has(tab.windowId)) {
      byWindow.set(tab.windowId, []);
    }
    byWindow.get(tab.windowId)!.push(tab); // entry created just above
  }
  const boundsOf = new Map(windows.map((win) => [win.id, win]));
  const now = Date.now();
  const candidates = [...byWindow.entries()].map(([windowId, windowTabs]): [number, WindowFingerprint] => [
    windowId,
    buildFingerprint(windowTabs, boundsOf.get(windowId) ?? null, now),
  ]);

  const { windowSessionMap = {} } = await sessionStore.get("windowSessionMap");
  const { windowProfiles = {} } = await localStore.get("windowProfiles");

  let map = windowSessionMap;
  if (Object.keys(map).length === 0 && Object.keys(windowProfiles).length > 0) {
    // fresh browser session: recover logical ids by fingerprint
    map = Object.fromEntries(matchProfiles(windowProfiles, candidates));
  }
  // drop entries for windows that no longer exist, mint ids for new ones
  map = Object.fromEntries(Object.entries(map).filter(([id]) => byWindow.has(Number(id))));
  for (const [windowId] of candidates) {
    if (!map[windowId]) {
      map[windowId] = `w-${crypto.randomUUID()}`;
    }
  }

  // upsert current windows; profiles of closed windows are kept on purpose —
  // browser shutdown fires close events too, and deleting then would break
  // restart matching. The TTL sweep is the only removal path.
  const profiles = { ...windowProfiles };
  for (const [windowId, fingerprint] of candidates) {
    // merge, don't replace — panelOpen (and future per-window flags) survive
    // map[windowId]!: every candidate window got an id in the loop above
    profiles[map[windowId]!] = { ...profiles[map[windowId]!], ...fingerprint, chromeWindowId: windowId };
  }
  await sessionStore.set({ windowSessionMap: map });
  await localStore.set({ windowProfiles: expireProfiles(profiles, now, PROFILE_TTL_MS) });
}

// ---------- panel-open tracking + restore ----------
// Each panel holds a runtime.connect port named "sidepanel:<windowId>".
// Connect/disconnect flips panelOpen on the window's logical profile — so the
// flag survives extension teardown (no disconnect fires then) and describes
// exactly which windows had a panel when the update/restart hit.

const connectedPanelWindows = new Set<number>(); // live ports, this worker instance

// runtime.onConnect
export function trackPanelPort(port: chrome.runtime.Port): void {
  if (!port.name?.startsWith("sidepanel:")) {
    return;
  }
  const windowId = Number(port.name.slice("sidepanel:".length));
  connectedPanelWindows.add(windowId);
  setPanelOpen([windowId], true);
  port.onDisconnect.addListener(() => {
    connectedPanelWindows.delete(windowId);
    setPanelOpen([windowId], false); // deliberate close — don't restore it later
  });
}

export function setPanelOpen(windowIds: number[], open: boolean): Promise<void> {
  return patchWindowProfiles(windowIds, { panelOpen: open });
}

// One read + one write for the whole batch, and every batch serialized on one
// chain — a panel connecting while another panel's restore-dismiss is mid-write
// would otherwise clobber it (last writer wins). `undefined` values in the
// patch drop the key on the storage write (clear name/color).
let profileChain = Promise.resolve();
export function patchWindowProfiles(windowIds: number[], patch: Partial<WindowProfile>): Promise<void> {
  const run = profileChain.then(() => patchWindowProfilesNow(windowIds, patch));
  profileChain = run.catch(() => {}); // one failure must not jam the queue
  return run;
}

async function patchWindowProfilesNow(windowIds: number[], patch: Partial<WindowProfile>): Promise<void> {
  let { windowSessionMap = {} } = await sessionStore.get("windowSessionMap");
  if (windowIds.some((id) => !windowSessionMap[id])) {
    await refreshWindowProfiles(); // window not mapped yet (fresh window / fresh session)
    ({ windowSessionMap = {} } = await sessionStore.get("windowSessionMap"));
  }
  const { windowProfiles = {} } = await localStore.get("windowProfiles");
  let changed = false;
  for (const windowId of windowIds) {
    const logicalId = windowSessionMap[windowId];
    if (logicalId && windowProfiles[logicalId]) {
      windowProfiles[logicalId] = { ...windowProfiles[logicalId], ...patch };
      changed = true;
    }
  }
  if (changed) {
    await localStore.set({ windowProfiles });
  }
}

// Which windows to offer a panel restore for (see windowsToRestore).
// Runs an immediate profile refresh first so restart recovery has happened.
export async function panelsToRestore(excludeWindowId: number): Promise<{ windows: number[] }> {
  await refreshWindowProfiles();
  const { windowSessionMap = {} } = await sessionStore.get("windowSessionMap");
  const { windowProfiles = {} } = await localStore.get("windowProfiles");
  return { windows: windowsToRestore(windowSessionMap, windowProfiles, excludeWindowId, connectedPanelWindows) };
}
