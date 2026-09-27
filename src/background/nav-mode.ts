// Feature flags and the resolved navigation mode, both cached per worker life.
import { applyExperimental, resolveNavMode } from "../app/core.ts";
import { loadFeatures, loadState } from "../app/storage.ts";
import type { Features, NavMode } from "../app/types.ts";

// features.json can't change without an extension reload — fetch it once per
// worker life instead of on every context-menu rebuild
let featuresPromise: Promise<Features> | undefined;
export const getFeatures = () => (featuresPromise ??= loadFeatures());

// Resolved navigation mode ("off" | "compact" | "traditional"), cached — the
// whole history machinery (a storage write per tab switch + menu rebuild
// chain) is skipped when "off". ui changes invalidate it (mode dropdown and
// showExperimental both affect the resolution).
let navModePromise: Promise<NavMode> | null = null;
export function navMode(): Promise<NavMode> {
  navModePromise ??= (async () => {
    const [{ ui }, features] = await Promise.all([loadState(), getFeatures()]);
    return resolveNavMode(applyExperimental(features, ui.showExperimental ?? false), ui);
  })();
  return navModePromise;
}

export function invalidateNavMode(): void {
  navModePromise = null;
}
