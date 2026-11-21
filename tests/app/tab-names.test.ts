import assert from "node:assert/strict";
import { test } from "vitest";
import {
  makeTabName,
  restoreTabNameRemoval,
  setTabName,
  setTabNameEnabled,
  setTabNameLabel,
  setTabNamePattern,
  tabNameFor,
} from "../../src/app/tab-names.ts";
import type { TabName } from "../../src/app/types.ts";

const rule = (fields: Partial<TabName> & Pick<TabName, "id" | "pattern" | "name">): TabName => ({
  createdAt: 1,
  ...fields,
});
const docs = rule({ id: "a", pattern: "https://docs.test/x", name: "Docs" });
const site = rule({ id: "b", pattern: "docs.test", name: "Docs site" });
const off = rule({ id: "c", pattern: "https://off.test/", name: "Off", disabled: true });

test("Tab names - tabNameFor: the first enabled rule covering the page wins (stored order); none for a disabled rule or a bare url", () => {
  assert.equal(tabNameFor([site, docs], "https://docs.test/x")?.name, "Docs site", "first in order wins");
  assert.equal(tabNameFor([docs, site], "https://docs.test/x")?.name, "Docs");
  assert.equal(
    tabNameFor([docs, site], "https://docs.test/y#frag")?.name,
    "Docs site",
    "the site rule covers the rest",
  );
  assert.equal(tabNameFor([off], "https://off.test/"), undefined, "a switched-off rule names nothing");
  assert.equal(tabNameFor([docs], undefined), undefined);
  assert.equal(tabNameFor([docs], "chrome://newtab/"), undefined);
});

test("Tab names - setTabName (row menu): the pattern's own rule takes the name and comes back on; a new rule goes FIRST; undefined for a blank name, an empty pattern or no change", () => {
  const renamed = setTabName([site, docs], "https://docs.test/x", " Roadmap ");
  assert.equal(renamed?.[1]?.name, "Roadmap", "trimmed, same position");
  assert.equal(renamed?.[1]?.id, "a", "id kept");
  const fresh = setTabName([site], "https://docs.test/z", "Zed");
  assert.equal(fresh?.length, 2);
  assert.equal(fresh?.[0]?.pattern, "https://docs.test/z", "first: it must beat the wider site rule");
  assert.equal(fresh?.[0]?.name, "Zed");
  assert.equal(tabNameFor(fresh ?? [], "https://docs.test/z")?.name, "Zed");
  const revived = setTabName([off], "https://off.test/", "Off");
  assert.deepEqual(
    revived?.[0],
    { id: "c", pattern: "https://off.test/", name: "Off", createdAt: 1 },
    "same name, switched back on: the key goes",
  );
  assert.equal(setTabName([docs], "https://docs.test/x", "Docs"), undefined, "nothing changes");
  assert.equal(setTabName([docs], "https://docs.test/x", "   "), undefined, "a blank name is not a name");
  assert.equal(setTabName([docs], "", "Name"), undefined, "an untaggable page has no pattern");
});

test("Tab names - setTabNameEnabled adds / drops the key; setTabNameLabel renames; undefined when unknown or unchanged", () => {
  assert.equal(setTabNameEnabled([docs], "a", false)?.[0]?.disabled, true);
  assert.deepEqual(setTabNameEnabled([off], "c", true)?.[0], {
    id: "c",
    pattern: "https://off.test/",
    name: "Off",
    createdAt: 1,
  });
  assert.equal(setTabNameEnabled([docs], "a", true), undefined);
  assert.equal(setTabNameEnabled([docs], "zz", false), undefined);
  assert.equal(setTabNameLabel([docs, site], "b", " Handbook ")?.[1]?.name, "Handbook");
  assert.equal(setTabNameLabel([docs], "a", "Docs"), undefined, "same name");
  assert.equal(setTabNameLabel([docs], "a", "  "), undefined, "blank");
  assert.equal(setTabNameLabel([docs], "zz", "X"), undefined);
});

test("Tab names - setTabNamePattern re-keys one rule through the tagged-page normalizer; undefined when unknown, junk, same or taken", () => {
  const next = setTabNamePattern([docs, site], "a", " Docs.test/y ");
  assert.equal(next?.[0]?.pattern, "https://docs.test/y");
  assert.equal(next?.[0]?.name, "Docs", "name and id kept");
  assert.equal(setTabNamePattern([docs, site], "a", "docs.test"), undefined, "taken by the site rule");
  assert.equal(setTabNamePattern([docs], "a", "https://docs.test/x"), undefined, "same");
  assert.equal(setTabNamePattern([docs], "a", "not a url"), undefined, "junk");
  assert.equal(setTabNamePattern([docs], "zz", "a.test"), undefined);
});

test("Tab names - makeTabName stamps id and createdAt; restoreTabNameRemoval brings the newest removal back, a pattern listed again is skipped", () => {
  const made = makeTabName("a.test", "A");
  assert.equal(made.pattern, "a.test");
  assert.equal(made.name, "A");
  assert.ok(made.id.length > 0 && made.createdAt > 0);
  const restored = restoreTabNameRemoval(
    [docs],
    [
      { at: 1, items: [site] },
      { at: 2, items: [off, docs] },
    ],
  );
  assert.deepEqual(restored?.tabNames, [docs, off], "the newest action; docs exists again and is skipped");
  assert.deepEqual(restored?.tabNamesTrash, [{ at: 1, items: [site] }]);
  assert.equal(restoreTabNameRemoval([docs], []), undefined);
});
