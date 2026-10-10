// Windows popover: the shell (view switch, open / close, click-away, right-click), the
// Windows view and its row menu. Groups and Pins views live in windows-popover-*.ts;
// the Alive view (keep-it-alive marks) lives in alive.ts and reuses the Pins rows.
import { send } from "../../../app/messages.ts";
import { closest } from "../../../lib/dom.ts";
import { askDialogContains } from "../../../lib/ui/ask-dialog.ts";
import {
  clearCtxMenu,
  ctxAppend,
  ctxDivider,
  ctxItem,
  ctxMenuContains,
  ctxTitle,
  hideCtxMenu,
  showCtxMenu,
} from "../../../lib/ui/context-menu.ts";
import { inlineEdit } from "../../../lib/ui/inline-edit.ts";
import { winListBtn, winPop } from "../foundation/elements.ts";
import { appendWindowIdentityItems, openMarkMenu, openRowMenu, openTabGroupMenu } from "../menus/menus.ts";
import { windowMaps } from "../model/index.ts";
import { refresh } from "../foundation/scheduler.ts";
import { keepAliveActive, pinActive, state, tabGroupsActive } from "../foundation/state.ts";
import { orderedWindowIds, windowLabel } from "../ops/window-ops.ts";
import { fillGroupRows, registerPopoverRefill, startRenameTabGroupInList } from "./groups.ts";
import { keepAliveEntry } from "../../../app/keep-alive.ts";
import { fillAliveRows } from "./alive.ts";
import { fillPinRows } from "./pins.ts";

type WinPopView = "windows" | "groups" | "pins" | "alive";
let winPopView: WinPopView = "windows"; // reset on ▦ open

// the Groups view sits below this module in the import graph — it refills through this
registerPopoverRefill(fillWindowsPopover);

export function initWindowsPopover(): void {
  // S2: windows list as a popover (same shell as the history popover) — one row
  // per window with dot, name and stats; click focuses the window, right-click
  // opens the window menu (popover closes first: the ctx menu is not in the
  // top layer and would render underneath it).
  winListBtn.addEventListener("click", () => {
    winPopView = "windows"; // every open starts on the Windows list
    // fresh open: re-derive the size lock from the Windows list
    winPop.style.minWidth = "";
    winPop.style.minHeight = "";
    fillWindowsPopover();
    // lock the opened size so switching to shorter Groups/Pins lists doesn't
    // shrink the box under the cursor (measure after the popover is shown —
    // the popovertarget default action runs after this listener)
    requestAnimationFrame?.(() => {
      if (winPopOpen() && winPop.offsetWidth > 0 && !winPop.style.minWidth) {
        winPop.style.minWidth = `${winPop.offsetWidth}px`;
        winPop.style.minHeight = `${winPop.offsetHeight}px`;
      }
    });
  });

  // popover="manual": no light dismiss — close on outside click, Escape (below,
  // shared with the ctx menu) and window blur; clicks in the ctx menu keep it open
  document.addEventListener("click", (event) => {
    const target = event.target as Node; // click events target DOM nodes
    // a click on popover content may REBUILD the popover before this handler
    // runs (view switch) — the detached target would read as "outside"
    if (!target.isConnected) {
      return;
    }
    if (
      winPopOpen() &&
      !winPop.contains(target) &&
      !winListBtn.contains(target) &&
      !ctxMenuContains(target) &&
      !askDialogContains(target)
    ) {
      winPop.hidePopover?.();
    }
  });

  winPop.addEventListener("contextmenu", (event) => {
    const row = closest(event.target, ".win-row");
    if (!row) {
      return;
    }
    event.preventDefault();
    // windows popover stays open behind — the ctx menu is a manual popover
    // shown after it, so it stacks above in the top layer
    if (row.dataset.tabGroupId) {
      openTabGroupMenu(event, Number(row.dataset.tabGroupId), startRenameTabGroupInList);
    } else if (row.dataset.tabId) {
      openRowMenu(event, Number(row.dataset.tabId));
    } else if (row.dataset.keepAliveUrl) {
      const mark = keepAliveEntry(state.keepAlive, row.dataset.keepAliveUrl);
      if (mark) {
        openMarkMenu(event, mark);
      }
    } else if (row.dataset.windowId) {
      openWindowListMenu(event, Number(row.dataset.windowId));
    }
  });
}

