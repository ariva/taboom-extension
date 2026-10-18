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
// light fills, "+ hit" while a search token matches it) and, when it is the one pill that cannot
// fit whole, the width it may take (px; the CSS ellipsizes it)
export type Badge = [label: string, kind: string, color?: string, maxWidth?: number];

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
  fit?: PillFit; // the meta line's measured room for tag pills (absent: happy-dom / first paint)
}

// what fitTagPills needs from the DOM (render/meta-fit.ts measures it): the row's line from the
// meta's left edge to the actions' right edge, and text widths in the badge font; the CSS
// paddings, gaps and buttons are rem, hence `rem`
export interface PillFit {
  line: number; // px
  rem: number; // px per rem
  textWidth: (label: string) => number; // px, in the badge font
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

const FALLBACK_PILLS = 3; // with no measured line: three pills, then "+N"
// CSS of the meta line, in rem: its gap, the two badge paddings, the host's floor, the cap on one
// pill; the row's action buttons (their width, their gap, the row gap before them) sit on the
// same line and differ per row (snooze-able or not, parked = none)
const META_GAP = 0.375;
const BADGE_PAD = 0.625;
const PILL_PAD = 0.75;
const HOST_FLOOR = 6;
const PILL_CAP = 7; // .badge.tag max-width: calc(100% - 7rem)
const PILL_MIN = 2; // a cut-short pill never narrower than this
const BUTTON = 1.5;
const BUTTON_GAP = 0.125;
const ROW_GAP = 0.375;
const TEXT_SCALE = 0.85 / 0.77; // the host and age are set in the meta's font, badges in a smaller one

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
  // one pill per tag, search hits first (so a hit never hides behind the "+N" that fitTagPills
  // folds the overflow into); the hover tip lists them all
  const shown = [...tags.filter((tag) => hitTagIds.has(tag.id)), ...tags.filter((tag) => !hitTagIds.has(tag.id))];
  for (const tag of shown) {
    // solid fill in the tag's color: tinted pastels of nine colors look alike
    const kind = ["tag", ...(usesDarkText(tag.color) ? ["dark"] : []), ...(hitTagIds.has(tag.id) ? ["hit"] : [])];
    list.push([tag.name, kind.join(" "), tagColorHex(tag.color)]);
  }
  if (tab.audible) {
    list.push(["🔊", ""]);
  }
  return list;
}

const isPill = ([, kind]: Badge): boolean => kind === "tag" || kind.startsWith("tag ");

// Keep the pills that fit on the meta line beside the host (its floor), the age and the plain
// badges, fold the rest into "+N" — the first pill always stays, cut to the room left when even
// it does not fit whole. The widths mirror the CSS (gap, paddings) so the host, the flexible
// item, absorbs the rounding.
export function fitTagPills(
  list: Badge[],
  age: string | null,
  host: string,
  buttons: number,
  fit: PillFit | undefined,
): Badge[] {
  const first = list.findIndex(isPill);
  if (first < 0) {
    return list;
  }
  const pills = list.filter(isPill);
  const before = list.slice(0, first);
  const after = list.slice(first + pills.length);
  const trimmed = (count: number, shown = pills.slice(0, count)): Badge[] => {
    const rest = pills.length - count;
    return [...before, ...shown, ...(rest > 0 ? [[`+${rest}`, "tag-more"] satisfies Badge] : []), ...after];
  };
  if (!fit) {
    return trimmed(Math.min(pills.length, FALLBACK_PILLS));
  }
  const { line, rem, textWidth } = fit;
  const available = line - (buttons > 0 ? (buttons * BUTTON + (buttons - 1) * BUTTON_GAP + ROW_GAP) * rem : 0);
  const plainWidth = ([label]: Badge): number => textWidth(label) + BADGE_PAD * rem;
  const pillWidth = (pill: Badge, index: number): number =>
    Math.min(textWidth(pill[0]) + PILL_PAD * rem, index === 0 ? available - PILL_CAP * rem : Infinity);
  const fixedItems = [...before, ...after].map(plainWidth);
  if (age) {
    fixedItems.push(textWidth(age) * TEXT_SCALE);
  }
  const hostWidth = Math.min(textWidth(host) * TEXT_SCALE, HOST_FLOOR * rem);
  const fixedWidth = fixedItems.reduce((sum, width) => sum + width, hostWidth);
  const fixedCount = fixedItems.length + 1;
  // everything but the pills, with `count` pills and the "+N" after them when some are left out
  const around = (count: number): number => {
    const rest = pills.length - count;
    const items = fixedCount + count + (rest > 0 ? 1 : 0);
    return fixedWidth + (rest > 0 ? textWidth(`+${rest}`) : 0) + META_GAP * rem * (items - 1);
  };
  for (let count = pills.length; count > 1; count--) {
    const width = around(count) + pills.slice(0, count).reduce((sum, pill, index) => sum + pillWidth(pill, index), 0);
    if (width <= available) {
      return trimmed(count);
    }
  }
  const [lead] = pills;
  if (!lead) {
    return list; // unreachable: `first` found a pill above (narrowing for noUncheckedIndexedAccess)
  }
  const room = available - around(1);
  if (pillWidth(lead, 0) <= room) {
    return trimmed(1);
  }
  const [label, kind, color] = lead;
  const cut: Badge = [label, kind, color, Math.max(room, PILL_MIN * rem)];
  return trimmed(1, [cut]);
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
    fit,
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
  const age = !tab.active && tab.lastAccessed ? formatAge(now - tab.lastAccessed) : null;
  const canSnooze = !parked && !tab.discarded && isSupportedUrl(tab.url);
  const badgeList = fitTagPills(
    [
      ...(parked ? [["parked", ""] satisfies Badge] : []),
      ...badges(tab, d.protected, d.keptAlive, d.tags, hitTagIds),
      ...(urlOnlyMatch ? [["url match", ""] satisfies Badge] : []),
    ],
    age,
    host,
    parked ? 0 : canSnooze ? 3 : 2, // the row's buttons: snooze (when it can), protect, close (renderRow)
    fit,
  );
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
    age,
    badges: badgeList,
    tip: tab.url ?? "",
    tipBadges,
    tipTags: d.tags.map((tag) => ({ name: tag.name, color: tagColorHex(tag.color), dark: usesDarkText(tag.color) })),
    canSnooze,
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
