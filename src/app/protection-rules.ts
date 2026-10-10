// Edits to the protection rule list: what toggling / protecting / unprotecting
// hosts does to the rules. Pure — the service worker persists the result.
import { isSupportedUrl, isUrlRule, makeRule, matchesRule, matchesUrl } from "./core.ts";
import { popRemoval } from "./removal-trash.ts";
import type { ProtectionRule, Removal } from "./types.ts";

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