function fillWindowsPopover(): void {
  // anchored under the titlebar, right-aligned with the buttons
  const anchor = winListBtn.getBoundingClientRect();
  winPop.style.top = `${anchor.bottom + 4}px`;
  winPop.style.right = "0.5rem";
  winPop.style.left = "auto";
  const maps = windowMaps(state.allTabs, state.currentWindowId, state.windowMeta);
  const groupList = tabGroupsActive() ? [...state.tabGroups.values()] : [];
  const pinnedTabs = state.allTabs.filter((tab) => tab.pinned);
  const aliveMarks = keepAliveActive() ? state.keepAlive : [];
  // Pins and Alive views exist only while there is something to list; Groups shows
  // even empty — its "+ New group…" row is where the first group gets created
  const views: [view: WinPopView, label: string][] = [
    ["windows", `Windows (${maps.indexes.size})`],
    ...(tabGroupsActive() ? [["groups", `Groups (${groupList.length})`] satisfies [WinPopView, string]] : []),
    ...(pinnedTabs.length > 0 ? [["pins", `Pins (${pinnedTabs.length})`] satisfies [WinPopView, string]] : []),
    ...(aliveMarks.length > 0 ? [["alive", `Alive (${aliveMarks.length})`] satisfies [WinPopView, string]] : []),
  ];
  if (!views.some(([view]) => view === winPopView)) {
    winPopView = "windows"; // the shown view's last member vanished under us
  }
  winPop.textContent = "";

  const head = document.createElement("div");
  head.className = "win-head";
  if (views.length === 1) {
    // only Windows: a plain heading, nothing to switch to
    const heading = document.createElement("span");
    heading.className = "muted";
    heading.textContent = views[0]![1]; // views always starts with the Windows entry
    head.append(heading);
  } else {
    const bar = document.createElement("span");
    bar.className = "win-views";
    for (const [view, label] of views) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = view === winPopView ? "win-view on" : "win-view";
      btn.textContent = label;
      // no focus steal: a rename input must not blur (= commit) on the press, and
      // a refill mid-press would detach this button and swallow the click
      btn.addEventListener("mousedown", (event) => event.preventDefault());
      btn.addEventListener("click", (event) => {
        event.stopPropagation(); // the refill detaches this button — see click-away guard
        hideCtxMenu(); // stopPropagation above keeps the document click-away from doing it
        winPopView = view;
        // view switch cancels a rename in progress — Esc takes inlineEdit's cancel path
        document.querySelector(".rename-input")?.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
        fillWindowsPopover();
      });
      bar.append(btn);
    }
    head.append(bar);
  }
  const close = document.createElement("button");
  close.type = "button";
  close.className = "win-close";
  close.textContent = "Close";
  close.addEventListener("click", () => winPop.hidePopover?.());
  head.append(close);
  winPop.append(head);

  if (winPopView === "groups") {
    fillGroupRows(groupList);
    return;
  }
  if (winPopView === "pins") {
    fillPinRows(pinnedTabs, maps);
    return;
  }
  if (winPopView === "alive") {
    fillAliveRows(aliveMarks, state.allTabs, maps);
    return;
  }

  for (const windowId of orderedWindowIds(maps)) {
    const tabs = state.allTabs.filter((tab) => tab.windowId === windowId);
    const snoozed = tabs.filter((tab) => tab.discarded).length;
    const awake = tabs.length - snoozed; // filter-chip terminology: awake = not snoozed
    const row = document.createElement("button");
    row.type = "button";
    row.className = windowId === state.currentWindowId ? "win-row current" : "win-row";
    row.dataset.windowId = String(windowId); // right-click → window menu
    const dot = document.createElement("span");
    dot.className = "win-dot";
    const color = maps.dotColors.get(windowId);
    if (color) {
      dot.style.background = color;
    } else {
      dot.classList.add("current");
    }
    const name = document.createElement("span");
    name.className = "win-title";
    name.textContent = windowLabel(windowId);
    let pin: HTMLSpanElement | null = null;
    if (pinActive() && state.windowMeta.get(windowId)?.pinnedWindow) {
      pin = document.createElement("span");
      pin.className = "win-pin";
      pin.textContent = "📌";
      pin.title = "Pinned window";
    }
    const stats = document.createElement("span");
    stats.className = "win-stats muted";
    stats.textContent = `${tabs.length} tab${tabs.length === 1 ? "" : "s"} · ${awake} awake · ${snoozed} snoozed`;
    row.append(dot, name, ...(pin ? [pin] : []), stats);
    // native title, not #hover-tip: the popover lives in the top layer and
    // draws over any fixed-position tip; the browser tooltip renders above it
    const pinned = tabs.filter((tab) => tab.pinned).length;
    const audible = tabs.filter((tab) => tab.audible).length;
    const activeTab = tabs.find((tab) => tab.active);
    row.title = [
      name.textContent,
      `${tabs.length} tab${tabs.length === 1 ? "" : "s"} · ${awake} awake · ${snoozed} snoozed`,
      `${pinned} pinned · ${audible} audible`,
      activeTab ? `Active tab: ${activeTab.title || activeTab.url}` : null,
    ]
      .filter(Boolean)
      .join("\n");
    row.addEventListener("click", () => {
      winPop.hidePopover?.();
      chrome.windows.update(windowId, { focused: true }).catch(() => {});
    });
    // ⋯ beside the row (a button can't nest one) — same window menu as right-click
    const menuBtn = document.createElement("button");
    menuBtn.type = "button";
    menuBtn.className = "win-menu-btn";
    menuBtn.title = menuBtn.ariaLabel = "Window actions";
    menuBtn.textContent = "⋯";
    menuBtn.addEventListener("click", (event) => {
      event.stopPropagation();
      openWindowListMenu(event, windowId);
    });
    const item = document.createElement("div");
    item.className = "win-item";
    item.append(row, menuBtn);
    winPop.append(item);
  }
}

