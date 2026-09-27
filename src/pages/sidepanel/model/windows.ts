// Pure window presentation: stable window indexes, dot colors (palette + custom) and
// the window group name. No DOM, no chrome.*.
import type { WindowProfile } from "../../../app/types.ts";

type Tab = chrome.tabs.Tab;

// per-window name/color/pin from windowProfiles, by live chrome window id
export type WindowMeta = Pick<WindowProfile, "name" | "color" | "pinnedWindow">;
export type WindowMetaMap = Map<number, WindowMeta>;

export interface WindowMaps {
  indexes: Map<number, number>;
  dotColors: Map<number, string>;
  names: WindowMetaMap;
}

export interface WindowNameContext {
  currentWindowId: number | null;
  indexes: Map<number, number>;
  names?: WindowMetaMap | null;
}

// mid-saturation hues legible on both themes; current window uses --accent via CSS
// (exported: the header ctx-menu color submenu offers exactly this palette)
export const WINDOW_DOT_COLORS = [
  "#e4572e",
  "#17bebb",
  "#ffc914",
  "#76b041",
  "#b96ac9",
  "#f28db2",
  "#8d99ae",
  "#c9a227",
];
// beyond the palette: golden-angle hue spacing — unlimited, no repeats
export const windowColor = (i: number): string =>
  WINDOW_DOT_COLORS[i] ?? `hsl(${Math.round(i * 137.508) % 360} 65% 55%)`;

// stable small indexes instead of Chrome's real window ids (current window = #1,
// others by ascending id) + per-window dot colors (only when >1 window)
// meta: Map(windowId → { name, color }) from windowProfiles (WINDOW_NAMES) —
// a custom color overrides the positional auto-color (and, for the current
// window, the accent) and stays stable across sessions
export function windowMaps(tabs: Tab[], currentWindowId: number | null, meta: WindowMetaMap | null = null): WindowMaps {
  const ids = [...new Set(tabs.map((tab) => tab.windowId))].sort((a, b) => a - b);
  const ordered = [currentWindowId, ...ids.filter((id) => id !== currentWindowId)];
  // a null current window (panel before its first refresh) still takes slot #1,
  // so the other windows' numbers do not shift once it resolves
  const indexes = new Map<number, number>();
  for (const [i, id] of ordered.entries()) {
    if (id !== null) {
      indexes.set(id, i + 1);
    }
  }
  const dotColors = new Map<number, string>();
  if (ids.length > 1) {
    let i = 0;
    for (const id of ids) {
      const custom = meta?.get(id)?.color;
      if (id === currentWindowId) {
        dotColors.set(id, custom ?? ""); // "" = accent via CSS
      } else {
        dotColors.set(id, custom ?? windowColor(i++));
      }
    }
  }
  return { indexes, dotColors, names: meta ?? new Map<number, WindowMeta>() };
}

// Group NAME only — the view renders counts and the collapse arrow as their
// own right-side spans so a long name can ellipsize without eating them.
export function windowGroupName(windowId: number, { currentWindowId, indexes, names }: WindowNameContext): string {
  const custom = names?.get(windowId)?.name;
  if (custom) {
    // index survives in the current-window suffix (and tooltips) so "#N" stays learnable
    return windowId === currentWindowId ? `${custom} — Current #${indexes.get(windowId)}` : custom;
  }
  const label = windowId === currentWindowId ? "Window Current" : "Window";
  return `${label} #${indexes.get(windowId)}`;
}
