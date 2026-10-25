// Tags as pure functions: the color table, the name rules, the tag list and tagged-page
// edits, the undo stack hooks and the search token split. No DOM, no chrome.* — the side
// panel, the options page and the worker all go through here.
import { popRemoval } from "./removal-trash.ts";
import { matchesTagPage, tagPageKey, tagPagePatternFromInput, tagPatternKind } from "./tag-patterns.ts";
import type { Removal, Tag, TagPage, TagPageSort, TagPickOrder, TagRemoval, TagSort } from "./types.ts";

export { tagPageKey }; // the page side of a tag lives here; the pattern rules in tag-patterns.ts

// Chrome's 9 fixed tab-group colors (chrome.tabGroups.Color → hex) — tags reuse them, so a
// tag badge, a group header and the color menus share one palette
export const TAG_COLORS = {
  grey: "#5f6368",
  blue: "#1a73e8",
  red: "#d93025",
  yellow: "#f9ab00",
  green: "#188038",
  pink: "#d01884",
  purple: "#a142f4",
  cyan: "#007b83",
  orange: "#fa903e",
};

export const TAG_NAME_MAX = 24;

// hex of a tag color; an unknown stored name reads grey (a color newer than the table)
export function tagColorHex(color: string | undefined): string {
  const table: Record<string, string | undefined> = TAG_COLORS;
  return (color === undefined ? undefined : table[color]) ?? TAG_COLORS.grey;
}

// white text fails contrast on the two light fills, like Chrome's own group chips
export function usesDarkText(color: string): boolean {
  return color === "yellow" || color === "orange";
}

function isTagColor(color: string): boolean {
  return Object.hasOwn(TAG_COLORS, color);
}

function normalizeTagName(text: string): string {
  return text.trim().replace(/\s+/g, " ");
}

function sameName(a: string, b: string): boolean {
  return a.localeCompare(b, undefined, { sensitivity: "accent" }) === 0;
}

// why a name cannot be used — undefined when it can. `exceptId`: the tag being renamed
// (its own current name is not a clash). `#` is the search token prefix.
export function tagNameError(list: Tag[], text: string, exceptId?: string): string | undefined {
  const name = normalizeTagName(text);
  if (name === "") {
    return "Type a tag name";
  }
  if (name.includes("#")) {
    return "A tag name cannot contain #";
  }
  if (name.length > TAG_NAME_MAX) {
    return `A tag name is at most ${TAG_NAME_MAX} characters`;
  }
  const clash = list.find((tag) => tag.id !== exceptId && sameName(tag.name, name));
  return clash ? `A tag named "${clash.name}" exists` : undefined;
}

// the id is a parameter: callers pass a fresh one (newTagId); tests pass a known one
export function createTag(list: Tag[], text: string, color: string, id: string): { tags: Tag[]; tag: Tag } | undefined {
  if (tagNameError(list, text) || !isTagColor(color) || list.some((tag) => tag.id === id)) {
    return undefined;
  }
  const tag: Tag = { id, name: normalizeTagName(text), color };
  return { tags: [...list, tag], tag };
}

