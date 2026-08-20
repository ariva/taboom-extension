// Pure logic shared by service worker, side panel, options.
// No chrome.* usage here so it stays unit-testable under plain node.

export const DEFAULTS = {
  schemaVersion: 1,
  settings: {
    autoSnoozeEnabled: true,
    inactivityMinutes: 60,
    checkIntervalMinutes: 5,
    excludePinned: true,
    excludeAudible: true,
    minAwakePerWindow: 2,
  },
  protectionRules: [],
  ui: {
    defaultFilter: "all",
    scope: "all-windows",
    sort: "window",
    sortDirMode: "default", // "default" = canonical on every sort change; "remember" = per-sort memory
    sortDirections: {}, // last-used direction per sort value (used when sortDirMode = remember)
    fontSize: 1, // rem, relative to browser default
    density: "comfortable", // or "compact"
    theme: "auto", // "auto" | "light" | "dark"
    historyNav: "traditional", // "disabled" | "traditional" | "compact" (legacy: true/false)
    showExperimental: false, // opt into experimental features (needs ALLOW_EXPERIMENTAL flag)
  },
};

// ui.theme → value for document.documentElement.style.colorScheme
// ("auto" / unknown → "" = follow system; light-dark() colors key off this)
export function resolveColorScheme(theme) {
  return theme === "light" || theme === "dark" ? theme : "";
}

export function hostnameOf(url) {
  try {
    return new URL(url).hostname.toLowerCase().replace(/\.$/, "");
  } catch {
    return "";
  }
}

export function isSupportedUrl(url) {
  if (!url) return false;
  return url.startsWith("http:") || url.startsWith("https:") || url.startsWith("file:");
}

// rule: { id, type: "host" | "domain", pattern }
// "host"  → exact hostname match, e.g. "mail.google.com"
// "domain"→ "*.github.com" matches github.com and any subdomain
export function matchesRule(host, rule) {
  const pattern = rule.pattern.toLowerCase();
  if (pattern.startsWith("*.")) {
    const base = pattern.slice(2);
    return host === base || host.endsWith("." + base);
  }
  return host === pattern;
}

export function isProtected(url, rules) {
  const host = hostnameOf(url);
  if (!host) return false;
  return rules.some((rule) => matchesRule(host, rule));
}

export function isEligibleForAutoSnooze(tab, settings, rules, now = Date.now()) {
  if (!tab.id) return false;
  if (tab.active) return false;
  if (tab.discarded) return false;
  if (settings.excludePinned && tab.pinned) return false;
  if (settings.excludeAudible && tab.audible) return false;
  if (!isSupportedUrl(tab.url)) return false;
  if (isProtected(tab.url, rules)) return false;
  const lastAccessed = tab.lastAccessed ?? now;
  return now - lastAccessed >= settings.inactivityMinutes * 60_000;
}

// Which tabs should this auto-snooze pass discard? Applies eligibility, then
// keeps at least settings.minAwakePerWindow awake tabs per window (oldest
// eligible tabs get discarded first, so the freshest stay awake).
export function selectAutoSnoozeTargets(tabs, settings, rules, now = Date.now()) {
  const eligible = tabs.filter((tab) => isEligibleForAutoSnooze(tab, settings, rules, now));
  const minAwake = settings.minAwakePerWindow ?? 0;
  if (minAwake <= 0) return eligible.map((tab) => tab.id);

  const awakeByWindow = new Map();
  for (const tab of tabs) {
    if (!tab.discarded) {
      awakeByWindow.set(tab.windowId, (awakeByWindow.get(tab.windowId) ?? 0) + 1);
    }
  }
  eligible.sort((a, b) => (a.lastAccessed ?? now) - (b.lastAccessed ?? now));
  const targets = [];
  for (const tab of eligible) {
    const awake = awakeByWindow.get(tab.windowId) ?? 0;
    if (awake <= minAwake) continue;
    awakeByWindow.set(tab.windowId, awake - 1);
    targets.push(tab.id);
  }
  return targets;
}

// Case-insensitive, substring, token-friendly: every whitespace-separated
// token must appear somewhere in title+url+hostname.
export function matchesSearch(tab, query) {
  const trimmed = query.trim().toLocaleLowerCase();
  if (!trimmed) return true;
  const haystack = `${tab.title ?? ""} ${tab.url ?? ""} ${hostnameOf(tab.url)}`.toLocaleLowerCase();
  return trimmed.split(/\s+/).every((token) => haystack.includes(token));
}

