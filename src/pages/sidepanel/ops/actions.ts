// Tab actions: activate, snooze, wake, close, pin, protect / unprotect. Each one consumes
// the tabs it acted on from the selection and refreshes the panel. copyUrls is the
// exception: it touches no tab, so the selection stays.
import { isUnloaded } from "../../../app/core.ts";
import { send } from "../../../app/messages.ts";
import { parkedRef } from "../../../app/parked.ts";
import { pauseKeepAlive } from "../../../app/storage.ts";
import { toast, toastFailure } from "../../../lib/ui/toast.ts";
import { refresh } from "../foundation/scheduler.ts";
import { reportAnswer } from "./answer.ts";
import { actionableTabs, state } from "../foundation/state.ts";
import type { PanelTab } from "../foundation/state.ts";
import { hostsOf, urlsOf } from "../model/tab-hosts.ts";

// dragging (or right-clicking) a selected row acts on the whole selection
export function actionIds(tabId: number): number[] {
  return state.selected.has(tabId) ? [...state.selected] : [tabId];
}

// ---------- actions ----------

export async function activate(tab: PanelTab): Promise<void> {
  if (parkedRef(tab.id)) {
    return; // a parked snapshot has no window to focus (row click / Enter: the menu is the way in)
  }
  try {
    await chrome.windows.update(tab.windowId, { focused: true });
    await chrome.tabs.update(tab.id, { active: true });
    state.followCurrent = true;
  } catch (error) {
    // the tab or its window went between the render and the click: say so, drop the stale row
    toastFailure("switch to the tab", error);
    refresh(false);
  }
}

// an action consumes only the tabs it acted on — the rest of the selection
// survives (a row-button action must not wipe an unrelated multi-select)
function unselect(tabIds: number[]): void {
  for (const tabId of tabIds) {
    state.selected.delete(tabId);
  }
}

export async function snooze(tabIds: number[]): Promise<void> {
  const failures: string[] = [];
  for (const tabId of tabIds) {
    // undefined: no listener answered
    const response = await send({ type: "snooze-tab", tabId });
    if (response && "error" in response) {
      failures.push(response.error);
    }
  }
  if (failures.length > 0) {
    toast(`Could not snooze ${failures.length} tab(s): ${failures[0]}`);
  }
  unselect(tabIds);
  refresh(true);
}

// background reload of snoozed tabs — wakes without switching to them;
// non-discarded tabs are skipped so a mixed selection never force-reloads live pages
export async function wake(tabIds: number[]): Promise<void> {
  const snoozed = tabIds.filter((tabId) => {
    const tab = actionableTabs().find((candidate) => candidate.id === tabId);
    return tab !== undefined && isUnloaded(tab);
  });
  await Promise.all(snoozed.map((tabId) => chrome.tabs.reload(tabId).catch(() => {})));
  if (snoozed.length > 0) {
    // reload keeps the old lastAccessed — tell the SW to restart their clocks
    send({ type: "tabs-woken", tabIds: snoozed });
  }
  unselect(tabIds);
  refresh(true);
}

// confirmMessage: a caller that knows the consequences (Duplicates view: windows that
// close with their last tab) spells them out and is always asked, even for one tab.
// beforeClose: work that must land before the tabs go (a parked snapshot of them) — after
// the confirm, so a Cancel leaves nothing behind
export async function closeTabs(
  tabIds: number[],
  confirmMessage?: string,
  beforeClose?: () => Promise<unknown>,
): Promise<void> {
  // Native confirm for multi-close; upgrade to undo snackbar if it annoys
  const message = confirmMessage ?? (tabIds.length > 1 ? `Close ${tabIds.length} tabs?` : null);
  if (message !== null && !confirm(message)) {
    return;
  }
  await beforeClose?.();
  try {
    await chrome.tabs.remove(tabIds);
  } catch {
    // the list stopped at a tab that is already gone: close what is still open, say so
    const live = new Set((await chrome.tabs.query({})).map((tab) => tab.id));
    const open = tabIds.filter((tabId) => live.has(tabId));
    if (open.length > 0) {
      await chrome.tabs.remove(open).catch(() => {});
    }
    toast("Could not close every tab: some were already closed");
  }
  unselect(tabIds);
  refresh(true);
}

// pin to the window's tab strip (Chrome-native pinning, not window pinning)
export async function pinTabs(tabIds: number[], pinned: boolean): Promise<void> {
  await Promise.allSettled(tabIds.map((tabId) => chrome.tabs.update(tabId, { pinned })));
  unselect(tabIds);
  refresh(true);
}

export async function protectTabs(tabIds: number[]): Promise<void> {
  reportAnswer(await send({ type: "protect-hosts", hosts: hostsOf(actionableTabs(), tabIds) }), "protect the site");
  unselect(tabIds);
  refresh(true);
}

// exact addresses, so two tabs on one host can differ; the host stays snoozable
export async function protectUrls(tabIds: number[]): Promise<void> {
  reportAnswer(await send({ type: "protect-urls", urls: urlsOf(actionableTabs(), tabIds) }), "protect the page");
  unselect(tabIds);
  refresh(true);
}

// by url: removes the host rule covering the page and its exact url rule alike
export async function unprotectTabs(tabIds: number[]): Promise<void> {
  reportAnswer(await send({ type: "unprotect-urls", urls: urlsOf(actionableTabs(), tabIds) }), "unprotect");
  unselect(tabIds);
  refresh(true);
}

// keep-it-alive marks follow the page (by url), so the selection stays — nothing was consumed
export async function keepAlive(tabIds: number[], kept: boolean): Promise<void> {
  reportAnswer(await send({ type: "keep-alive-set", tabIds, kept }), kept ? "keep the page alive" : "unmark the page");
  refresh(true);
}

// pause / resume: a storage write the worker follows (alarm, menu checkbox) like an options edit
export async function keepAlivePause(tabIds: number[], paused: boolean): Promise<void> {
  await pauseKeepAlive(urlsOf(actionableTabs(), tabIds), paused);
  refresh(true);
}

// Must run synchronously from the click: clipboard writes in an extension page ride
// on the user activation, no clipboardWrite permission needed.
export async function copyUrls(tabIds: number[]): Promise<void> {
  const urls = tabIds.map((tabId) => actionableTabs().find((tab) => tab.id === tabId)?.url).filter(Boolean);
  try {
    await navigator.clipboard.writeText(urls.join("\n"));
    toast(urls.length === 1 ? "URL copied" : `${urls.length} URLs copied`);
  } catch (error) {
    toast(`Could not copy: ${String((error as Partial<Error> | null)?.message ?? error)}`);
  }
}