export function newTagId(): string {
  return `t${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

export function renameTag(list: Tag[], id: string, text: string): Tag[] | undefined {
  const tag = list.find((candidate) => candidate.id === id);
  const name = normalizeTagName(text);
  if (!tag || tag.name === name || tagNameError(list, text, id)) {
    return undefined;
  }
  return list.map((candidate) => (candidate === tag ? { ...tag, name } : candidate));
}

export function recolorTag(list: Tag[], id: string, color: string): Tag[] | undefined {
  const tag = list.find((candidate) => candidate.id === id);
  if (!tag || tag.color === color || !isTagColor(color)) {
    return undefined;
  }
  return list.map((candidate) => (candidate === tag ? { ...tag, color } : candidate));
}

// the tags in force: a disabled one is kept (Settings, its pages) but is not a tag anywhere else
export function enabledTags(list: Tag[]): Tag[] {
  return list.filter((tag) => !tag.disabled);
}

// the Settings switch; the key is absent when on so stored tags stay minimal
export function setTagEnabled(list: Tag[], id: string, enabled: boolean): Tag[] | undefined {
  const tag = list.find((candidate) => candidate.id === id);
  if (!tag || (tag.disabled ?? false) === !enabled) {
    return undefined;
  }
  const { disabled: _previous, ...on } = tag;
  const next = enabled ? on : { ...tag, disabled: true };
  return list.map((candidate) => (candidate === tag ? next : candidate));
}

// drag reorder (Settings): the dragged tag lands at the target's old index — after it when
// dragged down, before it when dragged up (same rule as the quick launch's group rows).
// The list order is what badges, the menus and Group by tag follow. undefined = no move
export function moveTagTo(list: Tag[], draggedId: string, targetId: string): Tag[] | undefined {
  const from = list.findIndex((tag) => tag.id === draggedId);
  const to = list.findIndex((tag) => tag.id === targetId);
  if (from === -1 || to === -1 || from === to) {
    return undefined;
  }
  const next = [...list];
  const [dragged] = next.splice(from, 1);
  if (dragged) {
    next.splice(to, 0, dragged);
  }
  return next;
}

// the stored entry for a url or pattern (a tab url keys like a typed address; a stored pattern
// is its own key) — the writers edit entries, never what a pattern covers
function pageOf(pages: TagPage[], url: string): TagPage | undefined {
  const key = tagPagePatternFromInput(url);
  return key === "" ? undefined : pages.find((page) => page.url === key);
}

// why an address / pattern cannot be added as a new entry — undefined when it can. `exceptUrl`:
// the row being edited (its own key is not a clash). Mirrors tagNameError
export function tagPageError(pages: TagPage[], text: string, exceptUrl?: string): string | undefined {
  const key = tagPagePatternFromInput(text);
  if (key === "") {
    return "Type an address, a host or a pattern";
  }
  const clash = pages.find((page) => page.url === key && page.url !== exceptUrl);
  return clash ? `"${clash.url}" is already listed — edit that row instead` : undefined;
}

// the entries in force: an off one is kept (Settings) but covers no tab
function enabledPages(pages: TagPage[]): TagPage[] {
  return pages.filter((page) => !page.disabled);
}

// the Settings switch on an entry; the key is absent when on, like a tag's
export function setPageEnabled(pages: TagPage[], url: string, enabled: boolean): TagPage[] | undefined {
  const page = pageOf(pages, url);
  if (!page || (page.disabled ?? false) === !enabled) {
    return undefined;
  }
  const { disabled: _previous, ...on } = page;
  const next = enabled ? on : { ...page, disabled: true };
  return pages.map((candidate) => (candidate === page ? next : candidate));
}

// the tags behind a url: every entry covering it, deduped, in tag-list order (a vanished or
// disabled id is skipped, an off entry too)
export function tagsForUrl(pages: TagPage[], tags: Tag[], url: string | undefined): Tag[] {
  const ids = new Set(
    enabledPages(pages)
      .filter((page) => matchesTagPage(page.url, url))
      .flatMap((page) => page.tagIds),
  );
  return ids.size === 0 ? [] : enabledTags(tags).filter((tag) => ids.has(tag.id));
}

// where a tab's tag comes from — the badge glyph and the pickers' hints: its own page entry
// ("page", an exact key), a domain entry, or a pattern (a prefix or a glob). Every entry kind
// that hands the tag down, per tag id
export type TagOrigin = "page" | "domain" | "pattern";

export function tagOriginSets(pages: TagPage[], url: string | undefined): Map<string, Set<TagOrigin>> {
  const key = tagPageKey(url);
  const origins = new Map<string, Set<TagOrigin>>();
  for (const page of enabledPages(pages)) {
    if (!matchesTagPage(page.url, url)) {
      continue;
    }
    const origin: TagOrigin = page.url === key ? "page" : tagPatternKind(page.url);
    for (const id of page.tagIds) {
      origins.set(id, (origins.get(id) ?? new Set()).add(origin));
    }
  }
  return origins;
}

// the one origin a badge shows: the page's own entry wins, then a domain's, else a pattern's
const ORIGIN_RANK: TagOrigin[] = ["page", "domain", "pattern"];

export function tagOrigins(pages: TagPage[], url: string | undefined): Map<string, TagOrigin> {
  return new Map(
    [...tagOriginSets(pages, url)].map(([id, set]) => [id, ORIGIN_RANK.find((origin) => set.has(origin)) ?? "page"]),
  );
}

// the tag ids every one of these pages gets from a site or glob entry rather than its own
// entry — the picker shows them ticked and locked (the entry is edited in Settings)
export function inheritedTagIds(pages: TagPage[], urls: string[]): Set<string> {
  const perUrl = urls.map(
    (url) =>
      new Set(
        enabledPages(pages)
          .filter((page) => page.url !== url && matchesTagPage(page.url, url))
          .flatMap((page) => page.tagIds),
      ),
  );
  const [first, ...rest] = perUrl;
  return first ? new Set([...first].filter((id) => rest.every((ids) => ids.has(id)))) : new Set();
}

// replace an entry's tag ids (url: a page address or a pattern); an empty set drops the
// entry. undefined when nothing changes
export function setPageTags(pages: TagPage[], url: string, tagIds: string[]): TagPage[] | undefined {
  const key = tagPagePatternFromInput(url);
  if (key === "") {
    return undefined;
  }
  const page = pageOf(pages, key);
  if (tagIds.length === 0) {
    return page ? pages.filter((candidate) => candidate !== page) : undefined;
  }
  if (page && page.tagIds.length === tagIds.length && page.tagIds.every((id, index) => id === tagIds[index])) {
    return undefined;
  }
  const next = { ...page, url: key, tagIds: [...tagIds] }; // the switch survives a tag change
  return page ? pages.map((candidate) => (candidate === page ? next : candidate)) : [...pages, next];
}

// one tag on / off over several entries (row menu over a selection). undefined when none changed
export function togglePageTags(pages: TagPage[], urls: string[], tagId: string, on: boolean): TagPage[] | undefined {
  let next: TagPage[] | undefined;
  for (const url of urls) {
    const ids = pageOf(next ?? pages, url)?.tagIds ?? [];
    const wanted = on ? (ids.includes(tagId) ? ids : [...ids, tagId]) : ids.filter((id) => id !== tagId);
    next = setPageTags(next ?? pages, url, wanted) ?? next;
  }
  return next;
}

// the open tabs that carry the tag now and would not once it is unticked on these entries (a
// page entry's tab may still get it from the domain's) — the pickers ask before a change that
// reaches more than one tab
export function tabsLosingTag<T extends { url?: string }>(
  pages: TagPage[],
  urls: string[],
  tagId: string,
  tabs: T[],
): T[] {
  const next = togglePageTags(pages, urls, tagId, false);
  if (!next) {
    return [];
  }
  const tagged = (list: TagPage[], url: string | undefined): boolean =>
    enabledPages(list).some((page) => page.tagIds.includes(tagId) && matchesTagPage(page.url, url));
  return tabs.filter((tab) => tagged(pages, tab.url) && !tagged(next, tab.url));
}

// every one of these entries carries the tag itself — the ✓ in the row menu over a selection
export function hasTagEverywhere(pages: TagPage[], urls: string[], tagId: string): boolean {
  return urls.length > 0 && urls.every((url) => pageOf(pages, url)?.tagIds.includes(tagId));
}

export function pageCountByTag(pages: TagPage[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const page of pages) {
    for (const id of page.tagIds) {
      counts.set(id, (counts.get(id) ?? 0) + 1);
    }
  }
  return counts;
}

// drop tags: they leave the list and every page; what left is one removal (the page
// entries hold only the removed ids, so a restore merges just those back)
export function removeTags(
  tags: Tag[],
  pages: TagPage[],
  ids: string[],
): { tags: Tag[]; pages: TagPage[]; removed: TagRemoval } | undefined {
  const gone = tags.filter((tag) => ids.includes(tag.id));
  if (gone.length === 0) {
    return undefined;
  }
  const goneIds = new Set(gone.map((tag) => tag.id));
  const removedPages: TagPage[] = [];
  const remaining: TagPage[] = [];
  for (const page of pages) {
    const taken = page.tagIds.filter((id) => goneIds.has(id));
    const kept = page.tagIds.filter((id) => !goneIds.has(id));
    if (taken.length > 0) {
      removedPages.push({ ...page, tagIds: taken });
    }
    if (kept.length > 0) {
      remaining.push(kept.length === page.tagIds.length ? page : { ...page, tagIds: kept });
    }
  }
  return {
    tags: tags.filter((tag) => !goneIds.has(tag.id)),
    pages: remaining,
    removed: { tags: gone, pages: removedPages },
  };
}

// drop whole entries by their pattern (Settings → Tagged pages → Remove): one removal without tags
export function removeTagPages(
  pages: TagPage[],
  urls: string[],
): { pages: TagPage[]; removed: TagRemoval } | undefined {
  const keys = new Set(urls.map(tagPagePatternFromInput));
  const gone = pages.filter((page) => keys.has(page.url));
  if (gone.length === 0) {
    return undefined;
  }
  return { pages: pages.filter((page) => !keys.has(page.url)), removed: { tags: [], pages: gone } };
}

// the newest removal back: a tag returns unless its id is back or its name was taken by a
// new tag meanwhile (then its page ids stay gone too); page ids merge into the pages they
// left. undefined when the trash is empty
export function restoreTagRemoval(
  tags: Tag[],
  pages: TagPage[],
  trash: Removal<TagRemoval>[],
): { tags: Tag[]; tagPages: TagPage[]; tagTrash: Removal<TagRemoval>[] } | undefined {
  const popped = popRemoval(trash);
  if (!popped) {
    return undefined;
  }
  let nextTags = tags;
  for (const tag of popped.newest.items.flatMap((removal) => removal.tags)) {
    if (!nextTags.some((known) => known.id === tag.id) && !tagNameError(nextTags, tag.name)) {
      nextTags = [...nextTags, tag];
    }
  }
  const live = new Set(nextTags.map((tag) => tag.id));
  let nextPages = pages;
  for (const page of popped.newest.items.flatMap((removal) => removal.pages)) {
    const current = nextPages.find((candidate) => candidate.url === page.url)?.tagIds ?? [];
    const merged = [...current, ...page.tagIds.filter((id) => live.has(id) && !current.includes(id))];
    nextPages = setPageTags(nextPages, page.url, merged) ?? nextPages;
    if (page.disabled) {
      nextPages = setPageEnabled(nextPages, page.url, false) ?? nextPages; // a whole entry comes back as it left
    }
  }
  return { tags: nextTags, tagPages: nextPages, tagTrash: popped.rest };
}

// ---------- search ----------

// `#work` tokens name tags (prefix match on the name); the rest is plain text search.
// A lone "#" is noise while typing.
export function splitTagQuery(query: string): { text: string[]; tags: string[] } {
  const text: string[] = [];
  const tags: string[] = [];
  for (const token of query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean)) {
    if (token.startsWith("#")) {
      if (token.length > 1) {
        tags.push(token.slice(1));
      }
    } else {
      text.push(token);
    }
  }
  return { text, tags };
}

