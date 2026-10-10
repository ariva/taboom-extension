// Pure logic shared by service worker, side panel, options.
// No chrome.* usage here so it stays unit-testable under plain node.

import type {
  AppState,
  FeatureName,
  Features,
  KeepAliveTab,
  NavMode,
  PerfMetrics,
  ProtectionRule,
  SearchableTab,
  Settings,
  SnoozeTab,
  TabHistory,
  UiPrefs,
  WakeTimes,
} from "./types.ts";

export const DEFAULTS = {
  schemaVersion: 1,
  settings: {
    autoSnoozeEnabled: true,
    inactivityMinutes: 60,
    checkIntervalMinutes: 5,
    excludePinned: true,
    excludeAudible: true,
    minAwakePerWindow: 2,
    keepAliveEnabled: true, // on as soon as the experimental flag is: nothing happens until a tab is marked
    keepAliveMinutes: 20,
  },
  protectionRules: [],
  ui: {
    defaultFilter: "all",
    scope: "all-windows",
    sort: "window",
    quickLaunchGroupOrder: [], // group titles in the user-dragged order of the quick-launch Groups view (rest ABC)
    groupByWindowTabsOrder: "same-as-window", // within-window order in Group by window: recent | same-as-window | title-asc | title-desc
    sortDirMode: "default", // "default" = canonical on every sort change; "remember" = per-sort memory
    sortDirections: {}, // last-used direction per sort value (used when sortDirMode = remember)
    fontSize: 1, // rem, relative to browser default
    density: "comfortable", // or "compact"
    theme: "auto", // "auto" | "light" | "dark"
    historyNav: "traditional", // "disabled" | "traditional" | "compact" (legacy: true/false)
    searchEmptyFilter: "keep", // "keep" | "all" — when search matches are hidden by the current filter
    hideUpdateBanner: false, // suppress the new-version banner in the side panel
    windowNamesEnabled: true, // WINDOW_NAMES flag: show custom window names/colors (user toggle)
    onExtensionUpdate: "banner", // "auto" | "banner" | "none" — reopen side panels lost to an update/restart
    showExperimental: false, // opt into experimental features (needs ALLOW_EXPERIMENTAL flag)
  },
} satisfies AppState;

// ui.theme → value for document.documentElement.style.colorScheme
// ("auto" / unknown → "" = follow system; light-dark() colors key off this)
export function resolveColorScheme(theme: string | undefined): "light" | "dark" | "" {
  return theme === "light" || theme === "dark" ? theme : "";
}

export function hostnameOf(url: string | undefined): string {
  try {
    // undefined → "" keeps the throw-and-return-"" path (new URL("") throws too)
    return new URL(url ?? "").hostname.toLowerCase().replace(/\.$/, "");
  } catch {
    return "";
  }
}

export function isSupportedUrl(url: string | undefined): boolean {
  if (!url) {
    return false;
  }
  return url.startsWith("http:") || url.startsWith("https:") || url.startsWith("file:");
}

// The rule kind is read off the pattern, not the stored `type`: rules saved
// before "url" existed carry no such field value and must keep working.
export function isUrlRule(rule: Pick<ProtectionRule, "pattern">): boolean {
  return rule.pattern.includes("://");
}

// host-level match: does this hostname fall under the rule?
// "host"  → exact hostname match, e.g. "mail.google.com"
// "domain"→ "*.github.com" matches github.com and any subdomain
// "url"   → never (a bare host is not an address)
export function matchesRule(host: string, rule: Pick<ProtectionRule, "pattern">): boolean {
  if (isUrlRule(rule)) {
    return false;
  }
  const pattern = rule.pattern.toLowerCase();
  if (pattern.startsWith("*.")) {
    const base = pattern.slice(2);
    return host === base || host.endsWith("." + base);
  }
  return host === pattern;
}

