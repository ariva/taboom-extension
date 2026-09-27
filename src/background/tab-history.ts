// Tab history (back/forward across tabs): the stored stack, the one chain that
// serializes every mutation of it, and jumps along it.
import {
  collapseAdjacent,
  filterHistory,
  pushHistoryCompact,
  pushHistoryTraditional,
  removeFromHistory,
} from "../app/core.ts";
import { localStore } from "../app/storage.ts";
import type { TabHistory } from "../app/types.ts";
import { navMode } from "./nav-mode.ts";

// storage.local: history survives worker sleeps, extension reloads, and browser restarts
export async function loadHistory(): Promise<TabHistory> {
  const { tabHistory } = await localStore.get("tabHistory");
  return tabHistory ?? { stack: [], cursor: -1 };
}

// Every tabHistory mutation runs through one chain. Closing the active tab
// fires onActivated (neighbor) and onRemoved (closed tab) essentially at once;
// unserialized, their read-modify-writes interleave and the last writer
// resurrects the closed id or loses the cursor move.
let historyChain = Promise.resolve();
export function withHistory(
  mutate: (hist: TabHistory) => TabHistory | null | Promise<TabHistory | null>,
): Promise<void> {
  const run = historyChain.then(async () => {
    const hist = await loadHistory();
    const mutated = await mutate(hist);
    // same tab never sits twice in a row, whatever the mutation did
    const next = mutated && collapseAdjacent(mutated);
    // pushHistory's no-op returns the same stack ref + cursor — skip the write
    if (next && !(next.stack === hist.stack && next.cursor === hist.cursor)) {
      await localStore.set({ tabHistory: next });
    }
  });
  historyChain = run.catch(() => {}); // one failure must not jam the queue
  return run;
}

let expectedActivation: number | null = null; // our own jump's tabId — don't re-push it

function isOwnJump(tabId: number): boolean {
  if (expectedActivation !== tabId) {
    return false;
  }
  expectedActivation = null; // cursor already moved by the jump
  return true;
}

export async function recordActivation(tabId: number): Promise<void> {
  const mode = await navMode();
  if (mode === "off") {
    return; // feature off: zero writes per tab switch
  }
  if (isOwnJump(tabId)) {
    return;
  }
  const push = mode === "compact" ? pushHistoryCompact : pushHistoryTraditional;
  await withHistory((hist) => push(hist, tabId));
}

// windows.onFocusChanged
// Switching windows changes the current tab without any onActivated (the target
// window's active tab is unchanged) — record it here or it never enters history.
export async function recordWindowFocus(windowId: number): Promise<void> {
  if (windowId === chrome.windows.WINDOW_ID_NONE) {
    return;
  }
  const [tab] = await chrome.tabs.query({ active: true, windowId });
  if (tab?.id) {
    await recordActivation(tab.id);
  }
}

// tabs.onRemoved
export function dropClosedTabs(tabId: number): Promise<void> {
  // NOT gated on the nav-stack flag: a stack recorded while the feature was on
  // must not keep dead tab ids after it's toggled off. Sweeps ALL closed ids.
  return withHistory(async (hist) => {
    if (hist.stack.length === 0) {
      return null; // default installs: no write
    }
    const open = new Set((await chrome.tabs.query({})).map((tab) => tab.id));
    open.delete(tabId); // this close may still be listed by the query
    const next = filterHistory(hist, (id) => open.has(id));
    return next.stack.length === hist.stack.length ? null : next;
  });
}

// tabs.onReplaced
// Discarding (snoozing!) or prerender-committing a tab REPLACES its id with no
// onRemoved for the old one — the trail entry would turn into "(closed tab)"
// while the tab is still open. Swap the id in place, cursor untouched.
export function replaceTabId(addedTabId: number, removedTabId: number): Promise<void> {
  return withHistory((hist) => {
    if (!hist.stack.includes(removedTabId)) {
      return null;
    }
    return { ...hist, stack: hist.stack.map((id) => (id === removedTabId ? addedTabId : id)) };
  });
}

export async function historyJump(cursor: number): Promise<void> {
  await withHistory(async (hist) => {
    if (cursor < 0 || cursor >= hist.stack.length) {
      return null;
    }
    const tabId = hist.stack[cursor]!; // cursor is bounds-checked just above
    try {
      const tab = await chrome.tabs.get(tabId);
      expectedActivation = tabId;
      await chrome.windows.update(tab.windowId, { focused: true });
      await chrome.tabs.update(tabId, { active: true });
      return { ...hist, cursor };
    } catch {
      // tab already gone (e.g. closed while worker slept) — drop it, stay put
      expectedActivation = null;
      return removeFromHistory(hist, tabId);
    }
  });
}
