// Pure view logic for the side panel - easier to test.

import { formatAge, hostnameOf, isProtected, isSupportedUrl } from "../core/core.js";

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

// filter + sort the full tab list down to what the panel shows
export function selectVisible(tabs, { query, scope, filter, sort, currentWindowId, derived, now }) {
  const tokens = query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
  let result = tabs.filter((tab) =>
    tokens.every((token) => derived.get(tab.id).haystack.includes(token)),
  );
  if (scope === "current-window") {
    result = result.filter((tab) => tab.windowId === currentWindowId);
  }
  switch (filter) {
    case "awake": result = result.filter((tab) => !tab.discarded); break;
    case "snoozed": result = result.filter((tab) => tab.discarded); break;
    case "protected": result = result.filter((tab) => derived.get(tab.id).protected); break;
  }
  const last = (tab) => tab.lastAccessed ?? now;
  switch (sort) {
    case "recent": result.sort((a, b) => last(b) - last(a)); break;
    case "oldest": result.sort((a, b) => last(a) - last(b)); break;
    case "title": result.sort((a, b) => (a.title ?? "").localeCompare(b.title ?? "")); break;
    case "domain": result.sort((a, b) => derived.get(a.id).host.localeCompare(derived.get(b.id).host)); break;
    // current window first, then other windows by id; recent-first within each
    case "window": {
      const rank = (tab) => (tab.windowId === currentWindowId ? 0 : tab.windowId);
      result.sort((a, b) => rank(a) - rank(b) || last(b) - last(a));
      break;
    }
  }
  return result;
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

// count/total are precomputed by the caller — filtering the full tab list per
// group here made group-by-window renders O(tabs × windows)
export function groupHeader(windowId, { count, total, currentWindowId, indexes, collapsed = false, collapsible = true }) {
  const label = windowId === currentWindowId ? "Window Current" : "Window";
  const arrow = collapsible ? `${collapsed ? "▸" : "▾"} ` : "";
  return `${arrow}${label} #${indexes.get(windowId)} - ${count}/${total}`;
}

// consecutive same-window runs → ordered [windowId, tabs[]] pairs
export function groupByWindow(tabs) {
  const groups = [];
  for (const tab of tabs) {
    const last = groups[groups.length - 1];
    if (last && last[0] === tab.windowId) last[1].push(tab);
    else groups.push([tab.windowId, [tab]]);
  }
  return groups;
}

// everything renderRow needs to build the DOM, as plain data
export function rowViewModel(tab, { index, cursor, now, currentWindowId, derived, selected, dotColors, indexes }) {
  const d = derived.get(tab.id);
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
    title: (tab.discarded ? "⏸ " : "") + (tab.title || tab.url || "(untitled)"),
    host: d.host || tab.url || "",
    age: !tab.active && tab.lastAccessed ? formatAge(now - tab.lastAccessed) : null,
    badges: badges(tab, d.protected),
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
