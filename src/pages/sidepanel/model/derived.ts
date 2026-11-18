// Pure per-tab derived data: the tab-id key type and the host / search haystack /
// protected / kept-alive flags computed once per refresh. No DOM, no chrome.*.
import { hostnameOf, isProtected } from "../../../app/core.ts";
import { keepAliveEntries } from "../../../app/keep-alive.ts";
import { offTagsForUrl, type TagOrigin, tagOrigins, tagsForUrl } from "../../../app/tags.ts";
import type { KeepAliveTab, ProtectionRule, Tag, TagPage } from "../../../app/types.ts";

type Tab = chrome.tabs.Tab;

// chrome types tab.id as optional (foreign-session tabs have none) — the maps
// and sets keyed by it carry that through instead of asserting at every lookup
export type TabId = Tab["id"];

export interface DerivedTab {
  host: string;
  haystack: string;
  protected: boolean;
  keptAlive: boolean; // a running mark covers the tab
  keepAlivePaused: boolean; // a paused mark does — struck-through badge while the panel shows disabled things, else nothing
  tags: Tag[]; // TAGS: the page's tags in tag-list order (empty while the flag is off)
  offTags: Tag[]; // the tags only a disabled tag or a switched-off entry gives the page: struck-through pills (empty unless shown)
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
  showDisabled = false, // settings.showDisabledInPanel
): DerivedTabs {
  return new Map(
    tabs.map((tab) => {
      const host = hostnameOf(tab.url);
      const marks = keepAliveEntries(keepAlive, tab.url);
      const running = marks.some((mark) => !mark.paused);
      const tags = tagsForUrl(tagging.pages, tagging.tags, tab.url);
      // tag names end the haystack: a plain word finds tagged tabs (the #token path is separate)
      const tagNames = tags.map((tag) => ` ${tag.name}`).join("");
      return [
        tab.id,
        {
          host,
          haystack: `${tab.title ?? ""} ${tab.url ?? ""} ${host}${tagNames}`.toLocaleLowerCase(),
          protected: isProtected(tab.url, rules),
          keptAlive: running, // a paused mark reloads nothing — no live badge
          keepAlivePaused: showDisabled && !running && marks.length > 0,
          tags,
          offTags: showDisabled ? offTagsForUrl(tagging.pages, tagging.tags, tab.url) : [],
          tagOrigins: tags.length > 0 ? tagOrigins(tagging.pages, tab.url) : new Map(),
        },
      ];
    }),
  );
}
