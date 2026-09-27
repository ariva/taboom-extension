// Edits to the protection rule list: what toggling / protecting / unprotecting
// hosts does to the rules. Pure — the service worker persists the result.
import { hostnameOf, isSupportedUrl, isUrlRule, makeRule, matchesRule, matchesUrl } from "./core.ts";
import type { ProtectionRule } from "./types.ts";

// page already covered (by a host, domain or url rule) → every rule covering it
// goes away; otherwise one new host rule for its hostname
export function toggleHostRule(
  current: ProtectionRule[],
  url: string,
): { rules: ProtectionRule[]; protected: boolean } {
  const existing = current.filter((rule) => matchesUrl(url, rule));
  let rules: ProtectionRule[];
  if (existing.length > 0) {
    const removeIds = new Set(existing.map((rule) => rule.id));
    rules = current.filter((rule) => !removeIds.has(rule.id));
  } else {
    // makeRule is null only for a blank pattern — callers pass a url with a hostname
    rules = [...current, makeRule(hostnameOf(url))!];
  }
  return { rules, protected: existing.length === 0 };
}

// one rule per host that no rule covers yet (blank hosts skipped)
export function addHostRules(current: ProtectionRule[], hosts: string[]): ProtectionRule[] {
  const rules = [...current];
  for (const host of hosts) {
    if (!host || rules.some((rule) => matchesRule(host, rule))) {
      continue;
    }
    // makeRule is null only for a blank pattern — empty hosts were skipped above
    rules.push(makeRule(host)!);
  }
  return rules;
}

// one exact-address rule per url; only an identical url rule counts as "already
// there" — a host rule covering the page does not, so the url stays protected
// after the user unprotects the domain later. Blank / non-web urls skipped.
export function addUrlRules(current: ProtectionRule[], urls: string[]): ProtectionRule[] {
  const rules = [...current];
  for (const url of urls) {
    if (!isSupportedUrl(url) || rules.some((rule) => isUrlRule(rule) && matchesUrl(url, rule))) {
      continue;
    }
    const rule = makeRule(url);
    if (rule?.type === "url") {
      rules.push(rule);
    }
  }
  return rules;
}

// removes every rule covering any of the urls — same removal semantics as
// toggleHostRule (a wildcard rule covering the host goes away with it, so
// does the exact url rule)
export function removeRulesFor(current: ProtectionRule[], urls: string[]): ProtectionRule[] {
  return current.filter((rule) => !urls.some((url) => url && matchesUrl(url, rule)));
}
