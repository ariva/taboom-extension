import assert from "node:assert/strict";
import { test } from "vitest";
import {
  createTag,
  enabledTags,
  hasTagEverywhere,
  moveTagTo,
  pageCountByTag,
  recolorTag,
  removeTagPages,
  removeTags,
  renameTag,
  restoreTagRemoval,
  setPageEnabled,
  setPageTags,
  setTagEnabled,
  splitTagQuery,
  TAG_COLORS,
  TAG_NAME_MAX,
  tagColorHex,
  tagMatches,
  tagNameError,
  tabsLosingTag,
  tagOriginSets,
  tagOrigins,
  tagPageError,
  inheritedTagIds,
  nextTagSort,
  sortedTagPages,
  tagsForUrl,
  togglePageTags,
  usesDarkText,
} from "../../src/app/tags.ts";
import { recordRemoval } from "../../src/app/removal-trash.ts";
import type { Tag, TagPage } from "../../src/app/types.ts";

const work: Tag = { id: "t1", name: "Work", color: "blue" };
const bills: Tag = { id: "t2", name: "bills", color: "yellow" };
const TAGS = [work, bills];
const PAGES: TagPage[] = [
  { url: "https://a.test/x", tagIds: ["t1"] },
  { url: "https://b.test/", tagIds: ["t1", "t2"] },
];

test("Tags - colors: the nine Chrome group colors, grey fallback, dark text on yellow / orange", () => {
  assert.deepEqual(Object.keys(TAG_COLORS), [
    "grey",
    "blue",
    "red",
    "yellow",
    "green",
    "pink",
    "purple",
    "cyan",
    "orange",
  ]);
  assert.equal(tagColorHex("blue"), TAG_COLORS.blue);
  assert.equal(tagColorHex("mauve"), TAG_COLORS.grey, "unknown stored color reads grey");
  assert.equal(usesDarkText("yellow"), true);
  assert.equal(usesDarkText("orange"), true);
  assert.equal(usesDarkText("blue"), false);
});

