// Shared options-page state: the loaded feature flags, the "Saved" pill flash and the
// render() forwarder. main.ts sets / registers them once at boot; the feature modules
// import from here instead of main.ts, so the renderer and the features never cycle.
import type { Features } from "../../app/types.ts";
import { getElementById } from "../../lib/dom.ts";

let features: Features | null = null;
let renderPage: (() => Promise<void>) | null = null;

export function setFeatures(loaded: Features): void {
  features = loaded;
}

// the raw flags of features.json (before the experimental opt-in is applied)
export function getFeatures(): Features {
  if (!features) {
    throw new Error("setFeatures() has not run yet");
  }
  return features;
}

export function registerRender(implementation: () => Promise<void>): void {
  renderPage = implementation;
}

// re-reads the stored state and re-renders the whole page (main.ts's render)
export function render(): Promise<void> {
  if (!renderPage) {
    throw new Error("registerRender() has not run yet");
  }
  return renderPage();
}

let savedTimer: ReturnType<typeof setTimeout> | undefined;
export function flashSaved() {
  const el = getElementById("saved");
  el.hidden = false;
  clearTimeout(savedTimer);
  savedTimer = setTimeout(() => (el.hidden = true), 1200);
}
