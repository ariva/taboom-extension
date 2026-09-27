// The one highlighted drop target, shared by the list's tab drag & drop and the windows
// popover's group reorder (only one drag runs at a time).
let dropTargetEl: HTMLElement | null = null;

export function clearDropTarget(): void {
  dropTargetEl?.classList.remove("drop-target");
  dropTargetEl = null;
}

// highlight `el` as the drop target — nothing to do while it already is
export function markDropTarget(el: HTMLElement | null): void {
  if (el !== dropTargetEl) {
    clearDropTarget();
    dropTargetEl = el;
    dropTargetEl?.classList.add("drop-target");
  }
}
