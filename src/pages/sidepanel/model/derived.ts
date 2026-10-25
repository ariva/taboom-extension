// Pure per-tab derived data: the tab-id key type and the host / search haystack /
// protected / kept-alive flags computed once per refresh. No DOM, no chrome.*.
import { hostnameOf, isProtected } from "../../../app/core.ts";
import { keepAliveEntry } from "../../../app/keep-alive.ts";
import { type TagOrigin, tagOrigins, tagsForUrl } from "../../../app/tags.ts";
import type { KeepAliveTab, ProtectionRule, Tag, TagPage } from "../../../app/types.ts";

type Tab = chrome.tabs.Tab;

// chrome types tab.id as optional (foreign-session tabs have none) — the maps
// and sets keyed by it carry that through instead of asserting at every lookup
export type TabId = Tab["id"];

export interface DerivedTab {
  host: string;
  haystack: string;
  protected: boolean;
  keptAlive: boolean;
  tags: Tag[]; // TAGS: the page's tags in tag-list order (empty while the flag is off)
  tagOrigins: Map<string, TagOrigin>; // tag id → the entry kind it comes from (the badge glyph)
}

// the tag list and the tagged pages, as refresh() read them
export interface Tagging {
  tags: Tag[];
  pages: TagPage[];
}

export type DerivedTabs = Map<TabId, DerivedTab>;

// Per-tab derived data (Map by tab id), computed once per refresh — tabs and
// rules only change there. Renders and search keystrokes then never re-parse
// URLs (hostnameOf) or re-scan protection rules per row.
export function deriveTabs(
  tabs: Tab[],
  rules: ProtectionRule[],
  keepAlive: KeepAliveTab[] = [],
  tagging: Tagging = { tags: [], pages: [] },
): DerivedTabs {
  return new Map(
    tabs.map((tab) => {
      const host = hostnameOf(tab.url);
      const mark = keepAliveEntry(keepAlive, tab.url);
      const tags = tagsForUrl(tagging.pages, tagging.tags, tab.url);
      // tag names end the haystack: a plain word finds tagged tabs (the #token path is separate)
      const tagNames = tags.map((tag) => ` ${tag.name}`).join("");
      return [
        tab.id,
        {
          host,
          haystack: `${tab.title ?? ""} ${tab.url ?? ""} ${host}${tagNames}`.toLocaleLowerCase(),
          protected: isProtected(tab.url, rules),
          keptAlive: mark !== undefined && !mark.paused, // paused reloads nothing — no badge
          tags,
          tagOrigins: tags.length > 0 ? tagOrigins(tagging.pages, tab.url) : new Map(),
        },
      ];
    }),
  );
}
