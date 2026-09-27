// Stable window identity across browser restarts. Chrome window ids are
// transient handles: reassigned every session, so they are never persisted as
// identity. Each window gets a logical id ("w-<uuid>") backed by a content
// fingerprint. Same-session resolution (extension update/reload) uses the
// storage.session map, which Chrome wipes on browser restart — an empty map is
// the restart signal, and matchProfiles() recovers the ids by fingerprint.
// Pure logic only; the service worker owns storage and event wiring.

import type {
  FingerprintTab,
  WindowBounds,
  WindowFingerprint,
  WindowProfile,
  WindowProfiles,
  WindowSessionMap,
} from "./types.ts";

// origin + pathname, lowercased — fragments and query strings would churn the
// fingerprint on every in-page navigation
export function urlKey(url: string | null | undefined): string {
  try {
    const parsed = new URL(url ?? ""); // null/undefined → "" still throws, same fallback below
    return `${parsed.origin}${parsed.pathname}`.toLocaleLowerCase();
  } catch {
    return url ?? "";
  }
}

// small stable hash (djb2, hex) — profiles store hashes, not full URLs
export function hashKey(text: string): string {
  let hash = 5381;
  for (let i = 0; i < text.length; i++) {
    hash = ((hash << 5) + hash + text.charCodeAt(i)) >>> 0;
  }
  return hash.toString(16);
}

// Content signature of one window. ORDER-INSENSITIVE by design: rearranging
// tabs must not change a window's identity — only membership changes it.
// Pinned tabs are kept separately; they are the most stable part of a window.
export function buildFingerprint(
  tabs: FingerprintTab[],
  bounds: Partial<WindowBounds> | null = null,
  now = Date.now(),
): WindowFingerprint {
  const hashes = (list: FingerprintTab[]) => [...new Set(list.map((tab) => hashKey(urlKey(tab.url))))].sort();
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

function jaccard(a: string[], b: string[]): number {
  const union = new Set([...a, ...b]).size;
  if (union === 0) {
    return 0; // two empty sets carry no signal — do not count as identical
  }
  const setB = new Set(b);
  return a.filter((hash) => setB.has(hash)).length / union;
}

// similarity of a stored profile to a live window's fingerprint;
// pinned tabs dominate, url overlap carries the rest, count/bounds nudge ties
export function scoreMatch(profile: WindowProfile, candidate: Partial<WindowFingerprint>): number {
  let score =
    3 * jaccard(profile.pinned ?? [], candidate.pinned ?? []) + jaccard(profile.urls ?? [], candidate.urls ?? []);
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
export function matchProfiles(
  profiles: Record<string, WindowProfile>,
  candidates: [number, Partial<WindowFingerprint>][],
  threshold = 0.4,
): Map<number, string> {
  const pairs: [number, string, number][] = [];
  for (const [logicalId, profile] of Object.entries(profiles)) {
    for (const [chromeId, candidate] of candidates) {
      const score = scoreMatch(profile, candidate);
      if (score >= threshold) {
        pairs.push([score, logicalId, chromeId]);
      }
    }
  }
  pairs.sort((a, b) => (a[0] === b[0] ? 0 : b[0] - a[0]));
  const usedLogical = new Set<string>();
  const assigned = new Map<number, string>();
  for (const [, logicalId, chromeId] of pairs) {
    if (usedLogical.has(logicalId) || assigned.has(chromeId)) {
      continue;
    }
    usedLogical.add(logicalId);
    assigned.set(chromeId, logicalId);
  }
  return assigned;
}

// TTL sweep — the only path that removes a stored profile (closed windows keep
// theirs on purpose, see refreshWindowProfiles in the service worker).
export function expireProfiles(profiles: WindowProfiles, now: number, ttlMs: number): WindowProfiles {
  return Object.fromEntries(
    Object.entries(profiles).filter(([, profile]) => {
      // user-customized windows (name or color) are exempt — losing a name to
      // the sweep after two weeks of vacation would feel like data loss
      if (profile.name || profile.color || profile.pinnedWindow) {
        return true;
      }
      return !(now - (profile.updatedAt ?? 0) > ttlMs);
    }),
  );
}

// Windows (other than the asking panel's) whose profile says a panel was open
// but no live port exists — the panel offers to reopen them via its banner.
export function windowsToRestore(
  sessionMap: WindowSessionMap,
  profiles: WindowProfiles,
  excludeWindowId: number,
  connected: ReadonlySet<number>,
): number[] {
  const windows: number[] = [];
  for (const [chromeId, logicalId] of Object.entries(sessionMap)) {
    const windowId = Number(chromeId);
    if (windowId === excludeWindowId || connected.has(windowId)) {
      continue;
    }
    if (profiles[logicalId]?.panelOpen) {
      windows.push(windowId);
    }
  }
  return windows;
}
