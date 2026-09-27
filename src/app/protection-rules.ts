// Edits to the protection rule list: what toggling / protecting / unprotecting
// hosts does to the rules. Pure — the service worker persists the result.
import { makeRule, matchesRule } from "./core.ts";
import type { ProtectionRule } from "./types.ts";

// host already covered → every rule covering it goes away; otherwise one new rule
export function toggleHostRule(
  current: ProtectionRule[],
  host: string,
): { rules: ProtectionRule[]; protected: boolean } {
  const existing = current.filter((rule) => matchesRule(host, rule));
  let rules: ProtectionRule[];
  if (existing.length > 0) {
    const removeIds = new Set(existing.map((rule) => rule.id));
    rules = current.filter((rule) => !removeIds.has(rule.id));
  } else {
    // makeRule is null only for a blank pattern — host is a non-empty hostname here
    rules = [...current, makeRule(host)!];
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

// removes every rule matching any of the hosts — same removal semantics as
// toggleHostRule (a wildcard rule covering the host goes away with it)
export function removeHostRules(current: ProtectionRule[], hosts: string[]): ProtectionRule[] {
  return current.filter((rule) => !hosts.some((host) => host && matchesRule(host, rule)));
}
