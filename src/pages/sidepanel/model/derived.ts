// Pure per-tab derived data: the tab-id key type and the host / search haystack /
// protected / kept-alive flags computed once per refresh. No DOM, no chrome.*.
import { coveringRules, hostnameOf } from "../../../app/core.ts";
import { temporaryUntil } from "../../../app/expiry.ts";
import { keepAliveEntries } from "../../../app/keep-alive.ts";
import { tabNameFor } from "../../../app/tab-names.ts";
import { offTagsForUrl, type TagOrigin, tagOrigins, tagsForUrl } from "../../../app/tags.ts";
import type { KeepAliveTab, ProtectionRule, TabName, Tag, TagPage } from "../../../app/types.ts";

type Tab = chrome.tabs.Tab;

// chrome types tab.id as optional (foreign-session tabs have none) — the maps
// and sets keyed by it carry that through instead of asserting at every lookup
export type TabId = Tab["id"];

export interface DerivedTab {
  host: string;
  haystack: string;
  protected: boolean;
  protectedUntil?: number; // every rule covering the tab is temporary: when the last one ends (badge "temporary protected")
  protectionOff: boolean; // only disabled rules cover the tab — struck-through badge while the panel shows disabled things, else nothing
  keptAlive: boolean; // a running mark covers the tab
  keptUntil?: number; // every running mark is temporary: when the last one ends (badge "temporary keep alive")
  keepAlivePaused: boolean; // a paused mark does — struck-through badge while the panel shows disabled things, else nothing
  tags: Tag[]; // TAGS: the page's tags in tag-list order (empty while the flag is off)
  offTags: Tag[]; // the tags only a disabled tag or a switched-off entry gives the page: struck-through pills (empty unless shown)
  tagOrigins: Map<string, TagOrigin>; // tag id → the entry kind it comes from (the badge glyph)
  name?: string; // TAB_NAMES: the custom name the row shows in place of the tab's title (the first enabled rule covering the page)
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
  now = Date.now(), // expired rules and marks still stored count for nothing
  names: TabName[] = [], // TAB_NAMES: the name rules (empty while the flag is off)
): DerivedTabs {
  return new Map(
    tabs.map((tab) => {
      const host = hostnameOf(tab.url);
      const marks = keepAliveEntries(keepAlive, tab.url, now);
      const running = marks.filter((mark) => !mark.paused);
      const matching = coveringRules(tab.url, rules, now);
      const covering = matching.filter((rule) => !rule.disabled);
      const tags = tagsForUrl(tagging.pages, tagging.tags, tab.url);
      // tag names end the haystack: a plain word finds tagged tabs (the #token path is separate)
      const tagNames = tags.map((tag) => ` ${tag.name}`).join("");
      const name = tabNameFor(names, tab.url)?.name;
      return [
        tab.id,
        {
          host,
          // the custom name joins the haystack: what the row shows is what a search finds
          haystack: `${name ?? ""} ${tab.title ?? ""} ${tab.url ?? ""} ${host}${tagNames}`.toLocaleLowerCase(),
          protected: covering.length > 0,
          protectedUntil: temporaryUntil(covering),
          protectionOff: showDisabled && covering.length === 0 && matching.length > 0,
          keptAlive: running.length > 0, // a paused mark reloads nothing — no live badge
          keptUntil: temporaryUntil(running),
          keepAlivePaused: showDisabled && running.length === 0 && marks.length > 0,
          tags,
          offTags: showDisabled ? offTagsForUrl(tagging.pages, tagging.tags, tab.url) : [],
          tagOrigins: tags.length > 0 ? tagOrigins(tagging.pages, tab.url) : new Map(),
          ...(name === undefined ? {} : { name }),
        },
      ];
    }),
  );
}
