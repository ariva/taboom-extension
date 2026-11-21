// Pure rule-list edits behind toggle / protect / unprotect (src/app/protection-rules.ts).
import assert from "node:assert/strict";
import { test } from "vitest";
import {
  addHostRules,
  addUrlRules,
  removeRulesFor,
  restoreRuleRemoval,
  setRuleEnabled,
  setRuleExpiry,
  setRulePattern,
} from "../../src/app/protection-rules.ts";
import { recordRemoval } from "../../src/app/removal-trash.ts";
import type { ProtectionRule } from "../../src/app/types.ts";

const rule = (id: string, pattern: string): ProtectionRule => ({
  id,
  type: pattern.includes("://") ? "url" : pattern.startsWith("*.") ? "domain" : "host",
  pattern,
  createdAt: 0,
});

test("Core - AddHostRules: skips blank, already covered and repeated hosts", () => {
  const rules = addHostRules([rule("r1", "*.github.com")], ["", "docs.github.com", "a.com", "a.com", "b.com"]);
  assert.deepEqual(
    rules.map((r) => r.pattern),
    ["*.github.com", "a.com", "b.com"],
  );
});

test("Core - AddUrlRules: skips blank, unsupported and repeated urls; a protected host does not block", () => {
  const rules = addUrlRules(
    [rule("r1", "*.github.com"), rule("r2", "https://b.com/x")],
    ["", "chrome://settings", "https://gist.github.com/me", "https://b.com/x", "https://a.com/p", "https://a.com/p"],
  );
  assert.deepEqual(
    rules.map((r) => r.pattern),
    ["*.github.com", "https://b.com/x", "https://gist.github.com/me", "https://a.com/p"],
    "url rule added even under a covering domain rule — it must survive unprotecting the domain later",
  );
  assert.equal(rules[2]?.type, "url");
});

test("Core - RemoveRulesFor: drops host rules covering a url and url rules equal to it, ignores blanks", () => {
  const current = [
    rule("r1", "a.com"),
    rule("r2", "*.github.com"),
    rule("r3", "b.com"),
    rule("r4", "https://c.com/page"),
    rule("r5", "https://c.com/other"),
  ];
  assert.deepEqual(
    removeRulesFor(current, ["", "https://gist.github.com/x", "https://a.com/", "https://c.com/page"]).map((r) => r.id),
    ["r3", "r5"],
  );
  assert.deepEqual(removeRulesFor(current, []), current);
  // a kind: the row menu's Unprotect domain / Unprotect URL drop that kind only
  assert.deepEqual(
    removeRulesFor(current, ["https://c.com/page", "https://a.com/"], "url").map((r) => r.id),
    ["r1", "r2", "r3", "r5"],
    "url: the exact-address rule only, the host rule stays",
  );
  assert.deepEqual(
    removeRulesFor(current, ["https://c.com/page", "https://a.com/"], "host").map((r) => r.id),
    ["r2", "r3", "r4", "r5"],
    "host: the host rule only, the address rule stays",
  );
});

test("Core - RestoreRuleRemoval: the newest removal's rules come back unless the pattern exists again; undefined when empty", () => {
  const github: ProtectionRule = { id: "g", type: "domain", pattern: "*.github.com", createdAt: 1 };
  const mail: ProtectionRule = { id: "m", type: "host", pattern: "mail.google.com", createdAt: 1 };
  const board: ProtectionRule = { id: "b", type: "url", pattern: "https://a.com/board", createdAt: 1 };
  const trash = recordRemoval(recordRemoval<ProtectionRule>([], [github], 1), [mail, board], 2);
  const again: ProtectionRule = { id: "m2", type: "host", pattern: "mail.google.com", createdAt: 3 };
  const restored = restoreRuleRemoval([again], trash);
  assert.ok(restored);
  assert.deepEqual(
    restored.protectionRules,
    [again, board],
    "mail re-added meanwhile keeps the new rule; board back as it was",
  );
  assert.deepEqual(restored.protectionTrash, [{ at: 1, items: [github] }], "only the newest action consumed");
  assert.equal(restoreRuleRemoval([], []), undefined);
});