test("Tags - name rules: trimmed, no #, max length, unique case-insensitive (own id excepted)", () => {
  assert.equal(tagNameError(TAGS, "  later  "), undefined);
  assert.match(tagNameError(TAGS, "   ") ?? "", /name/i);
  assert.match(tagNameError(TAGS, "c#") ?? "", /#/);
  assert.match(tagNameError(TAGS, "x".repeat(TAG_NAME_MAX + 1)) ?? "", /\d+/);
  assert.equal(tagNameError(TAGS, "x".repeat(TAG_NAME_MAX)), undefined);
  assert.match(tagNameError(TAGS, "WORK") ?? "", /exists/);
  assert.equal(tagNameError(TAGS, "WORK", "t1"), undefined, "renaming a tag to its own name (case) is fine");
  assert.match(tagNameError(TAGS, "work", "t2") ?? "", /exists/);
});

test("Tags - createTag appends a trimmed tag with the given id; invalid names create nothing", () => {
  const made = createTag(TAGS, "  Later ", "green", "t3");
  assert.deepEqual(made?.tag, { id: "t3", name: "Later", color: "green" });
  assert.deepEqual(
    made?.tags.map((tag) => tag.id),
    ["t1", "t2", "t3"],
  );
  assert.equal(createTag(TAGS, "work", "green", "t9"), undefined);
  assert.equal(createTag(TAGS, "x", "mauve", "t9"), undefined, "unknown color refused");
});

test("Tags - renameTag / recolorTag: undefined for no change, unknown id or an invalid name", () => {
  assert.deepEqual(renameTag(TAGS, "t2", " Bills ")?.[1], { id: "t2", name: "Bills", color: "yellow" });
  assert.equal(renameTag(TAGS, "t2", "bills"), undefined, "same name = nothing to write");
  assert.equal(renameTag(TAGS, "t2", "work"), undefined);
  assert.equal(renameTag(TAGS, "zz", "x"), undefined);
  assert.equal(recolorTag(TAGS, "t1", "red")?.[0]?.color, "red");
  assert.equal(recolorTag(TAGS, "t1", "blue"), undefined);
  assert.equal(recolorTag(TAGS, "t1", "mauve"), undefined);
});

test("Tags - tagsForUrl unions every matching entry; inheritedTagIds are the ones not on the exact page", () => {
  const pages: TagPage[] = [
    { url: "https://a.test/x", tagIds: ["t1"] },
    { url: "a.test", tagIds: ["t2"] },
    { url: "https://a.test/*", tagIds: ["t1", "t2"] },
  ];
  assert.deepEqual(
    tagsForUrl(pages, TAGS, "https://a.test/x").map((tag) => tag.id),
    ["t1", "t2"],
    "deduped, tag-list order",
  );
  assert.deepEqual(
    tagsForUrl(pages, TAGS, "https://a.test/y").map((tag) => tag.id),
    ["t1", "t2"],
  );
  assert.deepEqual(tagsForUrl(pages, TAGS, "https://b.test/"), []);
  assert.deepEqual(
    inheritedTagIds(pages, ["https://a.test/x"]),
    new Set(["t1", "t2"]),
    "t1 is on the page itself too, but the glob keeps it there whatever the page's own entry says",
  );
  assert.deepEqual(
    inheritedTagIds(pages, ["https://a.test/x", "https://b.test/"]),
    new Set(),
    "inherited on every url only",
  );
  assert.deepEqual(inheritedTagIds(pages, []), new Set());
});

test("Tags - tagsForUrl: tag-list order, vanished ids skipped, fragment ignored", () => {
  assert.deepEqual(
    tagsForUrl(PAGES, TAGS, "https://b.test/#x").map((tag) => tag.id),
    ["t1", "t2"],
  );
  assert.deepEqual(tagsForUrl([{ url: "https://c.test/", tagIds: ["gone", "t2"] }], TAGS, "https://c.test/"), [bills]);
  assert.deepEqual(tagsForUrl(PAGES, TAGS, "https://zz.test/"), []);
  assert.deepEqual(tagsForUrl(PAGES, TAGS, undefined), []);
});

test("Tags - setPageTags: adds, replaces, drops the page when empty, undefined when unchanged", () => {
  const added = setPageTags(PAGES, "https://c.test/", ["t2"]);
  assert.deepEqual(added?.[2], { url: "https://c.test/", tagIds: ["t2"] });
  assert.deepEqual(setPageTags(PAGES, "https://a.test/x", ["t2"])?.[0], { url: "https://a.test/x", tagIds: ["t2"] });
  assert.deepEqual(
    setPageTags(PAGES, "https://a.test/x", [])?.map((page) => page.url),
    ["https://b.test/"],
  );
  assert.equal(setPageTags(PAGES, "https://a.test/x", ["t1"]), undefined);
  assert.equal(setPageTags(PAGES, "https://zz.test/", []), undefined);
  assert.equal(setPageTags(PAGES, "", ["t1"]), undefined, "an unsupported page gets no tags");
});

test("Tags - togglePageTags over several urls; hasTagEverywhere drives the ✓", () => {
  const urls = ["https://a.test/x", "https://b.test/", "https://c.test/"];
  assert.equal(hasTagEverywhere(PAGES, urls, "t1"), false);
  const on = togglePageTags(PAGES, urls, "t1", true);
  assert.equal(hasTagEverywhere(on ?? [], urls, "t1"), true);
  assert.equal(togglePageTags(on ?? [], urls, "t1", true), undefined, "already everywhere");
  const off = togglePageTags(on ?? [], urls, "t1", false);
  assert.deepEqual(
    off?.map((page) => page.url),
    ["https://b.test/"],
    "pages left without tags vanish",
  );
  assert.deepEqual(off?.[0]?.tagIds, ["t2"]);
  assert.equal(togglePageTags(off ?? [], urls, "t1", false), undefined);
});

test("Tags - removeTags drops the tags and their ids from pages; the removal holds what left", () => {
  const removed = removeTags(TAGS, PAGES, ["t1"]);
  assert.deepEqual(removed?.tags, [bills]);
  assert.deepEqual(removed?.pages, [{ url: "https://b.test/", tagIds: ["t2"] }]);
  assert.deepEqual(removed?.removed, {
    tags: [work],
    pages: [
      { url: "https://a.test/x", tagIds: ["t1"] },
      { url: "https://b.test/", tagIds: ["t1"] },
    ],
  });
  assert.equal(removeTags(TAGS, PAGES, ["nope"]), undefined);
});

test("Tags - removeTagPages drops whole pages into a removal without tags", () => {
  const site = removeTagPages([...PAGES, { url: "a.test", tagIds: ["t2"] }], ["a.test"]);
  assert.deepEqual(site?.removed.pages, [{ url: "a.test", tagIds: ["t2"] }], "a site entry goes by its pattern");
  const removed = removeTagPages(PAGES, ["https://a.test/x", "https://zz.test/"]);
  assert.deepEqual(
    removed?.pages.map((page) => page.url),
    ["https://b.test/"],
  );
  assert.deepEqual(removed?.removed, { tags: [], pages: [{ url: "https://a.test/x", tagIds: ["t1"] }] });
  assert.equal(removeTagPages(PAGES, ["https://zz.test/"]), undefined);
});

test("Tags - restoreTagRemoval merges tags and page ids back, skips a name taken meanwhile", () => {
  const gone = removeTags(TAGS, PAGES, ["t1"]);
  assert.ok(gone);
  const trash = recordRemoval([], [gone.removed], 1);
  const back = restoreTagRemoval(gone.tags, gone.pages, trash);
  assert.deepEqual(back?.tags, [bills, work], "a restored tag returns at the end");
  assert.deepEqual(back?.tagPages, [
    { url: "https://b.test/", tagIds: ["t2", "t1"] },
    { url: "https://a.test/x", tagIds: ["t1"] },
  ]);
  assert.deepEqual(back?.tagTrash, []);
  // a tag named "work" made again meanwhile (new id): the old one stays gone, its ids with it
  const retagged = createTag(gone.tags, "work", "red", "t5");
  const clash = restoreTagRemoval(retagged?.tags ?? [], gone.pages, trash);
  assert.deepEqual(
    clash?.tags.map((tag) => tag.id),
    ["t2", "t5"],
  );
  assert.deepEqual(clash?.tagPages, [{ url: "https://b.test/", tagIds: ["t2"] }]);
  assert.equal(restoreTagRemoval(TAGS, PAGES, []), undefined);
});

test("Tags - pageCountByTag counts the pages carrying each tag", () => {
  assert.deepEqual(
    [...pageCountByTag(PAGES)],
    [
      ["t1", 2],
      ["t2", 1],
    ],
  );
});

test("Tags - search: #tokens split from text tokens, a lone # is noise, prefix match on the name", () => {
  assert.deepEqual(splitTagQuery("  #Wo report #  #b "), { text: ["report"], tags: ["wo", "b"] });
  assert.deepEqual(splitTagQuery(""), { text: [], tags: [] });
  assert.equal(tagMatches(work, "wo"), true);
  assert.equal(tagMatches(work, "ork"), false);
  assert.equal(tagMatches(bills, "bills"), true);
});

test("Tags - moveTagTo lands the dragged tag at the target's index: after it going down, before it going up", () => {
  const later: Tag = { id: "t3", name: "later", color: "red" };
  const list = [work, bills, later];
  assert.deepEqual(
    moveTagTo(list, "t1", "t3")?.map((tag) => tag.id),
    ["t2", "t3", "t1"],
    "dragged down: after the target",
  );
  assert.deepEqual(
    moveTagTo(list, "t3", "t1")?.map((tag) => tag.id),
    ["t3", "t1", "t2"],
    "dragged up: before the target",
  );
  assert.equal(moveTagTo(list, "t1", "t1"), undefined, "onto itself: nothing");
  assert.equal(moveTagTo(list, "t1", "zz"), undefined, "unknown target: nothing");
});

test("Tags - setTagEnabled: a disabled tag keeps its pages but leaves enabledTags; the key is absent when on", () => {
  const off = setTagEnabled(TAGS, "t1", false);
  assert.deepEqual(off?.[0], { ...work, disabled: true });
  assert.deepEqual(enabledTags(off ?? []), [bills]);
  assert.equal(setTagEnabled(off ?? [], "t1", false), undefined, "already off");
  assert.deepEqual(setTagEnabled(off ?? [], "t1", true)?.[0], work, "back on: no disabled key");
  assert.equal(setTagEnabled(TAGS, "t1", true), undefined);
  assert.equal(setTagEnabled(TAGS, "zz", false), undefined);
  assert.deepEqual(enabledTags(TAGS), TAGS);
});

test("Tags - tagPageError: junk, a key already listed (own row excepted), normalized before the check", () => {
  assert.equal(tagPageError(PAGES, "https://c.test/"), undefined);
  assert.equal(tagPageError(PAGES, "   "), "Type an address, a host or a pattern");
  assert.equal(tagPageError(PAGES, "*"), "Type an address, a host or a pattern");
  assert.equal(
    tagPageError(PAGES, "b.test/#frag"),
    '"https://b.test/" is already listed — edit that row instead',
    "the typed form normalizes onto the stored key",
  );
  assert.equal(tagPageError(PAGES, "https://b.test/", "https://b.test/"), undefined, "a row keeps its own key");
  assert.equal(tagPageError(PAGES, "https://a.test/x", "https://b.test/")?.startsWith('"https://a.test/x"'), true);
});

test("Tags - setPageEnabled: an off entry stays listed but tags nothing; the key is absent when on", () => {
  const off = setPageEnabled(PAGES, "https://b.test/", false);
  assert.deepEqual(off?.[1], { url: "https://b.test/", tagIds: ["t1", "t2"], disabled: true });
  assert.deepEqual(tagsForUrl(off ?? [], TAGS, "https://b.test/x"), [], "off: covers nothing");
  assert.deepEqual(inheritedTagIds(off ?? [], ["https://b.test/x"]), new Set(), "off: hands nothing down");
  assert.equal(setPageEnabled(off ?? [], "https://b.test/", false), undefined, "already off");
  assert.deepEqual(setPageEnabled(off ?? [], "https://b.test/", true)?.[1], PAGES[1], "back on: no disabled key");
  assert.equal(setPageEnabled(PAGES, "https://b.test/", true), undefined);
  assert.equal(setPageEnabled(PAGES, "https://zz.test/", false), undefined);
  // rewriting the entry keeps the switch: new tag ids, a tag removal, a restore
  assert.deepEqual(setPageTags(off ?? [], "https://b.test/", ["t2"])?.[1], {
    url: "https://b.test/",
    tagIds: ["t2"],
    disabled: true,
  });
  const removal = removeTags(TAGS, off ?? [], ["t1"]);
  assert.deepEqual(removal?.pages, [{ url: "https://b.test/", tagIds: ["t2"], disabled: true }], "a.test/x left whole");
  const restored = restoreTagRemoval(
    removal?.tags ?? [],
    removal?.pages ?? [],
    recordRemoval([], removal ? [removal.removed] : [], 1),
  );
  assert.deepEqual(restored?.tagPages, [
    { url: "https://b.test/", tagIds: ["t2", "t1"], disabled: true },
    { url: "https://a.test/x", tagIds: ["t1"] },
  ]);
});

test("Tags - tagOrigins: where a tab's tag comes from — its own page entry first, then a domain entry, else a pattern", () => {
  const pages: TagPage[] = [
    { url: "https://a.test/x", tagIds: ["t1"] },
    { url: "a.test", tagIds: ["t1", "t2"] },
    { url: "*.a.test", tagIds: ["t3"] },
    { url: "https://a.test/", tagIds: ["t4"] },
    { url: "https://a.test/*", tagIds: ["t2", "t5"] },
    { url: "https://a.test/y", tagIds: ["t6"], disabled: true },
  ];
  assert.deepEqual(
    tagOrigins(pages, "https://a.test/x#frag"),
    new Map([
      ["t1", "page"],
      ["t2", "domain"],
      ["t3", "domain"],
      ["t4", "pattern"],
      ["t5", "pattern"],
    ]),
    "a prefix entry is a pattern; the host and *.host are the domain",
  );
  assert.deepEqual(
    tagOrigins(pages, "https://a.test/y"),
    new Map([
      ["t1", "domain"],
      ["t2", "domain"],
      ["t3", "domain"],
      ["t4", "pattern"],
      ["t5", "pattern"],
    ]),
    "an off entry gives nothing",
  );
  assert.deepEqual(
    tagOriginSets(pages, "https://a.test/x"),
    new Map([
      ["t1", new Set(["page", "domain"])],
      ["t2", new Set(["domain", "pattern"])],
      ["t3", new Set(["domain"])],
      ["t4", new Set(["pattern"])],
      ["t5", new Set(["pattern"])],
    ]),
    "every entry kind behind a tag — the glyph after a name in the picker",
  );
  assert.deepEqual(tagOrigins(pages, "https://b.test/"), new Map());
  assert.deepEqual(tagOrigins(pages, undefined), new Map());
});

test("Tags - tabsLosingTag: the open tabs that carry the tag now and would not once it is unticked on these entries", () => {
  const pages: TagPage[] = [
    { url: "a.test", tagIds: ["t1"] },
    { url: "https://a.test/x", tagIds: ["t1", "t2"] },
    { url: "https://b.test/", tagIds: ["t1"], disabled: true },
  ];
  const tabs = [
    { id: 1, url: "https://a.test/x", title: "x" },
    { id: 2, url: "https://a.test/y", title: "y" },
    { id: 3, url: "https://b.test/", title: "b" },
    { id: 4, url: "https://c.test/", title: "c" },
  ];
  assert.deepEqual(
    tabsLosingTag(pages, ["a.test"], "t1", tabs).map((tab) => tab.id),
    [2],
    "the page entry keeps t1 on x; y had it from the domain alone",
  );
  assert.deepEqual(tabsLosingTag(pages, ["https://a.test/x"], "t1", tabs), [], "the domain still covers x");
  assert.deepEqual(
    tabsLosingTag(pages, ["https://a.test/x"], "t2", tabs).map((tab) => tab.id),
    [1],
  );
  assert.deepEqual(
    tabsLosingTag(pages, ["a.test", "https://a.test/x"], "t1", tabs).map((tab) => tab.id),
    [1, 2],
    "both entries unticked: every a.test tab",
  );
  assert.deepEqual(tabsLosingTag(pages, ["https://b.test/"], "t1", tabs), [], "an off entry tags nothing to lose");
  assert.deepEqual(tabsLosingTag(pages, ["https://zz.test/"], "t1", tabs), [], "no such entry: nothing changes");
});

test("Tags - sortedTagPages: stored order, by address (A–Z), by open-tab count or by first tag; nextTagSort takes page keys too", () => {
  const pages: TagPage[] = [
    { url: "https://b.test/", tagIds: ["t1"] },
    { url: "*.a.test", tagIds: ["t2"] },
    { url: "https://a.test/x", tagIds: ["t1"] },
  ];
  const counts = new Map([
    ["https://b.test/", 2],
    ["https://a.test/x", 1],
  ]);
  const urls = (sort: Parameters<typeof sortedTagPages>[2]) =>
    sortedTagPages(pages, counts, sort, TAGS).map((page) => page.url);
  assert.deepEqual(urls(null), ["https://b.test/", "*.a.test", "https://a.test/x"], "no sort: as stored");
  assert.deepEqual(urls({ key: "url", dir: "asc" }), ["*.a.test", "https://a.test/x", "https://b.test/"]);
  assert.deepEqual(urls({ key: "url", dir: "desc" }), ["https://b.test/", "https://a.test/x", "*.a.test"]);
  assert.deepEqual(
    urls({ key: "tabs", dir: "asc" }),
    ["*.a.test", "https://a.test/x", "https://b.test/"],
    "a missing count is 0",
  );
  assert.deepEqual(urls({ key: "tabs", dir: "desc" }), ["https://b.test/", "https://a.test/x", "*.a.test"]);
  // by tags: the first tag as the chips show it (tag-list order), case-insensitive; no tag sorts first
  const tagged: TagPage[] = [
    { url: "https://w.test/", tagIds: ["t1"] },
    { url: "https://none.test/", tagIds: ["gone"] },
    { url: "https://b.test/", tagIds: ["t2", "t1"] },
  ];
  assert.deepEqual(
    sortedTagPages(tagged, counts, { key: "tags", dir: "asc" }, TAGS).map((page) => page.url),
    ["https://none.test/", "https://w.test/", "https://b.test/"],
    "b.test's first tag in tag-list order is Work too — equal keys keep the stored order",
  );
  assert.deepEqual(
    sortedTagPages(
      [...tagged, { url: "https://c.test/", tagIds: ["t2"] }],
      counts,
      { key: "tags", dir: "desc" },
      TAGS,
    ).map((page) => page.url),
    ["https://w.test/", "https://b.test/", "https://c.test/", "https://none.test/"],
  );
  assert.deepEqual(nextTagSort(null, "tabs"), { key: "tabs", dir: "asc" });
  assert.equal(nextTagSort({ key: "tabs", dir: "desc" }, "tabs"), null);
});