// renders happen on every tab/storage event — keep an open popover current,
// but never yank a rename input out from under the user
export function refillWindowsPopoverIfOpen(): void {
  if (winPopOpen() && !winPop.querySelector(".rename-input")) {
    fillWindowsPopover();
  }
}

export function winPopOpen(): boolean {
  try {
    return winPop.matches(":popover-open");
  } catch {
    return false; // happy-dom: selector unsupported
  }
}

// rename without leaving the windows popover: swap the row's name for the input
function startRenameWindowInList(windowId: number): void {
  const title = winPop.querySelector(`.win-row[data-window-id="${windowId}"] .win-title`);
  if (!title) {
    return;
  }
  inlineEdit(title, {
    initial: state.windowMeta.get(windowId)?.name ?? "",
    placeholder: "Window name",
    commit: (name) => send({ type: "window-rename", windowId, name }).catch(() => {}),
    finish: () => {
      fillWindowsPopover(); // fresh name in place, popover stays open
      refresh(false);
    },
  });
}

// windows-list rows get a window-scoped menu only — no tab bulk actions,
// no Tabs Order (those belong to the header of a visible tab group)
function openWindowListMenu(event: MouseEvent, windowId: number): void {
  clearCtxMenu();
  ctxAppend(ctxTitle(windowLabel(windowId)), ctxDivider());
  if (windowId !== state.currentWindowId) {
    ctxAppend(ctxItem("Focus window", () => chrome.windows.update(windowId, { focused: true })));
  }
  appendWindowIdentityItems(windowId, startRenameWindowInList);
  showCtxMenu(event);
}