export function tagMatches(tag: Tag, token: string): boolean {
  return tag.name.toLocaleLowerCase().startsWith(token);
}

// ---------- Settings header sort: the view order every tag list follows ----------

// a header click: none → asc → desc → none on the same header; another header starts asc.
// Generic over the key: the tag table (TagSort) and the tagged-pages table (TagPageSort) share it
export function nextTagSort<K extends string>(
  current: { key: K; dir: "asc" | "desc" } | null,
  key: K,
): { key: K; dir: "asc" | "desc" } | null {
  if (!current || current.key !== key) {
    return { key, dir: "asc" };
  }
  return current.dir === "asc" ? { key, dir: "desc" } : null;
}

// the tagged-pages rows in view order: the stored list, or by address (A–Z), by the first tag as
// the row's chips show it (tag-list order, case-insensitive; no tag sorts first) or by how many
// open tabs the entry covers (tabCounts, a missing entry = 0); equal keys keep the stored order
export function sortedTagPages(
  pages: TagPage[],
  tabCounts: ReadonlyMap<string, number>,
  sort: TagPageSort | null,
  tags: Tag[],
): TagPage[] {
  if (!sort) {
    return pages;
  }
  const firstTag = (page: TagPage): string =>
    tags.find((tag) => page.tagIds.includes(tag.id))?.name.toLocaleLowerCase() ?? "";
  const keyOf = (page: TagPage): number | string => {
    switch (sort.key) {
      case "tabs":
        return tabCounts.get(page.url) ?? 0;
      case "tags":
        return firstTag(page);
      default:
        return page.url;
    }
  };
  const sign = sort.dir === "asc" ? 1 : -1;
  return [...pages].sort((a, b) => {
    const x = keyOf(a);
    const y = keyOf(b);
    return sign * (typeof x === "number" && typeof y === "number" ? x - y : String(x).localeCompare(String(y)));
  });
}