// page-level match: url rules want the exact address (path case included —
// Chrome hands us the normalized href, makeRule stores the same form), the
// host kinds match through the hostname
export function matchesUrl(url: string, rule: Pick<ProtectionRule, "pattern">): boolean {
  if (isUrlRule(rule)) {
    return url === rule.pattern;
  }
  return matchesRule(hostnameOf(url), rule);
}

export function isProtected(url: string | undefined, rules: ProtectionRule[]): boolean {
  if (!url || !hostnameOf(url)) {
    return false;
  }
  return rules.some((rule) => matchesUrl(url, rule));
}

// A keep-it-alive mark follows the page, not the tab: the fragment is dropped
// so in-page navigation (#section) keeps matching; unsupported urls key to ""
// and never match. Lives here (not keep-alive.ts) because eligibility needs it.
export function keepAliveKey(url: string | undefined): string {
  if (!isSupportedUrl(url)) {
    return "";
  }
  return (url ?? "").split("#")[0] ?? "";
}

export function isKeptAlive(list: KeepAliveTab[], url: string | undefined): boolean {
  const key = keepAliveKey(url);
  return key !== "" && list.some((entry) => entry.url === key);
}

// wakeTimes: tabId → ms timestamp of a MANUAL wake — a reload of a discarded
// tab leaves lastAccessed at its pre-snooze value, so without this the next
// pass would re-snooze the tab the user just woke
export function isEligibleForAutoSnooze(
  tab: SnoozeTab,
  settings: Settings,
  rules: ProtectionRule[],
  now = Date.now(),
  wakeTimes: WakeTimes | null = null,
  keepAlive: KeepAliveTab[] = [],
): boolean {
  if (!tab.id) {
    return false;
  }
  if (tab.active) {
    return false;
  }
  if (tab.discarded) {
    return false;
  }
  if (settings.excludePinned && tab.pinned) {
    return false;
  }
  if (settings.excludeAudible && tab.audible) {
    return false;
  }
  if (!isSupportedUrl(tab.url)) {
    return false;
  }
  if (isProtected(tab.url, rules)) {
    return false;
  }
  if (isKeptAlive(keepAlive, tab.url)) {
    return false; // a reload would wake it anyway — the two features must not fight
  }
  const lastAccessed = Math.max(tab.lastAccessed ?? now, wakeTimes?.[tab.id] ?? 0);
  return now - lastAccessed >= settings.inactivityMinutes * 60_000;
}

// Which tabs should this auto-snooze pass discard? Applies eligibility, then
// keeps at least settings.minAwakePerWindow awake tabs per window (oldest
// eligible tabs get discarded first, so the freshest stay awake).
export function selectAutoSnoozeTargets(
  tabs: SnoozeTab[],
  settings: Settings,
  rules: ProtectionRule[],
  now = Date.now(),
  wakeTimes: WakeTimes | null = null,
  keepAlive: KeepAliveTab[] = [],
): number[] {
  // type predicate: isEligibleForAutoSnooze rejects tabs without an id
  const eligible = tabs.filter((tab): tab is SnoozeTab & { id: number } =>
    isEligibleForAutoSnooze(tab, settings, rules, now, wakeTimes, keepAlive),
  );
  const minAwake = settings.minAwakePerWindow ?? 0;
  if (minAwake <= 0) {
    return eligible.map((tab) => tab.id);
  }

  const awakeByWindow = new Map<number, number>();
  for (const tab of tabs) {
    if (!tab.discarded) {
      awakeByWindow.set(tab.windowId, (awakeByWindow.get(tab.windowId) ?? 0) + 1);
    }
  }
  eligible.sort((a, b) => (a.lastAccessed ?? now) - (b.lastAccessed ?? now));
  const targets: number[] = [];
  for (const tab of eligible) {
    const awake = awakeByWindow.get(tab.windowId) ?? 0;
    if (awake <= minAwake) {
      continue;
    }
    awakeByWindow.set(tab.windowId, awake - 1);
    targets.push(tab.id);
  }
  return targets;
}

