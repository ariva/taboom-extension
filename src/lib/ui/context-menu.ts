// Generic popover menu (#ctx-menu): show/hide, items, titles, dividers,
// hover-intent accordion submenus with flyout placement, and the keys that walk it.
// What a menu CONTAINS is the caller's business — builders fill it through clearCtxMenu / ctxAppend.

// right-click on a row: in-page menu moving the tab (or the selection, when
// the clicked row is part of it) to another window / a new window
const ctxMenu = document.createElement("div");
ctxMenu.id = "ctx-menu";
ctxMenu.hidden = true;
// manual popover: promoted to the top layer so it can sit ABOVE the windows
// popover (plain z-index never beats the top layer). "manual" = no light
// dismiss, our own click-away/Escape handlers keep working.
ctxMenu.setAttribute("popover", "manual");
ctxMenu.setAttribute("role", "menu");
document.body.append(ctxMenu);

// submenu toggle → how to fold / unfold it, and whether a click on it is the toggle's own action
const toggles = new WeakMap<Element, { setOpen: (open: boolean) => void; ownAction: boolean }>();
// what had focus before the keyboard took it into the menu: it gets it back when the menu closes
let returnFocus: HTMLElement | null = null;

// set by showCtxMenu: whether the menu may stay open across a host render — a toolbar menu
// always (() => true), a list-bound menu while every row it names is still there; a menu
// shown without it closes on the first render (its ids may be stale)
let staysWhile: (() => boolean) | null = null;

export function hideCtxMenu(): void {
  const back = returnFocus;
  returnFocus = null;
  // focus the user moved elsewhere meanwhile (a click into the search) is theirs to keep
  const focusInside = ctxMenu.contains(document.activeElement);
  ctxMenu.hidden = true;
  try {
    ctxMenu.hidePopover();
  } catch {
    // not open / no popover API (tests) — the hidden attr already did the job
  }
  if (back && focusInside) {
    back.focus();
  }
}

