// Duplicates view of the windows popover: one row per page open more than once, a
// checkbox before each (all ticked on every ▦ open) and two cleanups over the ticked
// rows — "There can be only one" keeps a single copy across all windows, "Cleanup each
// window" keeps one per window. Which copy survives is decided in app/duplicates.ts.
import {
  type CleanupMode,
  closingWindows,
  type DuplicateSet,
  duplicateSets,
  duplicatesToClose,
  NEW_TAB_KEY,
  rankKeepers,
} from "../../../app/duplicates.ts";
import { clearCtxMenu, ctxAppend, ctxDivider, ctxItem, ctxTitle, showCtxMenu } from "../../../lib/ui/context-menu.ts";
import { winPop } from "../foundation/elements.ts";
import { type PanelTab, state } from "../foundation/state.ts";
import { activate, closeTabs } from "../ops/actions.ts";
import { windowLabel } from "../ops/window-ops.ts";

type DupSet = DuplicateSet<PanelTab>;

// keys the user unticked; the popover shell clears it on every open
const unticked = new Set<string>();

export function resetDuplicateSelection(): void {
  unticked.clear();
}

const context = () => ({ currentWindowId: state.currentWindowId, keepAlive: state.keepAlive });

const plural = (count: number, noun: string) => `${count} ${noun}${count === 1 ? "" : "s"}`;

async function cleanup(sets: DupSet[], mode: CleanupMode): Promise<void> {
  const ids = sets.flatMap((set) => duplicatesToClose(set, mode, context()).map((tab) => tab.id));
  if (ids.length === 0) {
    return;
  }
  const message = [
    `Close ${plural(ids.length, "duplicate tab")}?`,
    ...closingWindows(state.allTabs, ids).map(
      (windowId) => `${windowLabel(windowId)} will close — every tab in it is a duplicate.`,
    ),
    "Chrome's Ctrl+Shift+T reopens closed tabs.",
  ].join("\n");
  await closeTabs(ids, message);
}

function openDuplicateMenu(event: MouseEvent, set: DupSet): void {
  clearCtxMenu();
  ctxAppend(ctxTitle(set.title), ctxDivider());
  ctxAppend(ctxItem("Go to the copy that stays", () => goToKeeper(set)));
  if (set.key === NEW_TAB_KEY) {
    ctxAppend(ctxItem("Keep one per window", () => cleanup([set], "per-window")));
  } else {
    ctxAppend(
      ctxItem("There can be only one", () => cleanup([set], "one")),
      ctxItem("Cleanup each window", () => cleanup([set], "per-window")),
    );
  }
  showCtxMenu(event);
}

// right-click on a row (popover.ts): the row only carries the key
export function openDuplicateMenuForKey(event: MouseEvent, key: string): void {
  const set = duplicateSets(state.allTabs).find((candidate) => candidate.key === key);
  if (set) {
    openDuplicateMenu(event, set);
  }
}

function goToKeeper(set: DupSet): void {
  const keeper = rankKeepers(set.tabs, context())[0];
  if (keeper) {
    winPop.hidePopover?.();
    activate(keeper);
  }
}

function windowBreakdown(set: DupSet): string[] {
  return set.windowIds.map(
    (windowId) => `${windowLabel(windowId)}: ${set.tabs.filter((tab) => tab.windowId === windowId).length}`,
  );
}

// `refill` rebuilds the popover so the counts on the buttons follow the ticks
export function fillDuplicateRows(sets: DupSet[], refill: () => void): void {
  const ticked = sets.filter((set) => !unticked.has(set.key));
  const tools = document.createElement("div");
  tools.className = "dup-tools";
  const all = document.createElement("input");
  all.type = "checkbox";
  all.className = "dup-all";
  all.checked = ticked.length === sets.length;
  all.indeterminate = ticked.length > 0 && ticked.length < sets.length;
  all.title = "Tick or untick every page";
  all.addEventListener("change", () => {
    unticked.clear();
    if (!all.checked) {
      for (const set of sets) {
        unticked.add(set.key);
      }
    }
    refill();
  });
  const allLabel = document.createElement("label");
  allLabel.append(all, "All");
  const action = (label: string, mode: CleanupMode, hint: string): HTMLButtonElement => {
    const count = ticked.reduce((sum, set) => sum + duplicatesToClose(set, mode, context()).length, 0);
    const button = document.createElement("button");
    button.type = "button";
    button.className = "dup-action";
    button.textContent = `${label} (${count})`;
    button.title = hint;
    button.disabled = count === 0;
    button.addEventListener("click", () => cleanup(ticked, mode));
    return button;
  };
  // the two buttons travel as one group: it drops under "All" when the row is too narrow,
  // and the buttons split onto their own lines when even that is too narrow (CSS wrap)
  const actions = document.createElement("span");
  actions.className = "dup-actions";
  actions.append(
    action(
      "There can be only one",
      "one",
      "Keep one copy of each ticked page across all windows, close the rest. New Tab pages keep one per window. Pinned copies are never closed.",
    ),
    action(
      "Cleanup each window",
      "per-window",
      "Keep one copy of each ticked page in every window, close the rest. Pinned copies are never closed.",
    ),
  );
  tools.append(allLabel, actions);
  winPop.append(tools);

  for (const set of sets) {
    const check = document.createElement("input");
    check.type = "checkbox";
    check.className = "win-check";
    check.checked = !unticked.has(set.key);
    check.title = "Include this page in the cleanup";
    check.addEventListener("change", () => {
      if (check.checked) {
        unticked.delete(set.key);
      } else {
        unticked.add(set.key);
      }
      refill();
    });
    const row = document.createElement("button");
    row.type = "button";
    row.className = "win-row";
    row.dataset.duplicateKey = set.key; // right-click → openDuplicateMenuForKey (popover.ts)
    const name = document.createElement("span");
    name.className = "win-title";
    name.textContent = set.title;
    const stats = document.createElement("span");
    stats.className = "win-stats muted";
    stats.textContent = `${plural(set.tabs.length, "tab")} · ${plural(set.windowIds.length, "window")}`;
    row.append(name, stats);
    row.title = [set.url || set.title, ...windowBreakdown(set), "Click to go to the copy that stays"].join("\n");
    row.addEventListener("click", () => goToKeeper(set));
    const menuBtn = document.createElement("button");
    menuBtn.type = "button";
    menuBtn.className = "win-menu-btn";
    menuBtn.title = menuBtn.ariaLabel = "Duplicate actions";
    menuBtn.textContent = "⋯";
    menuBtn.addEventListener("click", (event) => {
      event.stopPropagation();
      openDuplicateMenu(event, set);
    });
    const item = document.createElement("div");
    item.className = check.checked ? "win-item" : "win-item unticked";
    item.append(check, row, menuBtn);
    winPop.append(item);
  }
}
