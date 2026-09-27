// Pure sort-direction metadata: which directions each sort cycles through, its
// canonical one, and the direction button's titles. No DOM, no chrome.*, no state.
import type { SortDir } from "./index.ts";

// Direction metadata per sort. Paired sorts (recent/oldest) swap the dropdown
// option itself. Flat sorts cycle asc⇄desc. Grouped sorts are TRI-state:
// "none" (natural order) → "desc" (most visible tabs first) → "asc" (fewest) →
// back to "none". states[0] is the canonical/first-time state.
export interface SortDirectionMeta {
  states: [SortDir, ...SortDir[]];
  inverse?: string; // SortName
}

export const SORT_DIRECTIONS: Record<string, SortDirectionMeta> = {
  recent: { states: ["desc"], inverse: "oldest" },
  oldest: { states: ["asc"], inverse: "recent" },
  title: { states: ["asc", "desc"] },
  domain: { states: ["asc", "desc"] },
  window: { states: ["none", "desc", "asc"] },
  "group-title": { states: ["desc", "asc", "none"] }, // biggest groups first by default
  "group-domain": { states: ["desc", "asc", "none"] },
  "group-url": { states: ["desc", "asc", "none"] },
};

export function canonicalDir(sort: string): SortDir {
  return (SORT_DIRECTIONS[sort] ?? { states: ["asc"] }).states[0];
}

export const DIR_TITLES: Record<SortDir, string> = {
  none: "Default Sorting — click to sort by tab count, most first",
  desc: "Descending / most tabs first — click for ascending / fewest first",
  asc: "Ascending / fewest tabs first — click for next order",
};
