// Tab history navigation: back / forward buttons, the history popover (list, long-press
// and right-click open), and the panel's focus / blur announcements.
import { send } from "../../../app/messages.ts";
import { localStore } from "../../../app/storage.ts";
import type { TabHistory, UiPrefs } from "../../../app/types.ts";
import { getElementById } from "../../../lib/dom.ts";
import { winPop } from "../foundation/elements.ts";
import { windowMaps } from "../model/index.ts";
import { faviconImg } from "../render/row.ts";
import { state } from "../foundation/state.ts";

// row action icons live in #row-template now; this one is for the history popover
const ICONS = {
  close:
    '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M4 4l8 8M12 4l-8 8"/></svg>',
};

// ---------- tab history nav (back / forward across tabs) ----------

const histBack = getElementById("hist-back");
const histForward = getElementById("hist-forward");
const histListBtn = getElementById("hist-list-btn");
const histPop = getElementById("history-pop");

export function isPopoverOpen(): boolean {
  try {
    return histPop.matches(":popover-open");
  } catch {
    return false; // happy-dom: selector unsupported
  }
}

async function getTabHistory(): Promise<TabHistory> {
  const { tabHistory } = await localStore.get("tabHistory");
  return tabHistory ?? { stack: [], cursor: -1 };
}

async function syncHistoryButtons(): Promise<void> {
  const { stack, cursor } = await getTabHistory();
  histBack.disabled = cursor <= 0;
  histForward.disabled = cursor >= stack.length - 1;
}

async function fillHistoryPopover(): Promise<void> {
  // anchor just below the nav buttons, left-aligned (CSS anchor positioning needs Chrome 125+)
  const anchor = histForward.parentElement!.getBoundingClientRect(); // static markup: the button sits in the nav bar
  histPop.style.top = `${anchor.bottom + 4}px`;
  histPop.style.left = `${Math.max(4, anchor.left)}px`;
  const { stack, cursor } = await getTabHistory();
  const allTabs = await chrome.tabs.query({});
  const byId = new Map(allTabs.map((t) => [t.id, t]));
  const { dotColors } = windowMaps(allTabs, state.currentWindowId, state.windowMeta);
  histPop.textContent = "";

  const head = document.createElement("div");
  head.className = "hist-head";
  const heading = document.createElement("span");
  heading.className = "muted";
  heading.textContent = state.navMode === "compact" ? "Compact Navigation History" : "Navigation History";
  // text label, not an X: the per-entry X buttons mean "remove entry" — the
  // popup's own dismiss must not look like one of them
  const close = document.createElement("button");
  close.type = "button";
  close.className = "hist-close";
  close.textContent = "Close";
  close.addEventListener("click", () => histPop.hidePopover?.());
  head.append(heading, close);
  histPop.append(head);
  if (stack.length === 0) {
    const empty = document.createElement("div");
    empty.className = "muted";
    empty.textContent = "No tab history yet.";
    histPop.append(empty);
    return;
  }
  // newest on top; numbering counts from the oldest, so #1 sits at the bottom
  for (let index = stack.length - 1; index >= 0; index--) {
    const tab = byId.get(stack[index]);
    const row = document.createElement("button");
    row.type = "button";
    row.className = index === cursor ? "hist-row current" : "hist-row";

    const num = document.createElement("span");
    num.className = "hist-num muted";
    num.textContent = String(index + 1);

    const icon = document.createElement("span");
    icon.className = "favicon";
    if (tab?.url) {
      icon.append(faviconImg(tab.url));
    }

    const title = document.createElement("span");
    title.className = "hist-title";
    title.textContent = tab ? tab.title || tab.url! : "(closed tab)"; // "tabs" permission: url is always set

    row.append(num, icon, title);
    if (dotColors.size > 0 && tab) {
      const dot = document.createElement("span");
      dot.className = "win-dot";
      const color = dotColors.get(tab.windowId);
      if (color) {
        dot.style.background = color;
      } else {
        dot.classList.add("current");
      }
      row.insertBefore(dot, icon);
    }
    row.addEventListener("click", () => {
      send({ type: "history-jump", index });
      histPop.hidePopover?.();
    });

    // per-entry remove; the tabHistory storage echo live-refreshes the open
    // popup, so indexes stay correct after each removal. Sibling of the row
    // button — buttons can't nest.
    const removeBtn = document.createElement("button");
    removeBtn.type = "button";
    removeBtn.className = "icon-btn hist-x";
    removeBtn.title = removeBtn.ariaLabel = "Remove from history";
    removeBtn.innerHTML = ICONS.close;
    removeBtn.addEventListener("click", () => {
      send({ type: "history-remove", index }).catch(() => {});
    });

    const item = document.createElement("div");
    item.className = "hist-item";
    item.append(row, removeBtn);
    histPop.append(item);
  }
}

