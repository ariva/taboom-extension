// Pure view logic for the side panel - easier to test.

import { featureEnabled, formatAge, hostnameOf, isProtected, isSupportedUrl } from "../core/core.js";

// Per-tab derived data (Map by tab id), computed once per refresh — tabs and
// rules only change there. Renders and search keystrokes then never re-parse
// URLs (hostnameOf) or re-scan protection rules per row.
export function deriveTabs(tabs, rules) {
  return new Map(
    tabs.map((tab) => {
      const host = hostnameOf(tab.url);
      return [tab.id, {
        host,
        haystack: `${tab.title ?? ""} ${tab.url ?? ""} ${host}`.toLocaleLowerCase(),
        protected: isProtected(tab.url, rules),
      }];
    }),
  );
}

// FUZZY_SEARCH active for this view: flag on and a query is being typed.
// While the flag is still marked experimental, the experimental_-prefixed
// user pref can switch it off (default on); once the feature is promoted
// stable the stale pref is ignored — the prefix acts as its own reset.
export function fuzzyActive(view) {
  if (!view.query?.trim() || !view.features || !featureEnabled(view.features, "FUZZY_SEARCH")) {
    return false;
  }
  if (view.features.FUZZY_SEARCH?.experimental) {
    return view.ui?.experimental_fuzzySearch ?? true;
  }
  return true;
}

const isWordChar = (ch) => /[a-z0-9]/.test(ch);

