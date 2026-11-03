// Pure: which window the panel shows as current when Chrome's focus record and the panel's own
// knowledge disagree.
//
// On Linux a window on another workspace is focused through the window manager. Chrome's record
// (windows.getLastFocused, windows.onFocusChanged) can then name the window last used on that
// workspace — and keep naming it until a real click on another window and back: the panel there
// would mark that window and its tab current. The panel knows better twice: it knows which window
// it asked for, and a press inside a panel proves its own window focused.
import type { FocusHint } from "../../../app/types.ts";

// the window manager's switch, with its focus events, is over by then: a later focus change is real
export const FOCUS_SETTLE_MS = 1000;

const WINDOW_ID_NONE = -1; // chrome.windows.WINDOW_ID_NONE, spelled out: this module stays chrome-free

// windows.onFocusChanged while a hint is shown as current: keep showing it? A change inside the
// settle window is the window manager's dance; a later one is the user moving focus for real.
// (Chrome naming the hinted window needs no rule here: the refresh that follows every focus
// change drops a hint its record agrees with.)
export function hintSurvives(hint: FocusHint, reportedWindowId: number, now: number): boolean {
  return reportedWindowId === WINDOW_ID_NONE || now - hint.at <= FOCUS_SETTLE_MS;
}
