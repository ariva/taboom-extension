// Pure rule-list edits behind toggle / protect / unprotect (src/app/protection-rules.ts).
import assert from "node:assert/strict";
import { test } from "vitest";
import {
  addHostRules,
  addUrlRules,
  removeRulesFor,
  restoreRuleRemoval,
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
