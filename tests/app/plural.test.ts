import assert from "node:assert/strict";
import { test } from "vitest";
import { pluralize } from "../../src/app/plural.ts";

test("Plural - one noun, otherwise the plural (an irregular one given)", () => {
  assert.equal(pluralize(1, "tab"), "1 tab");
  assert.equal(pluralize(0, "tab"), "0 tabs");
  assert.equal(pluralize(3, "window"), "3 windows");
  assert.equal(pluralize(2, "entry", "entries"), "2 entries");
});