// the host re-rendered what the menu may refer to: close it, unless its staysWhile still holds
export function hideCtxMenuForRender(): void {
  if (!staysWhile?.()) {
    hideCtxMenu();
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
  staysWhile = null;
}

export function ctxAppend(...nodes: (Node | string)[]): void {
  ctxMenu.append(...nodes);
}

export function ctxItem(label: string, run: () => void): HTMLButtonElement {
  const item = document.createElement("button");
  item.className = "ctx-item";
  item.setAttribute("role", "menuitem");
  item.textContent = label;
  item.addEventListener("click", () => {
    hideCtxMenu();
    run();
  });
  return item;
}

// "<label> ▸" toggle + nested dropdown: hover auto-expands, click toggles — or, with `onClick`,
// the click is the parent's own action (the menu closes) and only hover opens the dropdown.
// Accordion: opening one folds the menu's other submenus; wandering over
// plain items leaves it open (deliberate — see ctx menu handlers below)
const SUBMENU_HOVER_DELAY_MS = 500;

export function ctxSubmenu(label: string, onClick?: () => void): { btn: HTMLButtonElement; submenu: HTMLDivElement } {
  const btn = document.createElement("button");
  btn.className = "ctx-item ctx-move";
  btn.setAttribute("role", "menuitem");
  btn.setAttribute("aria-haspopup", "menu");
  btn.setAttribute("aria-expanded", "false");
  const caret = document.createElement("span");
  caret.className = "ctx-caret";
  caret.textContent = "▸";
  btn.append(`${label} `, caret); // caret pushed right via CSS for breathing room
  const submenu = document.createElement("div");
  submenu.className = "ctx-submenu";
  submenu.setAttribute("role", "menu");
  submenu.hidden = true;
  // caret mirrors the expanded state: ▸ folded, ▾ open (like group headers)
  const setOpen = (open: boolean): void => {
    if (open) {
      for (const other of ctxMenu.querySelectorAll<HTMLElement>(".ctx-submenu")) {
        if (other !== submenu && !other.hidden) {
          other.hidden = true;
          other.previousElementSibling?.setAttribute("aria-expanded", "false");
          const otherCaret = other.previousElementSibling?.querySelector(".ctx-caret");
          if (otherCaret) {
            otherCaret.textContent = "▸";
          }
        }
      }
    }
    submenu.hidden = !open;
    btn.setAttribute("aria-expanded", String(open));
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
    clearTimeout(hoverTimer); // a pending hover-open must not undo a click-fold
    if (onClick) {
      hideCtxMenu();
      onClick();
      return;
    }
    clickEvent.stopPropagation(); // the document click-away handler must not close the menu
    setOpen(submenu.hidden as boolean); // only ever set to a boolean here ("until-found" unused)
  });
  // hover intent: a cursor traveling past the toggle (e.g. down to Focus
  // window) must not expand it — open only after it settles for a beat
  btn.addEventListener("mouseenter", () => {
    hoverTimer = setTimeout(() => setOpen(true), SUBMENU_HOVER_DELAY_MS);
  });
  btn.addEventListener("mouseleave", () => clearTimeout(hoverTimer));
  toggles.set(btn, { setOpen, ownAction: onClick !== undefined });
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
// like a small panel rather than a right-click menu. `staysWhile`: see hideCtxMenuForRender
export function showCtxMenu(
  at: Pick<MouseEvent, "clientX" | "clientY">,
  closeLabel?: string,
  options: { staysWhile?: () => boolean } = {},
): void {
  staysWhile = options.staysWhile ?? null;
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

// ---------- keyboard ----------

// the enabled items of one level: the menu's own (null), or one open submenu's
function levelItems(level: Element | null): HTMLButtonElement[] {
  const items = (level ?? ctxMenu).querySelectorAll<HTMLButtonElement>("button.ctx-item:not(:disabled)");
  return [...items].filter((item) => item.closest(".ctx-submenu") === level);
}

function focusItem(item: HTMLElement | undefined): void {
  // `as`: activeElement is typed Element; whatever holds focus in a page can take it back
  const active = document.activeElement as HTMLElement | null;
  if (active && !ctxMenu.contains(active)) {
    returnFocus = active;
  }
  item?.focus();
}

// a menu opened from the keyboard: its first item takes focus, so Enter and the arrows work at once
export function focusCtxMenu(): void {
  if (!ctxMenu.hidden) {
    focusItem(levelItems(null)[0]);
  }
}

// Capture phase, and the handled keys stop here: the host's own arrow / Enter handlers (a row
// cursor behind the menu) must not act on a key the open menu took. Escape is the host's.
document.addEventListener(
  "keydown",
  (event) => {
    if (ctxMenu.hidden) {
      return;
    }
    const active = document.activeElement;
    const inside = active !== null && ctxMenu.contains(active);
    const level = inside ? active.closest(".ctx-submenu") : null;
    const items = levelItems(level);
    const candidates: readonly Element[] = items; // widened: activeElement is typed Element
    const index = inside ? candidates.indexOf(active) : -1;
    const toggle = inside ? toggles.get(active) : undefined;
    const entersSubmenu = event.key === "ArrowRight" || (event.key === "Enter" && toggle?.ownAction === false);
    let target: HTMLElement | undefined;
    if (event.key === "ArrowDown") {
      target = items[(index + 1) % items.length];
    } else if (event.key === "ArrowUp") {
      target = items[(index <= 0 ? items.length : index) - 1];
    } else if (inside && event.key === "Home") {
      target = items[0];
    } else if (inside && event.key === "End") {
      target = items.at(-1);
    } else if (toggle && entersSubmenu) {
      toggle.setOpen(true);
      target = levelItems(active?.nextElementSibling ?? null)[0];
    } else if (level && event.key === "ArrowLeft") {
      const parent = level.previousElementSibling;
      toggles.get(parent ?? level)?.setOpen(false);
      // `as`: a submenu's previous sibling is its toggle button (ctxSubmenu's caller appends the pair)
      target = (parent as HTMLElement | null) ?? undefined;
    } else if (inside && (event.key === "Enter" || event.key === " ")) {
      event.stopPropagation(); // the item's own click (the key's default) is the whole effect
      return;
    } else {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    focusItem(target);
  },
  true,
);
