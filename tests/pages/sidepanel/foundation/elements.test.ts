import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { Window } from "happy-dom";
import { test } from "vitest";

// the lookups run at import time, against the panel's real markup
const win = new Window();
win.document.write(readFileSync(new URL("../../../../src/pages/sidepanel/index.html", import.meta.url), "utf8"));
Object.assign(globalThis, { window: win, document: win.document });
const elements = await import("../../../../src/pages/sidepanel/foundation/elements.ts");

test("Sidepanel - Elements - Every shared reference resolves in index.html", () => {
  const missing = Object.entries(elements)
    .filter(([, el]) => !el)
    .map(([name]) => name);
  assert.deepEqual(missing, []);
  assert.equal(Object.keys(elements).length, 12);
});

test("Sidepanel - Elements - The two toolbar selects really are <select>s", () => {
  assert.equal(elements.scopeSelect.tagName, "SELECT");
  assert.equal(elements.sortSelect.tagName, "SELECT");
});
