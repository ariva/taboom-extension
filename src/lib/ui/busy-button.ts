// A button whose click awaits a write: it is disabled from the click until the work settles,
// so a double-click runs the work once (a second Restore would pop the next removal too).
// The host's re-render may set `disabled` as it likes afterwards; the release only undoes its own.
export function onBusyClick(button: HTMLButtonElement, run: () => Promise<unknown>): void {
  button.addEventListener("click", async () => {
    if (button.disabled) {
      return; // a synthetic click can reach a disabled button; a real one never does
    }
    button.disabled = true;
    try {
      await run();
    } finally {
      button.disabled = false;
    }
  });
}
