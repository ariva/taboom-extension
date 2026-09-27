// Pure rule-list edits behind toggle / protect / unprotect (src/app/protection-rules.ts).
import assert from "node:assert/strict";
import { test } from "vitest";
import { addHostRules, addUrlRules, removeRulesFor, toggleHostRule } from "../../src/app/protection-rules.ts";
import type { ProtectionRule } from "../../src/app/types.ts";

const rule = (id: string, pattern: string): ProtectionRule => ({
  id,
  type: pattern.includes("://") ? "url" : pattern.startsWith("*.") ? "domain" : "host",
  pattern,
  createdAt: 0,
});

test("Core - ToggleHostRule: an uncovered host gains one host rule and reports protected", () => {
  const current = [rule("r1", "mail.google.com")];
  const toggled = toggleHostRule(current, "https://work.example.com/dash");
  assert.equal(toggled.protected, true);
  assert.deepEqual(
    toggled.rules.map((r) => r.pattern),
    ["mail.google.com", "work.example.com"],
  );
  assert.equal(toggled.rules[1]?.type, "host");
  assert.equal(current.length, 1, "input untouched");
});

test("Core - ToggleHostRule: a covered host loses every rule covering it, wildcard included", () => {
  const current = [rule("r1", "docs.github.com"), rule("r2", "*.github.com"), rule("r3", "other.com")];
  const toggled = toggleHostRule(current, "https://docs.github.com/en");
  assert.equal(toggled.protected, false);
  assert.deepEqual(
    toggled.rules.map((r) => r.id),
    ["r3"],
  );
});

test("Core - AddHostRules: skips blank, already covered and repeated hosts", () => {
  const rules = addHostRules([rule("r1", "*.github.com")], ["", "docs.github.com", "a.com", "a.com", "b.com"]);
  assert.deepEqual(
    rules.map((r) => r.pattern),
    ["*.github.com", "a.com", "b.com"],
  );
});

test("Core - ToggleHostRule: a url-protected page toggles its url rule off, adds nothing", () => {
  const current = [rule("r1", "https://a.com/page")];
  const toggled = toggleHostRule(current, "https://a.com/page");
  assert.equal(toggled.protected, false);
  assert.deepEqual(toggled.rules, []);
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
