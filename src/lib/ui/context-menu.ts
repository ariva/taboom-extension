// Generic popover menu (#ctx-menu): show/hide, items, titles, dividers and
// hover-intent accordion submenus with flyout placement. What a menu CONTAINS is
// the caller's business — builders fill it through clearCtxMenu / ctxAppend.

// right-click on a row: in-page menu moving the tab (or the selection, when
// the clicked row is part of it) to another window / a new window
const ctxMenu = document.createElement("div");
ctxMenu.id = "ctx-menu";
ctxMenu.hidden = true;
// manual popover: promoted to the top layer so it can sit ABOVE the windows
// popover (plain z-index never beats the top layer). "manual" = no light
// dismiss, our own click-away/Escape handlers keep working.
ctxMenu.setAttribute("popover", "manual");
document.body.append(ctxMenu);

export function hideCtxMenu(): void {
  ctxMenu.hidden = true;
  try {
    ctxMenu.hidePopover();
  } catch {
    // not open / no popover API (tests) — the hidden attr already did the job
  }
}

export function isCtxMenuOpen(): boolean {
  return !ctxMenu.hidden;
}

// click-away guards: is this event target inside the menu?
export function ctxMenuContains(target: Node | null): boolean {
  return ctxMenu.contains(target);
}

// menu builders start from an empty menu, append their items, then showCtxMenu()
export function clearCtxMenu(): void {
  ctxMenu.textContent = "";
}

export function ctxAppend(...nodes: (Node | string)[]): void {
  ctxMenu.append(...nodes);
}

export function ctxItem(label: string, run: () => void): HTMLButtonElement {
  const item = document.createElement("button");
  item.className = "ctx-item";
  item.textContent = label;
  item.addEventListener("click", () => {
    hideCtxMenu();
    run();
  });
  return item;
}

// "<label> ▸" toggle + nested dropdown: hover auto-expands, click toggles.
// Accordion: opening one folds the menu's other submenus; wandering over
// plain items leaves it open (deliberate — see ctx menu handlers below)
const SUBMENU_HOVER_DELAY_MS = 500;

export function ctxSubmenu(label: string): { btn: HTMLButtonElement; submenu: HTMLDivElement } {
  const btn = document.createElement("button");
  btn.className = "ctx-item ctx-move";
  const caret = document.createElement("span");
  caret.className = "ctx-caret";
  caret.textContent = "▸";
  btn.append(`${label} `, caret); // caret pushed right via CSS for breathing room
  const submenu = document.createElement("div");
  submenu.className = "ctx-submenu";
  submenu.hidden = true;
  // caret mirrors the expanded state: ▸ folded, ▾ open (like group headers)
  const setOpen = (open: boolean): void => {
    if (open) {
      for (const other of ctxMenu.querySelectorAll<HTMLElement>(".ctx-submenu")) {
        if (other !== submenu && !other.hidden) {
          other.hidden = true;
          const otherCaret = other.previousElementSibling?.querySelector(".ctx-caret");
          if (otherCaret) {
            otherCaret.textContent = "▸";
          }
        }
      }
    }
    submenu.hidden = !open;
    caret.textContent = open ? "▾" : "▸";
    if (open) {
      position(); // after unhide — offsetWidth/Height need layout
    }
  };
  // flyout placement: right of the menu (A), flip left when tight (A),
  // pinned to the panel's right edge over the menu as last resort (B)
  const position = (): void => {
    const menuRect = ctxMenu.getBoundingClientRect();
    const btnRect = btn.getBoundingClientRect();
    const width = submenu.offsetWidth;
    const height = submenu.offsetHeight;
    let left = menuRect.right - 2; // slight overlap: no hover gap to cross
    if (left + width > window.innerWidth - 4) {
      const flipped = menuRect.left - width + 2;
      left = flipped >= 4 ? flipped : Math.max(4, window.innerWidth - width - 4);
    }
    const top = Math.max(4, Math.min(btnRect.top, window.innerHeight - height - 4));
    submenu.style.left = `${left}px`;
    submenu.style.top = `${top}px`;
  };
  let hoverTimer: ReturnType<typeof setTimeout> | undefined;
  btn.addEventListener("click", (clickEvent) => {
    clickEvent.stopPropagation(); // the document click-away handler must not close the menu
    clearTimeout(hoverTimer); // a pending hover-open must not undo a click-fold
    setOpen(submenu.hidden as boolean); // only ever set to a boolean here ("until-found" unused)
  });
  // hover intent: a cursor traveling past the toggle (e.g. down to Focus
  // window) must not expand it — open only after it settles for a beat
  btn.addEventListener("mouseenter", () => {
    hoverTimer = setTimeout(() => setOpen(true), SUBMENU_HOVER_DELAY_MS);
  });
  btn.addEventListener("mouseleave", () => clearTimeout(hoverTimer));
  return { btn, submenu };
}

export function ctxTitle(text: string): HTMLDivElement {
  const title = document.createElement("div");
  title.className = "ctx-title";
  title.textContent = text;
  return title;
}

export function ctxDivider(): HTMLDivElement {
  const divider = document.createElement("div");
  divider.className = "ctx-divider";
  return divider;
}

// `at`: the pointer event, or a plain {clientX, clientY} for a menu anchored to a button.
// `closeLabel`: a text button ("Close") instead of the corner X — for menus that behave
// like a small panel rather than a right-click menu
export function showCtxMenu(at: Pick<MouseEvent, "clientX" | "clientY">, closeLabel?: string): void {
  // every menu build ends here — stamp the close control in the top-right corner
  const close = document.createElement("button");
  close.type = "button";
  close.className = closeLabel ? "ctx-close ctx-close-text" : "ctx-close";
  close.title = close.ariaLabel = "Close menu";
  if (closeLabel) {
    close.textContent = closeLabel;
  } else {
    close.innerHTML =
      '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M4 4l8 8M12 4l-8 8"/></svg>';
  }
  close.addEventListener("click", hideCtxMenu);
  ctxMenu.prepend(close);
  ctxMenu.hidden = false;
  try {
    ctxMenu.showPopover();
  } catch {
    // already open / no popover API (tests) — visible via hidden=false anyway
  }
  ctxMenu.style.left = `${Math.max(0, Math.min(at.clientX, window.innerWidth - ctxMenu.offsetWidth - 4))}px`;
  ctxMenu.style.top = `${Math.max(0, Math.min(at.clientY, window.innerHeight - ctxMenu.offsetHeight - 4))}px`;
}

// cursor wandering back up to the plain actions folds the Move-to dropdown
// (mirrors the hover that opened it)
// an expanded submenu stays expanded while the cursor visits plain items —
// only opening another submenu (accordion in ctxSubmenu) or closing the menu folds it

document.addEventListener("click", hideCtxMenu);
window.addEventListener("blur", hideCtxMenu); // focus left for another window/tab