test("Core - SetRulePattern: re-keys one rule through makeRule (type follows), id and createdAt kept; undefined when unknown, blank, same or taken", () => {
  const github: ProtectionRule = { id: "g", type: "domain", pattern: "*.github.com", createdAt: 1 };
  const mail: ProtectionRule = { id: "m", type: "host", pattern: "mail.google.com", createdAt: 2 };
  const next = setRulePattern([github, mail], "m", " https://Mail.Google.com/inbox ");
  assert.deepEqual(next, [github, { id: "m", type: "url", pattern: "https://mail.google.com/inbox", createdAt: 2 }]);
  assert.deepEqual(setRulePattern([github, mail], "g", "*.Example.ORG")?.[0], { ...github, pattern: "*.example.org" });
  assert.equal(setRulePattern([github, mail], "nope", "x.com"), undefined, "unknown rule");
  assert.equal(setRulePattern([github, mail], "m", "   "), undefined, "blank");
  assert.equal(setRulePattern([github, mail], "m", "mail.google.com"), undefined, "same pattern");
  assert.equal(setRulePattern([github, mail], "m", "*.GitHub.com"), undefined, "another rule's pattern");
});

test("Protection rules - a temporary rule: addHostRules / addUrlRules stamp expiresAt, setRuleExpiry re-bases or clears it", () => {
  const NOW = 1_700_000_000_000;
  const hosts = addHostRules([], ["a.test"], NOW + 3_600_000);
  assert.equal(hosts[0]?.expiresAt, NOW + 3_600_000);
  const urls = addUrlRules([], ["https://b.test/x"], NOW + 7_200_000);
  assert.equal(urls[0]?.expiresAt, NOW + 7_200_000);
  assert.ok(!("expiresAt" in (addHostRules([], ["c.test"])[0] ?? {})), "no duration: no key");
  const rules = [...hosts, ...urls];
  const id = hosts[0]?.id ?? "";
  assert.equal(setRuleExpiry(rules, id, NOW + 10)?.[0]?.expiresAt, NOW + 10);
  const cleared = setRuleExpiry(rules, id, undefined);
  assert.ok(cleared && !("expiresAt" in (cleared[0] ?? {})), "Never: the key goes");
  assert.equal(setRuleExpiry(rules, id, NOW + 3_600_000), undefined, "unchanged: no write");
  assert.equal(setRuleExpiry(rules, "nope", undefined), undefined, "unknown rule");
});

test("Protection rules - disabled rules (T-0157): setRuleEnabled adds / drops the key; Protect over a page only disabled rules cover switches them back on", () => {
  const github = rule("g", "*.github.com");
  const off = setRuleEnabled([github], "g", false);
  assert.deepEqual(off, [{ ...github, disabled: true }]);
  assert.equal(setRuleEnabled(off ?? [], "g", false), undefined, "unchanged: no write");
  const on = setRuleEnabled(off ?? [], "g", true);
  assert.deepEqual(on, [github], "on: the key goes");
  assert.equal(setRuleEnabled([github], "nope", false), undefined, "unknown rule");
  // the row menu's Protect domain / URL over a disabled covering rule: the rule returns with the pick's
  // duration (Always clears an old one) — no second rule for the same site
  const stale = { ...github, disabled: true, expiresAt: 1 };
  assert.deepEqual(addHostRules([stale], ["gist.github.com"], 5), [{ ...github, expiresAt: 5 }]);
  assert.deepEqual(addHostRules([stale], ["gist.github.com"]), [github], "Always: permanent again");
  assert.deepEqual(
    addHostRules([github, stale], ["gist.github.com"]),
    [github, stale],
    "a live rule covers: nothing to do",
  );
  const page = { ...rule("u", "https://x.test/a"), disabled: true };
  assert.deepEqual(addUrlRules([page], ["https://x.test/a"]), [rule("u", "https://x.test/a")]);
  assert.deepEqual(
    addUrlRules([stale], ["https://github.com/a"]).map((candidate) => candidate.pattern),
    ["*.github.com", "https://github.com/a"],
    "a disabled host rule is not a url rule: a url rule is added",
  );
});