// the rows in view order: the stored list, or sorted by color (palette order), name (A–Z,
// case-insensitive) or page count; equal keys keep the stored order (sort is stable)
export function sortedTags(tags: Tag[], pageCounts: ReadonlyMap<string, number>, sort: TagSort | null): Tag[] {
  if (!sort) {
    return tags;
  }
  const palette = Object.keys(TAG_COLORS);
  const keyOf = (tag: Tag): number | string => {
    switch (sort.key) {
      case "color":
        return palette.indexOf(tag.color);
      case "pages":
        return pageCounts.get(tag.id) ?? 0;
      default:
        return tag.name.toLocaleLowerCase();
    }
  };
  const sign = sort.dir === "asc" ? 1 : -1;
  return [...tags].sort((a, b) => {
    const x = keyOf(a);
    const y = keyOf(b);
    return sign * (typeof x === "number" && typeof y === "number" ? x - y : String(x).localeCompare(String(y)));
  });
}

// every tag list a user picks from (the pickers, the quick launch, the page menu): the enabled
// tags in the order Settings → "Tags order in pickers" asks for — the stored order, by name, by
// use (most pages first), or whatever the Settings table is sorted by right now
export function orderedTags(
  tags: Tag[],
  pages: TagPage[],
  ui: { tagSort?: TagSort; tagPickOrder?: TagPickOrder },
): Tag[] {
  const sort: TagSort | null =
    ui.tagPickOrder === "name"
      ? { key: "name", dir: "asc" }
      : ui.tagPickOrder === "used"
        ? { key: "pages", dir: "desc" }
        : ui.tagPickOrder === "table"
          ? (ui.tagSort ?? null)
          : null;
  return sortedTags(enabledTags(tags), pageCountByTag(pages), sort);
}
