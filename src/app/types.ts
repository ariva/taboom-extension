// Shared domain types for the app modules, service worker and pages.
// Types only — nothing here exists at runtime.

// ---------- persisted state (chrome.storage.local) ----------

export interface Settings {
  autoSnoozeEnabled: boolean;
  inactivityMinutes: number;
  checkIntervalMinutes: number;
  excludePinned: boolean;
  excludeAudible: boolean;
  minAwakePerWindow: number;
  // keep-it-alive: periodic reload of marked pages (KEEP_ALIVE flag)
  keepAliveEnabled: boolean;
  keepAliveMinutes: number; // default reload interval; an entry's own `minutes` overrides it
  askBeforePark: boolean; // PARKED_WINDOWS: confirm "Park window…" (the dialog's "Don't ask again" clears it)
}

// one keep-it-alive mark (storage.local.keepAlive[]): keyed by page url without
// the fragment — tab ids do not survive a browser restart, the address does
export interface KeepAliveTab {
  url: string;
  title: string;
  minutes: number; // settings.keepAliveMinutes as it was when marked; editable per mark
  paused?: boolean; // absent = reloads run; the mark stays listed either way
  reloadAll?: boolean; // absent = one tab per reload (pinned first, else first found); true = every open tab on the page
  nextReload: number; // ms timestamp the sweep compares against
}

// one undoable removal from a list (keep-alive marks, protection rules): Settings → Restore
// pops the newest; the stack is capped, never expires — src/app/removal-trash.ts
export interface Removal<T> {
  at: number; // ms timestamp of the removal
  items: T[];
}
export type KeepAliveRemoval = Removal<KeepAliveTab>;

// ---------- tags (storage.local.tags[] + tagPages[]) ----------
// A tag is a colored label; a page carries tag ids. Keyed by page address without the
// fragment (tagPageKey) — like keep-alive, so a tag survives a restart and covers every
// tab on that page, parked copies included.

export interface Tag {
  id: string;
  name: string; // unique, case-insensitive (tagNameError)
  color: string; // a chrome.tabGroups color name (TAG_COLORS); unknown reads grey
  disabled?: boolean; // absent = on; off = kept with its pages in Settings, invisible everywhere else
}

export interface TagPage {
  url: string; // tagPageKey of the page
  tagIds: string[]; // never empty — a page with no tags leaves the list
}

// Settings → Tags header sort: a view order every tag list follows (dropdowns, pickers, quick
// launch); the stored list order stays what drag changes. Absent = stored order
export type TagSortKey = "color" | "name" | "pages";
export interface TagSort {
  key: TagSortKey;
  dir: "asc" | "desc";
}

// Settings → Tags → "Tags order in pickers": how every tag list the user picks from is ordered
// (the Tags… checklist, the Tags ▾ picker, the quick launch view, the page menu, the Add-page dropdown)
export type TagPickOrder = "stored" | "name" | "used" | "table";

// one undoable tag removal: whole tags (and the page ids they took with them) or whole pages
export interface TagRemoval {
  tags: Tag[];
  pages: TagPage[];
}

// ---------- parked windows (storage.local.parkedWindows[]) ----------
// A parked window is a closed window kept as data: its tabs in strip order, its tab
// groups and its identity (name / color / pin), enough to rebuild it. Tabs carry no ids —
// only addresses survive a close.

export interface ParkedTab {
  url: string;
  title: string;
  pinned?: boolean; // absent = not pinned
  active?: boolean; // absent = not the window's active tab
  group?: number; // index into ParkedWindow.groups; absent = ungrouped
}

export interface ParkedGroup {
  title: string;
  color: string; // chrome.tabGroups color name
  collapsed?: boolean; // absent = expanded
}

export interface ParkedWindow {
  id: string; // our own id — the chrome window id dies with the window
  parkedAt: number; // ms timestamp
  name?: string; // custom window name as it was (WINDOW_NAMES)
  color?: string;
  pinnedWindow?: boolean;
  tabs: ParkedTab[];
  groups: ParkedGroup[];
}

// "host"  → exact hostname match, e.g. "mail.google.com"
// "domain"→ "*.github.com" matches github.com and any subdomain
// "url"   → one exact address, e.g. "https://app.example.com/board?id=1"
export interface ProtectionRule {
  id: string;
  type: "host" | "domain" | "url";
  pattern: string;
  createdAt: number;
}

// legacy installs stored true/false instead of the mode name
export type HistoryNav = "disabled" | "traditional" | "compact" | boolean;

// mode actually in effect after feature flags are applied (see resolveNavMode)
export type NavMode = "off" | "traditional" | "compact";

