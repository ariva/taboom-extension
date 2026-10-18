// Pure row-level view models: what one tab row shows (badges, highlights, favicon, dot),
// the bulk-selection summary and the empty-list message. No DOM, no chrome.*.
import { formatAge, isSupportedUrl } from "../../../app/core.ts";
import { tagColorHex, tagMatches, usesDarkText } from "../../../app/tags.ts";
import type { Tag } from "../../../app/types.ts";
import type { DerivedTabs, TabId } from "./derived.ts";
import { highlightRanges } from "./search.ts";
import type { HighlightRange } from "./search.ts";

type Tab = chrome.tabs.Tab;

// a tag badge carries its fill color as the third element (kind "tag", "tag dark" on the
// light fills, "+ hit" while a search token matches it)
export type Badge = [label: string, kind: string, color?: string];

export interface TipTag {
  name: string;
  color: string; // hex
  dark: boolean; // dark text on the light fills
}

export interface RowContext {
  index: number;
  cursor: number;
  now: number;
  currentWindowId: number | null;
  derived: DerivedTabs;
  selected: ReadonlySet<TabId>;
  dotColors: Map<number, string>;
  indexes: Map<number, number>;
  queryTokens?: string[];
  tagTokens?: string[]; // the #tokens of the search (splitTagQuery) — they light up matching badges
  fuzzy?: boolean;
  parked?: boolean; // the row is a parked snapshot, not a live tab
}

export interface RowViewModel {
  classes: string[];
  viewTransitionName: string;
  checked: boolean;
  favicon: { pageUrl: string } | { letter: string }; // no _favicon/ for unsupported URLs — host initial instead
  title: string;
  titleRanges: HighlightRange[];
  host: string;
  hostRanges: HighlightRange[];
  age: string | null;
  badges: Badge[];
  tip: string; // hover tip text: the url ("" for a url-less tab)
  tipBadges: Badge[]; // the tip's states line: the row's plain badges, same colors (no tags, no "url match")
  tipTags: TipTag[]; // the tip's own "Tags:" line, colored like the badges
  canSnooze: boolean;
  protected: boolean;
  protectLabel: string;
  dot: { color: string | undefined; title: string } | null;
}

export interface BulkSummary {
  hidden: boolean;
  text: string;
  allChecked: boolean;
  indeterminate: boolean;
  selectAllTitle: string;
}

const TAG_PILLS = 3;

export function badges(
  tab: Pick<Tab, "discarded" | "pinned" | "audible">,
  isProtectedTab: boolean,
  isKeptAliveTab = false,
  tags: Tag[] = [],
  hitTagIds: ReadonlySet<string> = new Set(),
): Badge[] {
  const list: Badge[] = [];
  if (tab.discarded) {
    list.push(["snoozed", "warn"]);
  }
  if (isProtectedTab) {
    list.push(["protected", "ok"]);
  }
  if (isKeptAliveTab) {
    list.push(["kept alive", "ok"]); // same colour as protected: both mean "auto-snooze leaves this alone"
  }
  if (tab.pinned) {
    list.push(["pinned", ""]);
  }
  // up to TAG_PILLS pills (search hits first, so a hit never hides behind the count), then "+N";
  // the hover tip lists them all
  const shown = [...tags.filter((tag) => hitTagIds.has(tag.id)), ...tags.filter((tag) => !hitTagIds.has(tag.id))];
  for (const tag of shown.slice(0, TAG_PILLS)) {
    // solid fill in the tag's color: tinted pastels of nine colors look alike
    const kind = ["tag", ...(usesDarkText(tag.color) ? ["dark"] : []), ...(hitTagIds.has(tag.id) ? ["hit"] : [])];
    list.push([tag.name, kind.join(" "), tagColorHex(tag.color)]);
  }
  if (shown.length > TAG_PILLS) {
    list.push([`+${shown.length - TAG_PILLS}`, "tag-more"]);
  }
  if (tab.audible) {
    list.push(["🔊", ""]);
  }
  return list;
}

