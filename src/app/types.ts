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
}

// "host"  → exact hostname match, e.g. "mail.google.com"
// "domain"→ "*.github.com" matches github.com and any subdomain
export interface ProtectionRule {
  id: string;
  type: "host" | "domain";
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
  ui: Partial<UiPrefs>;
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
  "id" | "windowId" | "active" | "discarded" | "pinned" | "audible" | "url" | "lastAccessed"
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