// Case-insensitive, substring, token-friendly: every whitespace-separated
// token must appear somewhere in title+url+hostname.
export function matchesSearch(tab: SearchableTab, query: string): boolean {
  const trimmed = query.trim().toLocaleLowerCase();
  if (!trimmed) {
    return true;
  }
  const haystack = `${tab.title ?? ""} ${tab.url ?? ""} ${hostnameOf(tab.url)}`.toLocaleLowerCase();
  return trimmed.split(/\s+/).every((token) => haystack.includes(token));
}

export function formatAge(ms: number): string {
  if (ms < 0 || !Number.isFinite(ms)) {
    return "";
  }
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 1) {
    return "now";
  }
  if (minutes < 60) {
    return `${minutes}m`;
  }
  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    return `${hours}h ${minutes % 60}m`;
  }
  return `${Math.floor(hours / 24)}d`;
}

export function makeRule(pattern: string): ProtectionRule | null {
  const trimmed = pattern.trim();
  if (!trimmed) {
    return null;
  }
  const base = { id: crypto.randomUUID(), createdAt: Date.now() };
  if (trimmed.includes("://")) {
    // URL(): lowercases the host, keeps the path's case — the form tab.url arrives in
    try {
      return { ...base, type: "url", pattern: new URL(trimmed).href };
    } catch {
      // not an address after all: treated as a plain host pattern below
    }
  }
  const lowered = trimmed.toLowerCase();
  return { ...base, type: lowered.startsWith("*.") ? "domain" : "host", pattern: lowered };
}

// ---------- tab activation history (browser-style back/forward across tabs) ----------

// COMPACT mode: activating a tab that is already anywhere in the stack just
// moves the cursor to it — re-picking a tab from the trail must not rewrite it.
// Only a tab NOT in the stack truncates the forward part and appends.
export function pushHistoryCompact({ stack, cursor }: TabHistory, tabId: number, max = 50): TabHistory {
  if (stack[cursor] === tabId) {
    return { stack, cursor };
  }
  const existing = stack.indexOf(tabId);
  if (existing !== -1) {
    return { stack, cursor: existing };
  }
  const next = [...stack.slice(0, cursor + 1), tabId].slice(-max);
  return { stack: next, cursor: next.length - 1 };
}

// TRADITIONAL mode: classic browser history — every manual activation
// truncates the forward part and appends, duplicates allowed.
// [1,2*,3,4] + tab1 → [1,2,1*]; [1,2*,3,4] + tab5 → [1,2,5*].
export function pushHistoryTraditional({ stack, cursor }: TabHistory, tabId: number, max = 100): TabHistory {
  if (stack[cursor] === tabId) {
    return { stack, cursor };
  }
  const next = [...stack.slice(0, cursor + 1), tabId].slice(-max);
  return { stack: next, cursor: next.length - 1 };
}

// Same tab twice in a row is never a real step (removals collapse neighbours,
// id swaps and jump races can too). Cursor follows its entry; on a dropped
// duplicate it lands on the surviving one.
export function collapseAdjacent({ stack, cursor }: TabHistory): TabHistory {
  if (!stack.some((id, index) => index > 0 && id === stack[index - 1])) {
    return { stack, cursor };
  }
  const next: number[] = [];
  let nextCursor = cursor;
  for (let index = 0; index < stack.length; index++) {
    if (index > 0 && stack[index] === stack[index - 1]) {
      if (index <= cursor) {
        nextCursor--;
      }
      continue;
    }
    next.push(stack[index]!); // index < stack.length, never undefined
  }
  return { stack: next, cursor: nextCursor };
}