// Relevance of one query token against a tab's haystack; 0 = no match.
// Tiers (higher wins):
//   exact substring — 10/char base, +15 at a word start, +15 more when it spans
//   the whole word, +5 at the very start of the haystack (= title start);
//   any substring outranks any scattered match (10/char > the 8/char cap below)
//   subsequence — token chars appear in order but scattered: +8 per char that
//   continues a contiguous run, +6 for one opening a word, +1 for a mid-word
//   scatter — so tight clusters at word starts float, loose scatters sink
export function fuzzyScore(haystack, token) {
  const at = haystack.indexOf(token);
  if (at !== -1) {
    const wordStart = at === 0 || !isWordChar(haystack[at - 1]);
    const end = at + token.length;
    const wordEnd = end === haystack.length || !isWordChar(haystack[end]);
    return 10 * token.length +
      (wordStart ? 15 : 0) + (wordStart && wordEnd ? 15 : 0) + (at === 0 ? 5 : 0);
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
    } else if (found === 0 || !isWordChar(haystack[found - 1])) {
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
export function highlightRanges(text, tokens, fuzzy = false) {
  const lower = text.toLocaleLowerCase();
  const ranges = [];
  for (const token of tokens) {
    let at = lower.indexOf(token);
    if (at !== -1) {
      while (at !== -1) {
        ranges.push([at, at + token.length]);
        at = lower.indexOf(token, at + 1);
      }
    } else if (fuzzy) {
      const positions = [];
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
  const merged = [ranges[0]];
  for (const [start, end] of ranges.slice(1)) {
    const tail = merged[merged.length - 1];
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
export function searchCandidates(tabs, view) {
  const { query, scope, currentWindowId, derived } = view;
  const tokens = query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
  let result;
  if (tokens.length > 0 && fuzzyActive(view)) {
    const scored = [];
    for (const tab of tabs) {
      let total = 0;
      for (const token of tokens) {
        const score = fuzzyScore(derived.get(tab.id).haystack, token);
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
      tokens.every((token) => derived.get(tab.id).haystack.includes(token)),
    );
  }
  if (scope === "current-window") {
    result = result.filter((tab) => tab.windowId === currentWindowId);
  }
  return result;
}

// filter + sort the full tab list down to what the panel shows.
// sortDir: flat sorts take "asc"|"desc"; grouped sorts take "none" (natural
// order) | "desc" (most visible tabs first) | "asc" (fewest first). Group
// direction reorders GROUPS only — within-group order is always recency.
// recent/oldest carry their direction in their identity and ignore sortDir.
export function selectVisible(tabs, view) {
  const { filter, sort, currentWindowId, derived, now, sortDir } = view;
  const s = sortDir === "desc" ? -1 : 1;
  let result = searchCandidates(tabs, view);
  switch (filter) {
    case "awake": result = result.filter((tab) => !tab.discarded); break;
    case "snoozed": result = result.filter((tab) => tab.discarded); break;
    case "protected": result = result.filter((tab) => derived.get(tab.id).protected); break;
  }
  const last = (tab) => tab.lastAccessed ?? now;
  if (fuzzyActive(view)) {
    return result; // fuzzy relevance order beats the active sort while typing
  }
  switch (sort) {
    case "recent": result.sort((a, b) => last(b) - last(a)); break;
    case "oldest": result.sort((a, b) => last(a) - last(b)); break;
    case "title": result.sort((a, b) => s * (a.title ?? "").localeCompare(b.title ?? "")); break;
    case "domain": result.sort((a, b) => s * derived.get(a.id).host.localeCompare(derived.get(b.id).host)); break;
    // key-grouped sorts (title/domain): "none" = groups alphabetical;
    // "desc"/"asc" = by visible group size (ties alphabetical);
    // recent-first within a group
    case "group-title":
      sortGroupedByKey(result, (tab) => tab.title ?? "", sortDir, last);
      break;
    case "group-domain":
      sortGroupedByKey(result, (tab) => derived.get(tab.id).host, sortDir, last);
      break;
    // "none" = current window first then windows by id (natural 1..x);
    // "desc"/"asc" = windows by visible tab count (natural order as tiebreak);
    // within a window always recent-first
    case "window": {
      const rank = (tab) => (tab.windowId === currentWindowId ? 0 : tab.windowId);
      const sizes = new Map();
      for (const tab of result) {
        sizes.set(tab.windowId, (sizes.get(tab.windowId) ?? 0) + 1);
      }
      const bySize = sortDir === "desc" ? -1 : sortDir === "asc" ? 1 : 0;
      result.sort(
        (a, b) =>
          bySize * (sizes.get(a.windowId) - sizes.get(b.windowId)) ||
          rank(a) - rank(b) ||
          last(b) - last(a),
      );
      break;
    }
  }
  return result;
}

// shared ordering for key-grouped sorts — see the group-* cases above
function sortGroupedByKey(result, keyOf, sortDir, last) {
  const sizes = new Map();
  for (const tab of result) {
    const key = keyOf(tab);
    sizes.set(key, (sizes.get(key) ?? 0) + 1);
  }
  const bySize = sortDir === "desc" ? -1 : sortDir === "asc" ? 1 : 0;
  result.sort(
    (a, b) =>
      bySize * (sizes.get(keyOf(a)) - sizes.get(keyOf(b))) ||
      keyOf(a).localeCompare(keyOf(b)) ||
      last(b) - last(a),
  );
}

export function countsByFilter(tabs, derived) {
  const counts = { all: tabs.length, awake: 0, snoozed: 0, protected: 0 };
  for (const tab of tabs) {
    if (tab.discarded) {
      counts.snoozed++;
    } else {
      counts.awake++;
    }
    if (derived.get(tab.id).protected) {
      counts.protected++;
    }
  }
  return counts;
}

// mid-saturation hues legible on both themes; current window uses --accent via CSS
const WINDOW_DOT_COLORS = ["#e4572e", "#17bebb", "#ffc914", "#76b041", "#b96ac9", "#f28db2", "#8d99ae", "#c9a227"];
// beyond the palette: golden-angle hue spacing — unlimited, no repeats
export const windowColor = (i) => WINDOW_DOT_COLORS[i] ?? `hsl(${Math.round(i * 137.508) % 360} 65% 55%)`;

// stable small indexes instead of Chrome's real window ids (current window = #1,
// others by ascending id) + per-window dot colors (only when >1 window)
export function windowMaps(tabs, currentWindowId) {
  const ids = [...new Set(tabs.map((tab) => tab.windowId))].sort((a, b) => a - b);
  const ordered = [currentWindowId, ...ids.filter((id) => id !== currentWindowId)];
  const indexes = new Map(ordered.map((id, i) => [id, i + 1]));
  const dotColors = new Map();
  if (ids.length > 1) {
    let i = 0;
    for (const id of ids) {
      dotColors.set(id, id === currentWindowId ? "" : windowColor(i++));
    }
  }
  return { indexes, dotColors };
}

export function badges(tab, isProtectedTab) {
  const list = [];
  if (tab.discarded) list.push(["snoozed", "warn"]);
  if (isProtectedTab) list.push(["protected", "ok"]);
  if (tab.pinned) list.push(["pinned", ""]);
  if (tab.audible) list.push(["🔊", ""]);
  return list;
}

export function emptyMessage(query, filter) {
  if (query) return "No tabs match — press Esc to clear the search.";
  if (filter === "snoozed") return "Nothing snoozed yet. Hover a tab and use the pause button.";
  if (filter === "protected") return "No protected tabs. Use the shield button on a tab to protect its site.";
  return "No open tabs.";
}

// Group NAME only — the view renders counts and the collapse arrow as their
// own right-side spans so a long name can ellipsize without eating them.
export function windowGroupName(windowId, { currentWindowId, indexes }) {
  const label = windowId === currentWindowId ? "Window Current" : "Window";
  return `${label} #${indexes.get(windowId)}`;
}

export function titleGroupName(title) {
  return title || "(untitled)";
}

export function domainGroupName(host) {
  return host || "(no domain)";
}

// Generic grouping: consecutive same-key runs → ordered [key, tabs[]] pairs.
// The list must already be sorted by the key (the group-* sorts guarantee it).
export function groupTabs(tabs, key) {
  const groups = [];
  for (const tab of tabs) {
    const last = groups[groups.length - 1];
    if (last && last[0] === key(tab)) last[1].push(tab);
    else groups.push([key(tab), [tab]]);
  }
  return groups;
}

// everything renderRow needs to build the DOM, as plain data
export function rowViewModel(
  tab,
  { index, cursor, now, currentWindowId, derived, selected, dotColors, indexes,
    queryTokens = [], fuzzy = false },
) {
  const d = derived.get(tab.id);
  const title = (tab.discarded ? "⏸ " : "") + (tab.title || tab.url || "(untitled)");
  const host = d.host || tab.url || "";
  const titleRanges = highlightRanges(title, queryTokens, fuzzy);
  const hostRanges = highlightRanges(host, queryTokens, fuzzy);
  // searching but nothing to mark in the visible fields: the hit is inside the
  // raw URL — say so, otherwise the row looks like a false positive
  const urlOnlyMatch = queryTokens.length > 0 && titleRanges.length === 0 && hostRanges.length === 0;
  return {
    classes: [
      "row",
      index === cursor && "cursor",
      tab.discarded && "snoozed",
      tab.active && "active-tab",
      tab.active && tab.windowId === currentWindowId && "current",
    ].filter(Boolean),
    viewTransitionName: `tab-${tab.id}`,
    checked: selected.has(tab.id),
    favicon: isSupportedUrl(tab.url)
      ? { pageUrl: tab.url }
      : { letter: (d.host[0] ?? "•").toUpperCase() },
    title,
    titleRanges,
    host,
    hostRanges,
    age: !tab.active && tab.lastAccessed ? formatAge(now - tab.lastAccessed) : null,
    badges: [...badges(tab, d.protected), ...(urlOnlyMatch ? [["url match", ""]] : [])],
    canSnooze: !tab.discarded && isSupportedUrl(tab.url),
    protected: d.protected,
    protectLabel: d.protected ? "Unprotect site" : "Protect site",
    dot:
      dotColors.size > 0
        ? {
            color: dotColors.get(tab.windowId),
            title:
              tab.windowId === currentWindowId
                ? "Current window"
                : `Window #${indexes.get(tab.windowId)}`,
          }
        : null,
  };
}

export function bulkSummary(visible, selected) {
  const selectedVisible = visible.filter((tab) => selected.has(tab.id)).length;
  const allChecked = visible.length > 0 && selectedVisible === visible.length;
  return {
    hidden: selected.size === 0,
    text: `${selected.size} selected`,
    allChecked,
    indeterminate: selectedVisible > 0 && !allChecked,
    selectAllTitle: allChecked ? "Unselect all" : `Select all ${visible.length} shown`,
  };
}
