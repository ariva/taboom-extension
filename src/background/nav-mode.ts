// Feature flags and the resolved navigation mode, both cached per worker life.
import { applyExperimental, resolveNavMode } from "../app/core.ts";
import { loadFeatures, loadState } from "../app/storage.ts";
import type { AppState, Features, NavMode } from "../app/types.ts";

// features.json can't change without an extension reload — fetch it once per
// worker life instead of on every context-menu rebuild. A fetch can fail while
// an update swaps the files under the worker: retry once after a short wait.
// Still failing is not an answer for the worker's life either: that call reads
// every flag as disabled (menu items hidden, keep-alive / tags idle) and the
// next call fetches again.
const FEATURES_RETRY_MS = 500;
let featuresPromise: Promise<Features> | undefined;
export function getFeatures(): Promise<Features> {
  featuresPromise ??= loadFeatures()
    .catch(() => new Promise((resolve) => setTimeout(resolve, FEATURES_RETRY_MS)).then(() => loadFeatures()))
    .catch(() => {
      featuresPromise = undefined;
      return {};
    });
  return featuresPromise;
}

// Resolved navigation mode ("off" | "compact" | "traditional"), cached — the
// whole history machinery (a storage write per tab switch + menu rebuild
// chain) is skipped when "off". ui changes invalidate it (mode dropdown and
// showExperimental both affect the resolution).
// the stored state and the flags with the experimental opt-in applied — the one read behind every
// "is this feature on for this user" question in the worker (menus, keep-alive, tags, nav mode)
export async function effectiveFeatures(): Promise<{ state: AppState; features: Features }> {
  const [state, features] = await Promise.all([loadState(), getFeatures()]);
  return { state, features: applyExperimental(features, state.ui.showExperimental ?? false) };
}

let navModePromise: Promise<NavMode> | null = null;
export function navMode(): Promise<NavMode> {
  navModePromise ??= (async () => {
    const { state, features } = await effectiveFeatures();
    if (featuresPromise === undefined) {
      navModePromise = null; // resolved from a failed fetch: fail-closed now, re-resolved next call
    }
    return resolveNavMode(features, state.ui);
  })();
  return navModePromise;
}

export function invalidateNavMode(): void {
  navModePromise = null;
}