// Switching to compact dedupes a traditional stack once (newest occurrence
// wins) so compact's move-cursor-to-first-occurrence never lands on a stale dupe.
export function dedupeHistory({ stack, cursor }: TabHistory): TabHistory {
  const seen = new Set<number>();
  const kept: number[] = [];
  for (let index = stack.length - 1; index >= 0; index--) {
    const id = stack[index]!; // 0 <= index < stack.length, never undefined
    if (!seen.has(id)) {
      seen.add(id);
      kept.unshift(id);
    }
  }
  // cursor follows its tab's surviving occurrence (empty stack → -1)
  const current = stack[cursor]; // undefined only when the stack is empty
  return { stack: kept, cursor: current === undefined ? -1 : kept.indexOf(current) };
}

// ui.historyNav ("disabled" | "traditional" | "compact"; legacy true/false) +
// feature flags → the mode actually in effect. NAVIGATION_STACK is the master
// kill-switch; a mode whose flag is off falls back to the other enabled mode.
export function resolveNavMode(features: Features, ui: Partial<Pick<UiPrefs, "historyNav">>): NavMode {
  if (!featureEnabled(features, "NAVIGATION_STACK")) {
    return "off";
  }
  const raw = ui.historyNav ?? "traditional";
  const wanted = raw === true ? "traditional" : raw === false ? "disabled" : raw;
  if (wanted === "disabled") {
    return "off";
  }
  const allowed = {
    traditional: featureEnabled(features, "NAVIGATION_TRADITIONAL_STACK"),
    compact: featureEnabled(features, "NAVIGATION_COMPACT_STACK"),
  };
  if (allowed[wanted]) {
    return wanted;
  }
  const other = wanted === "traditional" ? "compact" : "traditional";
  return allowed[other] ? other : "off";
}

export function filterHistory({ stack, cursor }: TabHistory, keep: (id: number) => boolean): TabHistory {
  const removedUpToCursor = stack.slice(0, cursor + 1).filter((id) => !keep(id)).length;
  const next = stack.filter(keep);
  return { stack: next, cursor: Math.min(next.length - 1, cursor - removedUpToCursor) };
}

export const removeFromHistory = (hist: TabHistory, tabId: number): TabHistory =>
  filterHistory(hist, (id) => id !== tabId);

// Remove ONE entry by position (traditional stacks can hold the same tab id
// more than once, so removal from the popup must be by index, not id).
// Removing the cursor entry moves the cursor to the previous one.
export function removeHistoryAt({ stack, cursor }: TabHistory, index: number): TabHistory {
  if (index < 0 || index >= stack.length) {
    return { stack, cursor };
  }
  const next = stack.filter((_, position) => position !== index);
  return { stack: next, cursor: Math.min(next.length - 1, index <= cursor ? cursor - 1 : cursor) };
}

// ---------- feature flags (features.json at extension root) ----------

export const featureEnabled = (features: Features, key: FeatureName): boolean => features[key]?.enabled ?? false;

// User opted into experimental features (and the build allows it via
// ALLOW_EXPERIMENTAL): flip enabled:false → true on features marked experimental.
export function applyExperimental(features: Features, showExperimental: boolean): Features {
  if (!showExperimental || !featureEnabled(features, "ALLOW_EXPERIMENTAL")) {
    return features;
  }
  return Object.fromEntries(
    Object.entries(features).map(([key, value]) => [
      key,
      value?.experimental && !value.enabled ? { ...value, enabled: true } : value,
    ]),
  );
}

// ---------- performance metrics ----------

// metrics: { [key]: { count, avg, min, max, last } } — plain JSON, storage-safe
export function recordMetric(metrics: PerfMetrics, key: string, ms: number): PerfMetrics {
  const prev = metrics[key] ?? { count: 0, avg: 0, min: ms, max: ms };
  const count = prev.count + 1;
  return {
    ...metrics,
    [key]: {
      count,
      avg: prev.avg + (ms - prev.avg) / count, // running mean, no history kept
      min: Math.min(prev.min, ms),
      max: Math.max(prev.max, ms),
      last: ms,
    },
  };
}
