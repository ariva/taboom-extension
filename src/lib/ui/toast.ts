// Transient status message: toast(message) shows the page's #toast element and
// hides it again after a few seconds.
import { getElementById } from "../dom.ts";

let toastTimer: ReturnType<typeof setTimeout> | undefined;
export function toast(message: string): void {
  const el = getElementById("toast");
  el.textContent = message;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (el.hidden = true), 5000);
}
