// "Restore last removal (N things)" with a tooltip naming what comes back — the three cards'
// Restore buttons share one shape (hidden while the undo stack is empty)
const TOOLTIP_NAMES = 10; // a Remove all of hundreds must not become a screen-high tooltip

export function renderRestoreButton(button: HTMLButtonElement, what: string | null, names: string[]): void {
  button.hidden = what === null;
  if (what === null) {
    return;
  }
  button.textContent = `Restore last removal (${what})`;
  button.title = ["Restore:", ...names.slice(0, TOOLTIP_NAMES), ...(names.length > TOOLTIP_NAMES ? ["…"] : [])].join(
    "\n",
  );
}