// Browser back-button behavior: right-click OR long-press an arrow opens the
// history list. Both open on pointerup, never mid-gesture: the gesture's own
// remaining pointer events otherwise light-dismiss the popover the instant it
// shows. The hold timer only ARMS the long-press; release opens.
const LONG_PRESS_MS = 500;
let longPressTimer: ReturnType<typeof setTimeout> | undefined;
let longPressArmed = false;
// openness at gesture START: native light dismiss may close the popup on the
// pointerdown itself, so by pointerup it always reads closed — without this
// snapshot a right-click on an arrow would close-then-instantly-reopen
let popoverWasOpen = false;

// click fires right after the opening pointerup — swallow exactly one
function consumeLongPress(): boolean {
  const armed = longPressArmed;
  longPressArmed = false;
  return armed;
}

async function openHistoryPopover(): Promise<void> {
  await fillHistoryPopover();
  try {
    histPop.showPopover?.();
  } catch {} // already open
}

export function initHistoryNav(): void {
  // Focus tracking: losing focus (user clicked into the page or another window)
  // closes any open popup; both transitions are announced — no consumer yet,
  // hook points for future focus-aware behavior.
  window.addEventListener("focus", () => {
    send({ type: "sidebar-focused" }).catch(() => {}); // SW may be asleep
  });
  window.addEventListener("blur", () => {
    try {
      histPop.hidePopover?.();
    } catch {} // already hidden
    try {
      winPop.hidePopover?.();
    } catch {} // already hidden
    send({ type: "sidebar-no-focus" }).catch(() => {});
  });

  // navigation mode switched (options page, any window): close an open popup —
  // its rows and header belong to the previous mode. storage.onChanged already
  // broadcasts to every panel, so no extra message plumbing is needed.
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "local" || !changes.ui) {
      return;
    }
    // storage values are untyped — the ui key holds (possibly partial) UiPrefs
    const oldNav = (changes.ui.oldValue as Partial<UiPrefs> | undefined)?.historyNav;
    const newNav = (changes.ui.newValue as Partial<UiPrefs> | undefined)?.historyNav;
    if (oldNav !== newNav) {
      try {
        histPop.hidePopover?.();
      } catch {} // already hidden
    }
  });

  // caret flips while the popover is open; the toggle event fires on every close
  // path (button click, light dismiss, Esc), so the icon can't get stuck
  histPop.addEventListener("toggle", (event) => {
    const open = event.newState === "open";
    histListBtn.classList.toggle("open", open);
    histListBtn.title = histListBtn.ariaLabel = open ? "Hide Navigation History" : "Show Navigation History";
  });

  histBack.addEventListener("click", () => {
    if (consumeLongPress()) {
      return; // the hold opened the popover; don't also navigate
    }
    send({ type: "history-back" });
  });
  histForward.addEventListener("click", () => {
    if (consumeLongPress()) {
      return;
    }
    send({ type: "history-forward" });
  });

  // populate on open (popovertarget handles show/hide natively)
  histListBtn.addEventListener("click", fillHistoryPopover);

  for (const arrow of [histBack, histForward]) {
    arrow.addEventListener("contextmenu", (event) => event.preventDefault());
    arrow.addEventListener("pointerdown", (event) => {
      popoverWasOpen = isPopoverOpen(); // any button — before light dismiss races us
      if (event.button !== 0) {
        return;
      }
      longPressArmed = false;
      clearTimeout(longPressTimer);
      longPressTimer = setTimeout(() => (longPressArmed = true), LONG_PRESS_MS);
    });
    for (const type of ["pointerleave", "pointercancel"]) {
      arrow.addEventListener(type, () => clearTimeout(longPressTimer));
    }
    arrow.addEventListener("pointerup", async (event) => {
      clearTimeout(longPressTimer);
      if (event.button !== 2 && !(event.button === 0 && longPressArmed)) {
        return;
      }
      // toggle: popup was open when the gesture started → this gesture closes it
      if (popoverWasOpen) {
        try {
          histPop.hidePopover?.();
        } catch {} // light dismiss already closed it
        return;
      }
      await openHistoryPopover();
    });
  }

  syncHistoryButtons();
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "local" || !changes.tabHistory) {
      return;
    }
    syncHistoryButtons();
    // popover open (in THIS panel — every window's panel gets this event, so all
    // open popups converge on the same trail): live-refresh its rows
    if (isPopoverOpen()) {
      fillHistoryPopover();
    }
  });
}
