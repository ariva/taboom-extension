// Tags as pure functions: the color table, the name rules, the tag list and tagged-page
// edits, the undo stack hooks and the search token split. No DOM, no chrome.* — the side
// panel, the options page and the worker all go through here.
import { keepAliveKey } from "./core.ts";
import { keepAliveUrlFromInput } from "./keep-alive.ts";
import { popRemoval } from "./removal-trash.ts";
import type { Removal, Tag, TagPage, TagPickOrder, TagRemoval, TagSort, TagSortKey } from "./types.ts";

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

// the key a page is tagged by: the address without its fragment, "" for unsupported urls
export function tagPageKey(url: string | undefined): string {
  return keepAliveKey(url);
}

// a typed address (options Add row): normalized like a tab url, fragment dropped
export function tagPageUrlFromInput(text: string): string {
  return tagPageKey(keepAliveUrlFromInput(text));
}

function pageOf(pages: TagPage[], url: string | undefined): TagPage | undefined {
  const key = tagPageKey(url);
  return key === "" ? undefined : pages.find((page) => page.url === key);
}

// the tags behind a url, in tag-list order (a vanished or disabled id is skipped)
export function tagsForUrl(pages: TagPage[], tags: Tag[], url: string | undefined): Tag[] {
  const ids = pageOf(pages, url)?.tagIds;
  return ids ? enabledTags(tags).filter((tag) => ids.includes(tag.id)) : [];
}

// replace a page's tag ids; an empty set drops the page. undefined when nothing changes
export function setPageTags(pages: TagPage[], url: string, tagIds: string[]): TagPage[] | undefined {
  const key = tagPageKey(url);
  if (key === "") {
    return undefined;
  }
  const page = pages.find((candidate) => candidate.url === key);
  if (tagIds.length === 0) {
    return page ? pages.filter((candidate) => candidate !== page) : undefined;
  }
  if (page && page.tagIds.length === tagIds.length && page.tagIds.every((id, index) => id === tagIds[index])) {
    return undefined;
  }
  const next = { url: key, tagIds: [...tagIds] };
  return page ? pages.map((candidate) => (candidate === page ? next : candidate)) : [...pages, next];
}

// one tag on / off over several pages (row menu over a selection). undefined when no page changed
export function togglePageTags(pages: TagPage[], urls: string[], tagId: string, on: boolean): TagPage[] | undefined {
  let next: TagPage[] | undefined;
  for (const url of urls) {
    const ids = pageOf(next ?? pages, url)?.tagIds ?? [];
    const wanted = on ? (ids.includes(tagId) ? ids : [...ids, tagId]) : ids.filter((id) => id !== tagId);
    next = setPageTags(next ?? pages, url, wanted) ?? next;
  }
  return next;
}

// every one of these pages carries the tag — the ✓ in the row menu over a selection
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
      removedPages.push({ url: page.url, tagIds: taken });
    }
    if (kept.length > 0) {
      remaining.push(kept.length === page.tagIds.length ? page : { url: page.url, tagIds: kept });
    }
  }
  return {
    tags: tags.filter((tag) => !goneIds.has(tag.id)),
    pages: remaining,
    removed: { tags: gone, pages: removedPages },
  };
}

// drop whole pages (Settings → Tagged pages → Remove): one removal without tags
export function removeTagPages(
  pages: TagPage[],
  urls: string[],
): { pages: TagPage[]; removed: TagRemoval } | undefined {
  const keys = new Set(urls.map(tagPageKey));
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

// a header click: none → asc → desc → none on the same header; another header starts asc
export function nextTagSort(current: TagSort | null, key: TagSortKey): TagSort | null {
  if (!current || current.key !== key) {
    return { key, dir: "asc" };
  }
  return current.dir === "asc" ? { key, dir: "desc" } : null;
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
