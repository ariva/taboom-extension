// Edits to the protection rule list: what toggling / protecting / unprotecting
// hosts does to the rules. Pure — the service worker persists the result.
import { isSupportedUrl, isUrlRule, makeRule, matchesRule, matchesUrl } from "./core.ts";
import { popRemoval } from "./removal-trash.ts";
import type { ProtectionRule, Removal } from "./types.ts";

// a new rule, temporary when the menu picked a duration (expiresAt); permanent otherwise (no key)
function stamped(rule: ProtectionRule, expiresAt: number | undefined): ProtectionRule {
  return expiresAt === undefined ? rule : { ...rule, expiresAt };
}

// Protect over a page: nothing when a live rule covers it; a page only disabled rules cover gets
// those rules back on with the pick's duration (Always clears an old one) — a second rule for the
// same site would be a puzzle in Settings; otherwise the fresh rule, stamped
function protectWith(
  rules: ProtectionRule[],
  covering: ProtectionRule[],
  fresh: () => ProtectionRule | null,
  expiresAt: number | undefined,
): ProtectionRule[] {
  if (covering.some((rule) => !rule.disabled)) {
    return rules;
  }
  if (covering.length > 0) {
    return rules.map((rule) => {
      const { disabled: _off, expiresAt: _old, ...live } = rule;
      return covering.includes(rule) ? stamped(live, expiresAt) : rule;
    });
  }
  const rule = fresh();
  return rule ? [...rules, stamped(rule, expiresAt)] : rules;
}

// one rule per host that no rule covers yet (blank hosts skipped)
export function addHostRules(current: ProtectionRule[], hosts: string[], expiresAt?: number): ProtectionRule[] {
  let rules = current;
  for (const host of hosts) {
    if (host) {
      const covering = rules.filter((rule) => matchesRule(host, rule));
      rules = protectWith(rules, covering, () => makeRule(host), expiresAt);
    }
  }
  return rules;
}

// one exact-address rule per url; only an identical url rule counts as "already
// there" — a host rule covering the page does not, so the url stays protected
// after the user unprotects the domain later. Blank / non-web urls skipped.
export function addUrlRules(current: ProtectionRule[], urls: string[], expiresAt?: number): ProtectionRule[] {
  let rules = current;
  for (const url of urls) {
    if (isSupportedUrl(url)) {
      const covering = rules.filter((rule) => isUrlRule(rule) && matchesUrl(url, rule));
      const fresh = () => {
        const rule = makeRule(url);
        return rule?.type === "url" ? rule : null;
      };
      rules = protectWith(rules, covering, fresh, expiresAt);
    }
  }
  return rules;
}

// Settings "On" checkbox: off keeps the rule listed but it protects nothing (the panel shows it
// struck through); the key is absent when on. undefined when the rule is unknown or nothing changes
export function setRuleEnabled(rules: ProtectionRule[], id: string, enabled: boolean): ProtectionRule[] | undefined {
  const rule = rules.find((candidate) => candidate.id === id);
  if (!rule || (rule.disabled ?? false) === !enabled) {
    return undefined;
  }
  const { disabled: _previous, ...live } = rule;
  return rules.map((candidate) => (candidate === rule ? (enabled ? live : { ...live, disabled: true }) : candidate));
}

// Settings "Expires" dropdown: a new time (re-based from now by the caller) or permanent again
// (the key removed). undefined when the rule is unknown or nothing changes
export function setRuleExpiry(
  rules: ProtectionRule[],
  id: string,
  expiresAt: number | undefined,
): ProtectionRule[] | undefined {
  const rule = rules.find((candidate) => candidate.id === id);
  if (!rule || rule.expiresAt === expiresAt) {
    return undefined;
  }
  const { expiresAt: _previous, ...permanent } = rule;
  const next = expiresAt === undefined ? permanent : { ...permanent, expiresAt };
  return rules.map((candidate) => (candidate === rule ? next : candidate));
}

// removes every rule covering any of the urls — the menu's "Remove site protection"
// and the panel's Unprotect alike (a wildcard rule covering the host goes away with
// it, so does the exact url rule)
export function removeRulesFor(current: ProtectionRule[], urls: string[]): ProtectionRule[] {
  return current.filter((rule) => !urls.some((url) => url && matchesUrl(url, rule)));
}

// Settings → Restore: the newest removal's rules back, except a pattern that exists
// again (re-protected meanwhile) — the current rule wins. undefined when nothing to restore
export function restoreRuleRemoval(
  rules: ProtectionRule[],
  trash: Removal<ProtectionRule>[],
): { protectionRules: ProtectionRule[]; protectionTrash: Removal<ProtectionRule>[] } | undefined {
  const popped = popRemoval(trash);
  if (!popped) {
    return undefined;
  }
  const patterns = new Set(rules.map((rule) => rule.pattern));
  const returning = popped.newest.items.filter((rule) => !patterns.has(rule.pattern));
  return { protectionRules: [...rules, ...returning], protectionTrash: popped.rest };
}

// Settings chip edit: the rule keeps its id and createdAt, pattern and type come from
// makeRule (so "https://…" turns a host rule into a url rule). undefined when the rule
// is unknown, the text is blank, the pattern is unchanged or another rule has it
export function setRulePattern(rules: ProtectionRule[], id: string, text: string): ProtectionRule[] | undefined {
  const rule = rules.find((candidate) => candidate.id === id);
  const made = makeRule(text);
  if (
    !rule ||
    !made ||
    made.pattern === rule.pattern ||
    rules.some((candidate) => candidate.pattern === made.pattern)
  ) {
    return undefined;
  }
  return rules.map((candidate) =>
    candidate === rule ? { ...rule, type: made.type, pattern: made.pattern } : candidate,
  );
}
