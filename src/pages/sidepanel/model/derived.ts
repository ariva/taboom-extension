// Pure per-tab derived data: the tab-id key type and the host / search haystack /
// protected flag computed once per refresh. No DOM, no chrome.*.
import { hostnameOf, isProtected } from "../../../app/core.ts";
import type { ProtectionRule } from "../../../app/types.ts";

type Tab = chrome.tabs.Tab;

// chrome types tab.id as optional (foreign-session tabs have none) — the maps
// and sets keyed by it carry that through instead of asserting at every lookup
export type TabId = Tab["id"];

export interface DerivedTab {
  host: string;
  haystack: string;
  protected: boolean;
}

export type DerivedTabs = Map<TabId, DerivedTab>;

// Per-tab derived data (Map by tab id), computed once per refresh — tabs and
// rules only change there. Renders and search keystrokes then never re-parse
// URLs (hostnameOf) or re-scan protection rules per row.
export function deriveTabs(tabs: Tab[], rules: ProtectionRule[]): DerivedTabs {
  return new Map(
    tabs.map((tab) => {
      const host = hostnameOf(tab.url);
      return [
        tab.id,
        {
          host,
          haystack: `${tab.title ?? ""} ${tab.url ?? ""} ${host}`.toLocaleLowerCase(),
          protected: isProtected(tab.url, rules),
        },
      ];
    }),
  );
}
