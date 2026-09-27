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

// same signature and defaults as render.ts's render (an omitted argument stays omitted)
export function render(animate?: boolean): void {
  registered().render(animate);
}

// same signature and defaults as data.ts's refresh
export function refresh(animate?: boolean, preloaded?: AppState | null): Promise<void> {
  return registered().refresh(animate, preloaded);
}
