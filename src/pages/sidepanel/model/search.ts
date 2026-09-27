// Pure search logic: fuzzy activation and scoring, query-token highlight ranges and
// the search + window-scope candidate pool. No DOM, no chrome.*.
import { featureEnabled } from "../../../app/core.ts";
import type { Features, UiPrefs } from "../../../app/types.ts";
import type { DerivedTabs } from "./derived.ts";

type Tab = chrome.tabs.Tab;

// what fuzzyActive reads — the panel passes its whole state
export interface FuzzyView {
  query?: string;
  features?: Features;
  ui?: Partial<Pick<UiPrefs, "experimental_fuzzySearch">>;
}

export interface SearchView extends FuzzyView {
  query: string;
  scope: string; // ScopeName
  currentWindowId: number | null; // null until the panel's first refresh() resolves
  derived: DerivedTabs;
}

// [start, end) — see highlightRanges
export type HighlightRange = [start: number, end: number];

// FUZZY_SEARCH active for this view: flag on and a query is being typed.
// While the flag is still marked experimental, the experimental_-prefixed
// user pref can switch it off (default on); once the feature is promoted
// stable the stale pref is ignored — the prefix acts as its own reset.
export function fuzzyActive(view: FuzzyView): boolean {
  if (!view.query?.trim() || !view.features || !featureEnabled(view.features, "FUZZY_SEARCH")) {
    return false;
  }
  if (view.features.FUZZY_SEARCH?.experimental) {
    return view.ui?.experimental_fuzzySearch ?? true;
  }
  return true;
}

const isWordChar = (ch: string): boolean => /[a-z0-9]/.test(ch);

// Relevance of one query token against a tab's haystack; 0 = no match.
// Tiers (higher wins):
//   exact substring — 10/char base, +15 at a word start, +15 more when it spans
//   the whole word, +5 at the very start of the haystack (= title start);
//   any substring outranks any scattered match (10/char > the 8/char cap below)
//   subsequence — token chars appear in order but scattered: +8 per char that
//   continues a contiguous run, +6 for one opening a word, +1 for a mid-word
//   scatter — so tight clusters at word starts float, loose scatters sink
export function fuzzyScore(haystack: string, token: string): number {
  const at = haystack.indexOf(token);
  if (at !== -1) {
    // haystack[...]!: in range — at > 0 / end < haystack.length on the branches that index
    const wordStart = at === 0 || !isWordChar(haystack[at - 1]!);
    const end = at + token.length;
    const wordEnd = end === haystack.length || !isWordChar(haystack[end]!);
    return 10 * token.length + (wordStart ? 15 : 0) + (wordStart && wordEnd ? 15 : 0) + (at === 0 ? 5 : 0);
  }
  let score = 0;
  let prev = -2;
  for (const ch of token) {
    const found = haystack.indexOf(ch, prev + 1);
    if (found === -1) {
      return 0;
    }
    if (found === prev + 1) {
      score += 8; // contiguous run
    } else if (found === 0 || !isWordChar(haystack[found - 1]!)) {
      // found > 0 → in range
      score += 6; // fresh word start
    } else {
      score += 1; // scattered mid-word hit
    }
    prev = found;
  }
  return score;
}

// [start, end) ranges of query-token matches in `text`, sorted and merged —
// the view wraps them in <mark>. Substring occurrences highlight whole; with
// fuzzy, a token with no substring falls back to the scorer's greedy scattered
// walk and highlights each matched character (nothing if a char is missing).
export function highlightRanges(text: string, tokens: string[], fuzzy = false): HighlightRange[] {
  const lower = text.toLocaleLowerCase();
  const ranges: HighlightRange[] = [];
  for (const token of tokens) {
    let at = lower.indexOf(token);
    if (at !== -1) {
      while (at !== -1) {
        ranges.push([at, at + token.length]);
        at = lower.indexOf(token, at + 1);
      }
    } else if (fuzzy) {
      const positions: number[] = [];
      let prev = -1;
      for (const ch of token) {
        prev = lower.indexOf(ch, prev + 1);
        if (prev === -1) {
          break;
        }
        positions.push(prev);
      }
      if (prev !== -1) {
        for (const pos of positions) {
          ranges.push([pos, pos + 1]);
        }
      }
    }
  }
  if (ranges.length === 0) {
    return [];
  }
  ranges.sort((a, b) => a[0] - b[0]);
  const merged = [ranges[0]!]; // non-empty, checked above
  for (const [start, end] of ranges.slice(1)) {
    const tail = merged[merged.length - 1]!; // merged starts with one element and only grows
    if (start <= tail[1]) {
      tail[1] = Math.max(tail[1], end);
    } else {
      merged.push([start, end]);
    }
  }
  return merged;
}

// tabs matching the active search and window scope — the pool `filter` narrows.
// With FUZZY_SEARCH active the result is ORDERED by relevance (summed token
// scores, ties most-recent first) — selectVisible keeps that order.
// Generic over the tab type (here and in selectVisible / groupTabs): callers get
// back the same tabs they passed in, so a narrower tab type survives the trip.
export function searchCandidates<T extends Tab>(tabs: T[], view: SearchView): T[] {
  const { query, scope, currentWindowId, derived } = view;
  const tokens = query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
  let result: T[];
  if (tokens.length > 0 && fuzzyActive(view)) {
    const scored: [number, T][] = [];
    for (const tab of tabs) {
      let total = 0;
      for (const token of tokens) {
        // derived.get()!: derived is built from these same tabs (deriveTabs, once per refresh)
        const score = fuzzyScore(derived.get(tab.id)!.haystack, token);
        if (score === 0) {
          total = 0;
          break; // every token must match, like the plain search
        }
        total += score;
      }
      if (total > 0) {
        scored.push([total, tab]);
      }
    }
    scored.sort((a, b) => b[0] - a[0] || (b[1].lastAccessed ?? 0) - (a[1].lastAccessed ?? 0));
    result = scored.map(([, tab]) => tab);
  } else {
    result = tabs.filter((tab) =>
      // derived.get()!: built from these same tabs
      tokens.every((token) => derived.get(tab.id)!.haystack.includes(token)),
    );
  }
  if (scope === "current-window") {
    result = result.filter((tab) => tab.windowId === currentWindowId);
  }
  return result;
}