export interface UiPrefs {
  defaultFilter: string;
  scope: string;
  sort: string;
  quickLaunchGroupOrder: string[];
  groupByWindowTabsOrder: "recent" | "same-as-window" | "title-asc" | "title-desc";
  sortDirMode: "default" | "remember";
  sortDirections: Record<string, string>;
  fontSize: number;
  density: "comfortable" | "compact";
  theme: "auto" | "light" | "dark";
  historyNav: HistoryNav;
  searchEmptyFilter: "keep" | "all";
  hideUpdateBanner: boolean;
  windowNamesEnabled: boolean;
  onExtensionUpdate: "auto" | "banner" | "none";
  showExperimental: boolean;
  // not in DEFAULTS: experimental_-prefixed opt-out, read as true when absent (FUZZY_SEARCH)
  experimental_fuzzySearch?: boolean;
  tagSort?: TagSort; // not in DEFAULTS: absent = no table sort (the stored tag order)
  tagPickOrder: TagPickOrder;
}

// shape returned by loadState() and of DEFAULTS
export interface AppState {
  schemaVersion: number;
  settings: Settings;
  protectionRules: ProtectionRule[];
  ui: UiPrefs;
}

// ---------- storage schemas: every key the extension keeps, per area ----------

// chrome.storage.local — see createStorage() in lib/storage.ts, instances in app/storage.ts
export interface LocalStorageSchema {
  schemaVersion: number;
  // settings / ui may lack keys added after they were written — loadState() merges DEFAULTS in
  settings: Partial<Settings>;
  protectionRules: ProtectionRule[];
  protectionTrash: Removal<ProtectionRule>[];
  ui: Partial<UiPrefs>;
  keepAlive: KeepAliveTab[];
  keepAliveTrash: KeepAliveRemoval[];
  parkedWindows: ParkedWindow[];
  parkedTrash: Removal<ParkedWindow>[]; // forgotten parked windows, newest last — Restore last removal
  tags: Tag[];
  tagPages: TagPage[];
  tagTrash: Removal<TagRemoval>[]; // removed tags / tagged pages, newest last — Restore last removal
  windowProfiles: WindowProfiles;
  tabHistory: TabHistory;
  perfMetrics: PerfMetrics;
  perfSnapshots: PerfSnapshot[];
  // version of a pending extension update (runtime.onUpdateAvailable), and the one the user dismissed
  updateAvailable: string;
  dismissedUpdate: string;
}

// chrome.storage.session — wiped by Chrome on browser restart
export interface SessionStorageSchema {
  wakeTimes: WakeTimes;
  windowSessionMap: WindowSessionMap;
}

// ---------- feature flags (features.json at extension root) ----------

export type FeatureName = keyof typeof import("../../features.json");

export interface FeatureFlag {
  enabled: boolean;
  experimental?: boolean;
}

// partial: a failed features.json fetch yields {} and unknown flags read as disabled
export type Features = Partial<Record<FeatureName, FeatureFlag>>;

// ---------- tabs (structural subsets of chrome.tabs.Tab the pure logic reads) ----------

export type SnoozeTab = Pick<
  chrome.tabs.Tab,
  "id" | "windowId" | "active" | "discarded" | "pinned" | "audible" | "url" | "lastAccessed" | "splitViewId"
>;

export type SearchableTab = Pick<chrome.tabs.Tab, "title" | "url">;

export type FingerprintTab = Pick<chrome.tabs.Tab, "url" | "pinned">;

// tabId → ms timestamp of a manual wake (storage.session.wakeTimes)
export type WakeTimes = Record<number, number>;

// ---------- tab activation history ----------

export interface TabHistory {
  stack: number[];
  cursor: number;
}

// ---------- performance metrics ----------

export interface PerfMetric {
  count: number;
  avg: number;
  min: number;
  max: number;
  last: number;
}

export type PerfMetrics = Record<string, PerfMetric>;

// storage.local.perfSnapshots[]: metrics frozen at a point in time (options page)
export interface PerfSnapshot {
  at: number;
  metrics: PerfMetrics;
}

// ---------- window identity ----------

export interface WindowBounds {
  left: number;
  top: number;
  width: number;
  height: number;
}

// content signature of one window, see buildFingerprint()
export interface WindowFingerprint {
  pinned: string[];
  urls: string[];
  tabCount: number;
  bounds: WindowBounds | null;
  updatedAt: number;
}

// storage.local.windowProfiles[logicalId]: last fingerprint + per-window flags.
// Fingerprint fields are optional — stored data is read defensively.
export interface WindowProfile extends Partial<WindowFingerprint> {
  chromeWindowId?: number;
  panelOpen?: boolean;
  name?: string;
  color?: string;
  pinnedWindow?: boolean; // "pinnedWindow", not "pinned" — the fingerprint already owns that key
}

// storage.local.windowProfiles: logicalId → profile
export type WindowProfiles = Record<string, WindowProfile>;

// storage.session.windowSessionMap: chromeWindowId → logicalId
export type WindowSessionMap = Record<number, string>;
