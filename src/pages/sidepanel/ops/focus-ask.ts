// Asking Chrome to focus a window, and living with a focus record that may not follow (Linux
// workspaces — see model/focus-intent.ts): every ask is recorded as the hint all panels show as
// current.
import { sessionStore } from "../../../app/storage.ts";
import { state } from "../foundation/state.ts";

// after chrome.windows.update(windowId, { focused: true }) — or a press that proved windowId
// focused: this panel shows it as current at once, the other panels through storage.session
export function askFocus(windowId: number): void {
  state.focusHint = { windowId, at: Date.now() };
  state.currentWindowId = windowId;
  sessionStore.set({ focusHint: state.focusHint });
}