export function formatAge(ms) {
  if (ms < 0 || !Number.isFinite(ms)) return "";
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 1) return "now";
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ${minutes % 60}m`;
  return `${Math.floor(hours / 24)}d`;
}

export function makeRule(pattern) {
  const trimmed = pattern.trim().toLowerCase();
  if (!trimmed) return null;
  return {
    id: crypto.randomUUID(),
    type: /** @type {"host" | "domain"} */ (trimmed.startsWith("*.") ? "domain" : "host"),
    pattern: trimmed,
    createdAt: Date.now(),
  };
}

// ---------- tab activation history (browser-style back/forward across tabs) ----------

// COMPACT mode: activating a tab that is already anywhere in the stack just
// moves the cursor to it — re-picking a tab from the trail must not rewrite it.
// Only a tab NOT in the stack truncates the forward part and appends.
export function pushHistoryCompact({ stack, cursor }, tabId, max = 50) {
  if (stack[cursor] === tabId) return { stack, cursor };
  const existing = stack.indexOf(tabId);
  if (existing !== -1) return { stack, cursor: existing };
  const next = [...stack.slice(0, cursor + 1), tabId].slice(-max);
  return { stack: next, cursor: next.length - 1 };
}

// TRADITIONAL mode: classic browser history — every manual activation
// truncates the forward part and appends, duplicates allowed.
// [1,2*,3,4] + tab1 → [1,2,1*]; [1,2*,3,4] + tab5 → [1,2,5*].
export function pushHistoryTraditional({ stack, cursor }, tabId, max = 100) {
  if (stack[cursor] === tabId) return { stack, cursor };
  const next = [...stack.slice(0, cursor + 1), tabId].slice(-max);
  return { stack: next, cursor: next.length - 1 };
}

// Switching to compact dedupes a traditional stack once (newest occurrence
// wins) so compact's move-cursor-to-first-occurrence never lands on a stale dupe.
export function dedupeHistory({ stack, cursor }) {
  const seen = new Set();
  const kept = [];
  for (let index = stack.length - 1; index >= 0; index--) {
    if (!seen.has(stack[index])) {
      seen.add(stack[index]);
      kept.unshift(stack[index]);
    }
  }
  // cursor follows its tab's surviving occurrence (empty stack → -1)
  return { stack: kept, cursor: kept.indexOf(stack[cursor]) };
}

// ui.historyNav ("disabled" | "traditional" | "compact"; legacy true/false) +
// feature flags → the mode actually in effect. NAVIGATION_STACK is the master
// kill-switch; a mode whose flag is off falls back to the other enabled mode.
export function resolveNavMode(features, ui) {
  if (!featureEnabled(features, "NAVIGATION_STACK")) return "off";
  const raw = ui.historyNav ?? "traditional";
  const wanted = raw === true ? "traditional" : raw === false ? "disabled" : raw;
  if (wanted === "disabled") return "off";
  const allowed = {
    traditional: featureEnabled(features, "NAVIGATION_TRADITIONAL_STACK"),
    compact: featureEnabled(features, "NAVIGATION_COMPACT_STACK"),
  };
  if (allowed[wanted]) return wanted;
  const other = wanted === "traditional" ? "compact" : "traditional";
  return allowed[other] ? other : "off";
}

export function filterHistory({ stack, cursor }, keep) {
  const removedUpToCursor = stack.slice(0, cursor + 1).filter((id) => !keep(id)).length;
  const next = stack.filter(keep);
  return { stack: next, cursor: Math.min(next.length - 1, cursor - removedUpToCursor) };
}

export const removeFromHistory = (hist, tabId) => filterHistory(hist, (id) => id !== tabId);

// Remove ONE entry by position (traditional stacks can hold the same tab id
// more than once, so removal from the popup must be by index, not id).
// Removing the cursor entry moves the cursor to the previous one.
export function removeHistoryAt({ stack, cursor }, index) {
  if (index < 0 || index >= stack.length) {
    return { stack, cursor };
  }
  const next = stack.filter((_, position) => position !== index);
  return { stack: next, cursor: Math.min(next.length - 1, index <= cursor ? cursor - 1 : cursor) };
}

// ---------- feature flags (features.json at extension root) ----------

export const featureEnabled = (features, key) => features[key]?.enabled ?? false;

// User opted into experimental features (and the build allows it via
// ALLOW_EXPERIMENTAL): flip enabled:false → true on features marked experimental.
export function applyExperimental(features, showExperimental) {
  if (!showExperimental || !featureEnabled(features, "ALLOW_EXPERIMENTAL")) return features;
  return Object.fromEntries(
    Object.entries(features).map(([key, value]) => [
      key,
      value?.experimental && !value.enabled ? { ...value, enabled: true } : value,
    ]),
  );
}

// ---------- performance metrics ----------

// metrics: { [key]: { count, avg, min, max, last } } — plain JSON, storage-safe
export function recordMetric(metrics, key, ms) {
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