export function emptyMessage(query: string, filter: string, parked = false): string {
  if (query) {
    return "No tabs match — press Esc to clear the search.";
  }
  if (parked) {
    return "No parked windows. Park one from a window header's ⋯ menu.";
  }
  if (filter === "snoozed") {
    return "Nothing snoozed yet. Hover a tab and use the pause button.";
  }
  if (filter === "protected") {
    return "No protected tabs. Use the shield button on a tab to protect its site.";
  }
  if (filter === "tags") {
    return "No tagged tabs. Tag one from its row menu (Tags ▸).";
  }
  return "No open tabs.";
}

// everything renderRow needs to build the DOM, as plain data
export function rowViewModel(
  tab: Tab,
  {
    index,
    cursor,
    now,
    currentWindowId,
    derived,
    selected,
    dotColors,
    indexes,
    queryTokens = [],
    tagTokens = [],
    fuzzy = false,
    parked = false,
  }: RowContext,
): RowViewModel {
  const d = derived.get(tab.id)!; // derived is built from the same tabs (deriveTabs, once per refresh)
  // a badge lights up for a #token prefix or a plain token inside the tag name
  const hitTagIds = new Set(
    d.tags
      .filter(
        (tag) =>
          tagTokens.some((token) => tagMatches(tag, token)) ||
          queryTokens.some((token) => tag.name.toLocaleLowerCase().includes(token)),
      )
      .map((tag) => tag.id),
  );
  const title = (tab.discarded ? "⏸ " : "") + (tab.title || tab.url || "(untitled)");
  const host = d.host || tab.url || "";
  const titleRanges = highlightRanges(title, queryTokens, fuzzy);
  const hostRanges = highlightRanges(host, queryTokens, fuzzy);
  // searching but nothing to mark in the visible fields: the hit is inside the
  // raw URL — say so, otherwise the row looks like a false positive
  const urlOnlyMatch = queryTokens.length > 0 && titleRanges.length === 0 && hostRanges.length === 0;
  const badgeList: Badge[] = [
    ...(parked ? [["parked", ""] satisfies Badge] : []),
    ...badges(tab, d.protected, d.keptAlive, d.tags, hitTagIds),
    ...(urlOnlyMatch ? [["url match", ""] satisfies Badge] : []),
  ];
  // the tip's states line reads the plain badges back; the tags get their own colored line, the
  // search-only "url match" stays out
  const tipBadges = badgeList.filter(([label, kind]) => label !== "url match" && !kind.startsWith("tag"));
  return {
    classes: [
      "row",
      index === cursor && "cursor",
      tab.discarded && "snoozed",
      tab.active && "active-tab",
      tab.active && tab.windowId === currentWindowId && "current",
      parked && "parked",
    ].filter((name): name is string => Boolean(name)),
    viewTransitionName: `tab-${tab.id}`,
    checked: selected.has(tab.id),
    favicon: tab.url && isSupportedUrl(tab.url) ? { pageUrl: tab.url } : { letter: (d.host[0] ?? "•").toUpperCase() },
    title,
    titleRanges,
    host,
    hostRanges,
    age: !tab.active && tab.lastAccessed ? formatAge(now - tab.lastAccessed) : null,
    badges: badgeList,
    tip: tab.url ?? "",
    tipBadges,
    tipTags: d.tags.map((tag) => ({ name: tag.name, color: tagColorHex(tag.color), dark: usesDarkText(tag.color) })),
    canSnooze: !parked && !tab.discarded && isSupportedUrl(tab.url),
    protected: d.protected,
    protectLabel: d.protected ? "Unprotect site" : "Protect site",
    dot:
      dotColors.size > 0
        ? {
            color: dotColors.get(tab.windowId),
            title: tab.windowId === currentWindowId ? "Current window" : `Window #${indexes.get(tab.windowId)}`,
          }
        : null,
  };
}

export function bulkSummary(visible: Tab[], selected: ReadonlySet<TabId>): BulkSummary {
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
