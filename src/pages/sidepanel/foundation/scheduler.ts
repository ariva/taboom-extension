// Dependency inversion for the two calls nearly every feature makes: render() and
// refresh(). main.ts registers the real ones once at boot; features import these thin
// forwarders instead of render.ts / data.ts, so the renderer and the features never cycle.
import type { AppState } from "../../../app/types.ts";

export interface Panel {
  render: (animate?: boolean) => void;
  refresh: (animate?: boolean, preloaded?: AppState | null) => Promise<void>;
}

let panel: Panel | null = null;

export function registerPanel(implementation: Panel): void {
  panel = implementation;
}

function registered(): Panel {
  if (!panel) {
    throw new Error("registerPanel() has not run yet");
  }
  return panel;
}

// A hidden panel (its window minimized or on another workspace) does no DOM work: every render or
// refresh asked for meanwhile becomes ONE refresh, HIDDEN_REFRESH_MS after the last ask or at once
// when the panel is shown. Every open panel runs on the extension process's one main thread, so
// the hidden ones' 1100-row renders were what made a click in the visible one wait (T-0150).
// `typeof document`: the scheduler's unit test runs without a DOM.
export const HIDDEN_REFRESH_MS = 10_000;
let hiddenTimer: ReturnType<typeof setTimeout> | undefined;
let flushing = false; // the coalesced refresh is running: its own render passes the gate

function deferredWhileHidden(): boolean {
  if (flushing || typeof document === "undefined" || !document.hidden) {
    return false;
  }
  clearTimeout(hiddenTimer);
  hiddenTimer = setTimeout(flushHidden, HIDDEN_REFRESH_MS);
  return true;
}

function flushHidden(): void {
  clearTimeout(hiddenTimer);
  hiddenTimer = undefined;
  flushing = true;
  registered()
    .refresh()
    .finally(() => {
      flushing = false;
    });
}

if (typeof document !== "undefined") {
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden && hiddenTimer !== undefined) {
      flushHidden();
    }
  });
}

// same signature and defaults as render.ts's render (an omitted argument stays omitted)
export function render(animate?: boolean): void {
  if (deferredWhileHidden()) {
    return;
  }
  registered().render(animate);
}

// same signature and defaults as data.ts's refresh
export function refresh(animate?: boolean, preloaded?: AppState | null): Promise<void> {
  if (deferredWhileHidden()) {
    return Promise.resolve();
  }
  return registered().refresh(animate, preloaded);
}
