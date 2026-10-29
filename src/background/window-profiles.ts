// Window identity (logical ids stable across restarts), the per-window profile
// patches (name / color / pin / panelOpen), and panel-open tracking + restore.
import { localStore, sessionStore } from "../app/storage.ts";
import { assignLogicalIds, buildFingerprint, expireProfiles, windowsToRestore } from "../app/window-identity.ts";
import type { WindowFingerprint, WindowProfile } from "../app/types.ts";

// ---------- window identity (logical ids stable across restarts) ----------
// Every window gets a logical id kept in storage.session (chromeWindowId →
// logicalId); its content fingerprint lives in storage.local.windowProfiles.
// Chrome wipes storage.session on browser restart (an extension reload may
// too) — a window missing from the map is matched against the stored
// profiles by fingerprint before a fresh id is minted (assignLogicalIds).

const PROFILE_DEBOUNCE_MS = 400;
const PROFILE_TTL_MS = 14 * 24 * 3_600_000;
let profileTimer: ReturnType<typeof setTimeout> | null = null;

// Every read-modify-write of windowProfiles runs on this one chain — a refresh
// (tab events, panel open) interleaving with a rename would otherwise write its
// stale copy over the name (last writer wins)
let profileChain = Promise.resolve();
function queued<T>(work: () => Promise<T>): Promise<T> {
  const run = profileChain.then(work);
  profileChain = run.then(
    () => {},
    () => {}, // one failure must not jam the queue
  );
  return run;
}

export function scheduleProfileRefresh(): void {
  clearTimeout(profileTimer ?? undefined); // clearTimeout's typing rejects null
  profileTimer = setTimeout(() => queued(refreshWindowProfiles).catch(() => {}), PROFILE_DEBOUNCE_MS);
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
  const map = assignLogicalIds(windowSessionMap, windowProfiles, candidates, () => `w-${crypto.randomUUID()}`);

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

// One read + one write for the whole batch, on the profile chain — a panel
// connecting while another panel's restore-dismiss is mid-write would otherwise
// clobber it. `undefined` values in the patch drop the key on the storage write
// (clear name/color).
export function patchWindowProfiles(windowIds: number[], patch: Partial<WindowProfile>): Promise<void> {
  return queued(() => patchWindowProfilesNow(windowIds, patch));
}

async function patchWindowProfilesNow(windowIds: number[], patch: Partial<WindowProfile>): Promise<void> {
  let { windowSessionMap = {} } = await sessionStore.get("windowSessionMap");
  let { windowProfiles = {} } = await localStore.get("windowProfiles");
  // window not mapped yet (fresh window / fresh session), or mapped but its profile gone
  // (Settings → Delete all clears storage.local while storage.session keeps the map): refresh
  // first — it recreates the profile under the mapped id — else the patch has nothing to land on
  const idOf = (id: number): string | undefined => windowSessionMap[id];
  if (windowIds.some((id) => !windowProfiles[idOf(id) ?? ""])) {
    await refreshWindowProfiles(); // already on the chain
    ({ windowSessionMap = {} } = await sessionStore.get("windowSessionMap"));
    ({ windowProfiles = {} } = await localStore.get("windowProfiles"));
  }
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

// the identity bits (name / color / pin) of a live window, if it has a profile yet
export async function windowProfileOf(windowId: number): Promise<WindowProfile | undefined> {
  const { windowSessionMap = {} } = await sessionStore.get("windowSessionMap");
  const logicalId = windowSessionMap[windowId];
  if (!logicalId) {
    return undefined;
  }
  const { windowProfiles = {} } = await localStore.get("windowProfiles");
  return windowProfiles[logicalId];
}

// Which windows to offer a panel restore for (see windowsToRestore).
// Runs an immediate profile refresh first so restart recovery has happened.
export async function panelsToRestore(excludeWindowId: number): Promise<{ windows: number[] }> {
  await queued(refreshWindowProfiles);
  const { windowSessionMap = {} } = await sessionStore.get("windowSessionMap");
  const { windowProfiles = {} } = await localStore.get("windowProfiles");
  return { windows: windowsToRestore(windowSessionMap, windowProfiles, excludeWindowId, connectedPanelWindows) };
}
