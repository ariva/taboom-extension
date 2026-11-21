// The Settings tabs: one pane of cards at a time. The URL hash is the state — a pane name
// (#tags) or the id of an element inside a pane (#rules-table opens Protected sites and scrolls
// to its card: the demo and the docs link that way). No stored preference: no hash means
// General. A pane whose every card a flag hid has no tab.
import { getElementById } from "../../lib/dom.ts";

const DEFAULT_PANE = "general";

function tabs(): HTMLButtonElement[] {
  return [...getElementById("settings-tabs").querySelectorAll<HTMLButtonElement>("[role=tab]")];
}

function paneOf(tab: HTMLButtonElement): HTMLElement {
  return getElementById(tab.getAttribute("aria-controls") ?? "");
}

function visibleTabs(): HTMLButtonElement[] {
  return tabs().filter((tab) => !tab.hidden);
}

function selectedTab(): HTMLButtonElement | undefined {
  return tabs().find((tab) => tab.getAttribute("aria-selected") === "true");
}

function select(name: string, target?: Element): void {
  for (const tab of tabs()) {
    const on = tab.dataset.pane === name;
    tab.setAttribute("aria-selected", String(on));
    tab.tabIndex = on ? 0 : -1; // roving tabindex: Tab lands on the selected one, arrows move
    paneOf(tab).hidden = !on;
  }
  // a deep link to an element: its card at the top. `as`: closest() returns Element; the card is an
  // HTMLElement, and happy-dom (the tests) has no scrollIntoView, hence the optional call
  if (target) {
    ((target.closest(".card") ?? target) as HTMLElement).scrollIntoView?.({ block: "start" });
  }
}

// the hash → the pane: a pane name wins (#tab-names is also a <tbody> id), else the pane
// holding the element; anything unknown or hidden by a flag reads as General
function resolve(hash: string): { name: string; target?: Element } {
  const key = hash.replace(/^#/, "");
  if (visibleTabs().some((tab) => tab.dataset.pane === key)) {
    return { name: key };
  }
  const element = key ? document.getElementById(key) : null;
  const pane = element?.closest<HTMLElement>(".pane");
  const tab = pane ? visibleTabs().find((candidate) => candidate.getAttribute("aria-controls") === pane.id) : undefined;
  return tab ? { name: tab.dataset.pane ?? DEFAULT_PANE, target: element ?? undefined } : { name: DEFAULT_PANE };
}

function applyHash(): void {
  const { name, target } = resolve(window.location.hash);
  select(name, target);
}

// a click or an arrow key: the pane shows at once, the hash follows (Back returns to the previous pane)
function go(name: string): void {
  select(name);
  if (window.location.hash !== `#${name}`) {
    window.location.hash = name;
  }
}

const KEY_STEP: Record<string, number> = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 };

export function initSettingsTabs(): void {
  const strip = getElementById("settings-tabs");
  strip.addEventListener("click", (event) => {
    const tab = (event.target as Element | null)?.closest<HTMLButtonElement>("[role=tab]");
    if (tab?.dataset.pane) {
      go(tab.dataset.pane);
    }
  });
  strip.addEventListener("keydown", (event) => {
    const shown = visibleTabs();
    const current = shown.findIndex((tab) => tab.getAttribute("aria-selected") === "true");
    let next: number | undefined;
    if (event.key in KEY_STEP) {
      next = (current + (KEY_STEP[event.key] ?? 0) + shown.length) % shown.length; // wraps at both ends
    } else if (event.key === "Home") {
      next = 0;
    } else if (event.key === "End") {
      next = shown.length - 1;
    }
    const tab = next === undefined ? undefined : shown[next];
    if (tab?.dataset.pane) {
      event.preventDefault();
      go(tab.dataset.pane);
      tab.focus();
    }
  });
  window.addEventListener("hashchange", applyHash);
  applyHash();
}

// after a render: a tab shows while its pane has a visible card (a flag hides whole cards); the
// selected pane losing its last card falls back to General
export function syncSettingsTabs(): void {
  for (const tab of tabs()) {
    const cards = [...paneOf(tab).querySelectorAll<HTMLElement>(":scope > .card")];
    tab.hidden = cards.length > 0 && cards.every((card) => card.hidden);
  }
  if (selectedTab()?.hidden) {
    go(DEFAULT_PANE);
  }
}
