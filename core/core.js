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
    fontSize: 1, // rem, relative to browser default
    density: "comfortable", // or "compact"
    theme: "auto", // "auto" | "light" | "dark"
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
    type: trimmed.startsWith("*.") ? "domain" : "host",
    pattern: trimmed,
    createdAt: Date.now(),
  };
}
