// Pure rule-list edits behind toggle / protect / unprotect (src/app/protection-rules.ts).
import assert from "node:assert/strict";
import { test } from "vitest";
import { addHostRules, removeHostRules, toggleHostRule } from "../../src/app/protection-rules.ts";
import type { ProtectionRule } from "../../src/app/types.ts";

const rule = (id: string, pattern: string): ProtectionRule => ({
  id,
  type: pattern.startsWith("*.") ? "domain" : "host",
  pattern,
  createdAt: 0,
});

test("Core - ToggleHostRule: an uncovered host gains one host rule and reports protected", () => {
  const current = [rule("r1", "mail.google.com")];
  const toggled = toggleHostRule(current, "work.example.com");
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
  const toggled = toggleHostRule(current, "docs.github.com");
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

test("Core - RemoveHostRules: drops rules matching any host, ignores blank hosts", () => {
  const current = [rule("r1", "a.com"), rule("r2", "*.github.com"), rule("r3", "b.com")];
  assert.deepEqual(
    removeHostRules(current, ["", "gist.github.com", "a.com"]).map((r) => r.id),
    ["r3"],
  );
  assert.deepEqual(removeHostRules(current, []), current);
});
