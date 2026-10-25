import assert from "node:assert/strict";
import { test } from "vitest";
import { matchesTagPage, tagPageKey, tagPagePatternFromInput, tagPagePatternHint } from "../../src/app/tag-patterns.ts";

test("Tag patterns - page keys: fragment dropped, internal pages allowed, New Tab and junk are empty, typed addresses normalized", () => {
  assert.equal(tagPageKey("https://a.test/x#frag"), "https://a.test/x");
  assert.equal(
    tagPageKey("chrome://extensions/"),
    "chrome://extensions/",
    "a label needs no reload: internal pages count",
  );
  assert.equal(
    tagPageKey("chrome-extension://abc/src/pages/options/index.html"),
    "chrome-extension://abc/src/pages/options/index.html",
  );
  assert.equal(tagPageKey("chrome://newtab/"), "", "every new tab shares it");
  assert.equal(tagPageKey("chrome://new-tab-page/"), "");
  assert.equal(tagPageKey("about:blank"), "");
  assert.equal(tagPageKey(undefined), "");
  assert.equal(tagPageKey("garbage"), "", "no scheme, no page");
  assert.equal(tagPagePatternFromInput(" a.test/x#frag "), "https://a.test/x");
  assert.equal(tagPagePatternFromInput("chrome://settings/"), "chrome://settings/", "an internal address as typed");
  assert.equal(tagPagePatternFromInput("not a url"), "", "spaces: URL() refuses it");
  assert.equal(tagPagePatternFromInput("   "), "");
});

test("Tag patterns - patterns from input: a bare host is a site, *.host its subdomains too, * in an address is a glob", () => {
  assert.equal(tagPagePatternFromInput(" GitHub.com "), "github.com");
  assert.equal(tagPagePatternFromInput("*.GitHub.com"), "*.github.com");
  assert.equal(
    tagPagePatternFromInput("HTTPS://GitHub.com/Ariva/*/test"),
    "https://github.com/Ariva/*/test",
    "host lowered, path kept",
  );
  assert.equal(
    tagPagePatternFromInput("github.com/ariva/*"),
    "https://github.com/ariva/*",
    "a scheme-less path gets https",
  );
  assert.equal(
    tagPagePatternFromInput("https://a.test/x*#frag"),
    "https://a.test/x*",
    "the fragment goes like for a page",
  );
  assert.equal(tagPagePatternFromInput("*"), "", "a glob over everything tags every page: refused");
  assert.equal(tagPagePatternFromInput("has space.com"), "", "not a host");
});

test("Tag patterns - matchesTagPage: exact page, site, subdomains, globs anywhere; the New Tab page never", () => {
  assert.equal(matchesTagPage("https://a.test/x", "https://a.test/x#frag"), true);
  assert.equal(matchesTagPage("https://a.test/x", "https://a.test/x/y"), false, "exact is exact");
  assert.equal(
    matchesTagPage("https://a.test/", "https://a.test/x/y?q=1"),
    true,
    "a trailing / covers everything under it",
  );
  assert.equal(matchesTagPage("https://a.test/docs/", "https://a.test/docs/intro"), true);
  assert.equal(
    matchesTagPage("https://a.test/docs/", "https://a.test/docs"),
    false,
    "the parent itself is not under it",
  );
  assert.equal(matchesTagPage("https://a.test/", "https://a.test.evil/"), false);
  assert.equal(matchesTagPage("a.test", "https://a.test/any/path?q=1"), true, "a site covers every page");
  assert.equal(matchesTagPage("a.test", "https://sub.a.test/"), false, "a bare host is not its subdomains");
  assert.equal(matchesTagPage("*.a.test", "https://sub.a.test/"), true);
  assert.equal(matchesTagPage("*.a.test", "https://a.test/"), true, "*.host covers the host itself, like protection");
  assert.equal(matchesTagPage("*.a.test", "https://nota.test/"), false);
  assert.equal(matchesTagPage("git*.com", "https://github.com/"), true, "a glob host");
  const glob = "https://github.com/ariva/*/test/*/tst2/*";
  assert.equal(matchesTagPage(glob, "https://github.com/ariva/x/test/y/z/tst2/w"), true);
  assert.equal(matchesTagPage(glob, "https://github.com/ariva/x/test/y/tst2/"), true, "* may be empty");
  assert.equal(matchesTagPage(glob, "https://github.com/ariva/x/test/y"), false);
  assert.equal(matchesTagPage("https://a.test/*", "https://a.test/x?q=a/b#f"), true, "* crosses / and ?");
  assert.equal(matchesTagPage("https://a.test/x.*", "https://a.test/xyz"), false, "regex characters are literal");
  assert.equal(matchesTagPage("*.test", "chrome://newtab/"), false);
  assert.equal(matchesTagPage("chrome://*", "chrome://newtab/"), false, "the New Tab page carries no tag");
  assert.equal(matchesTagPage("", "https://a.test/"), false);
  assert.equal(matchesTagPage("a.test", undefined), false);
});

test("Tag patterns - pattern hints name the kind", () => {
  assert.match(tagPagePatternHint("https://a.test/x"), /^Exact page/);
  assert.match(tagPagePatternHint("https://a.test/docs/"), /^Every page under/);
  assert.match(tagPagePatternHint("a.test"), /^Every page on a\.test$/);
  assert.match(tagPagePatternHint("*.a.test"), /subdomains/);
  assert.match(tagPagePatternHint("https://a.test/*"), /^Pages matching/);
});
