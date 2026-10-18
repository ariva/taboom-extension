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
  setPageTags,
  setTagEnabled,
  splitTagQuery,
  TAG_COLORS,
  TAG_NAME_MAX,
  tagColorHex,
  tagMatches,
  tagNameError,
  tagPageKey,
  tagPageUrlFromInput,
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

test("Tags - page keys: fragment dropped like keep-alive, typed addresses normalized, junk is empty", () => {
  assert.equal(tagPageKey("https://a.test/x#frag"), "https://a.test/x");
  assert.equal(tagPageKey("chrome://extensions"), "");
  assert.equal(tagPageUrlFromInput(" a.test/x#frag "), "https://a.test/x");
  assert.equal(tagPageUrlFromInput("not a url"), "");
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
