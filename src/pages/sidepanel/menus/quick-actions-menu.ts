// The titlebar's ☰ menu: Open Settings and Cleanup Duplicates ("There can be only one"
// over every duplicated page). Items carry an icon — the shared ctx menu is text-only
// elsewhere, so the svg is prepended here.
import { duplicatesToClose } from "../../../app/duplicates.ts";
import { clearCtxMenu, ctxAppend, ctxDivider, ctxItem, ctxTitle, showCtxMenu } from "../../../lib/ui/context-menu.ts";
import { duplicatesActive } from "../foundation/state.ts";
import { allDuplicateSets, cleanupAllDuplicates, keeperContext } from "../ops/duplicate-ops.ts";

const GEAR =
  '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/>';
// two overlapping pages, the front one struck: "copies, one goes". Drawn edge to edge
// (2..22) like the gear so the two icons read the same size at the same box
const DUPES =
  '<rect x="10" y="10" width="12" height="12" rx="2"/><path d="M16 10V4a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h6"/><path d="M13.5 13.5l5 5M18.5 13.5l-5 5"/>';

function iconItem(icon: string, label: string, run: () => void): HTMLButtonElement {
  const item = ctxItem(label, run);
  item.classList.add("ctx-icon-item");
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("fill", "none");
  svg.setAttribute("stroke", "currentColor");
  svg.setAttribute("stroke-width", "2");
  svg.setAttribute("stroke-linecap", "round");
  svg.setAttribute("stroke-linejoin", "round");
  svg.innerHTML = icon; // constant markup from this file, never user data
  item.prepend(svg);
  return item;
}

export function openQuickActionsMenu(at: Pick<MouseEvent, "clientX" | "clientY">): void {
  clearCtxMenu();
  // a title like every other menu: names the menu and keeps the first item clear of the ✕
  ctxAppend(ctxTitle("Quick actions"), ctxDivider());
  ctxAppend(iconItem(GEAR, "Open Settings", () => chrome.runtime.openOptionsPage()));
  if (duplicatesActive()) {
    const sets = allDuplicateSets();
    const count = sets.reduce((sum, set) => sum + duplicatesToClose(set, "one", keeperContext()).length, 0);
    const item = iconItem(
      DUPES,
      count > 0 ? `Cleanup Duplicates (${count})` : "Cleanup Duplicates",
      cleanupAllDuplicates,
    );
    item.disabled = count === 0;
    item.title =
      count > 0
        ? "There can be only one: keep one copy of every duplicated page, close the rest (New Tab: one per window; pinned copies stay)"
        : "No page is open more than once";
    ctxAppend(item);
  }
  showCtxMenu(at, "Close"); // a small panel, not a right-click menu: text Close like the quick launch
}
