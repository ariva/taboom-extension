// Stable window identity across browser restarts. Chrome window ids are
// transient handles: reassigned every session, so they are never persisted as
// identity. Each window gets a logical id ("w-<uuid>") backed by a content
// fingerprint. Same-session resolution (extension update/reload) uses the
// storage.session map, which Chrome wipes on browser restart — an empty map is
// the restart signal, and matchProfiles() recovers the ids by fingerprint.
// Pure logic only; the service worker owns storage and event wiring.

// origin + pathname, lowercased — fragments and query strings would churn the
// fingerprint on every in-page navigation
export function urlKey(url) {
  try {
    const parsed = new URL(url);
    return `${parsed.origin}${parsed.pathname}`.toLocaleLowerCase();
  } catch {
    return url ?? "";
  }
}

// small stable hash (djb2, hex) — profiles store hashes, not full URLs
export function hashKey(text) {
  let hash = 5381;
  for (let i = 0; i < text.length; i++) {
    hash = ((hash << 5) + hash + text.charCodeAt(i)) >>> 0;
  }
  return hash.toString(16);
}

// Content signature of one window. ORDER-INSENSITIVE by design: rearranging
// tabs must not change a window's identity — only membership changes it.
// Pinned tabs are kept separately; they are the most stable part of a window.
export function buildFingerprint(tabs, bounds = null, now = Date.now()) {
  const hashes = (list) => [...new Set(list.map((tab) => hashKey(urlKey(tab.url))))].sort();
  return {
    pinned: hashes(tabs.filter((tab) => tab.pinned)),
    urls: hashes(tabs),
    tabCount: tabs.length,
    bounds: bounds
      ? {
          left: bounds.left ?? 0,
          top: bounds.top ?? 0,
          width: bounds.width ?? 0,
          height: bounds.height ?? 0,
        }
      : null,
    updatedAt: now,
  };
}

function jaccard(a, b) {
  const union = new Set([...a, ...b]).size;
  if (union === 0) {
    return 0; // two empty sets carry no signal — do not count as identical
  }
  const setB = new Set(b);
  return a.filter((hash) => setB.has(hash)).length / union;
}

// similarity of a stored profile to a live window's fingerprint;
// pinned tabs dominate, url overlap carries the rest, count/bounds nudge ties
export function scoreMatch(profile, candidate) {
  let score = 3 * jaccard(profile.pinned ?? [], candidate.pinned ?? []) +
    jaccard(profile.urls ?? [], candidate.urls ?? []);
  if (Math.abs((profile.tabCount ?? 0) - (candidate.tabCount ?? 0)) <= 2) {
    score += 0.25;
  }
  const a = profile.bounds;
  const b = candidate.bounds;
  if (a && b && a.left === b.left && a.top === b.top && a.width === b.width && a.height === b.height) {
    score += 0.5;
  }
  return score;
}

// After a restart: assign stored logical ids to live windows by best score,
// greedy, threshold-gated (a window below the threshold is a new window, not a
// bad match). candidates: [chromeWindowId, fingerprint][]. Returns
// Map chromeWindowId → logicalId; unmatched windows are simply absent.
export function matchProfiles(profiles, candidates, threshold = 0.4) {
  const pairs = [];
  for (const [logicalId, profile] of Object.entries(profiles)) {
    for (const [chromeId, candidate] of candidates) {
      const score = scoreMatch(profile, candidate);
      if (score >= threshold) {
        pairs.push([score, logicalId, chromeId]);
      }
    }
  }
  pairs.sort((a, b) => a[0] === b[0] ? 0 : b[0] - a[0]);
  const usedLogical = new Set();
  const assigned = new Map();
  for (const [, logicalId, chromeId] of pairs) {
    if (usedLogical.has(logicalId) || assigned.has(chromeId)) {
      continue;
    }
    usedLogical.add(logicalId);
    assigned.set(chromeId, logicalId);
  }
  return assigned;
}
