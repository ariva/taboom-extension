import assert from "node:assert/strict";
import { test } from "vitest";
import {
  matchesTagPage,
  siteOf,
  tagPageKey,
  tagPagePatternFromInput,
  tagPagePatternHint,
  tagPatternKind,
} from "../../src/app/tag-patterns.ts";

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
  assert.equal(matchesTagPage("a.test", "https://sub.a.test/"), true, "a bare host covers its subdomains too");
  assert.equal(matchesTagPage("a.test", "https://www.a.test/x"), true);
  assert.equal(matchesTagPage("a.test", "https://nota.test/"), false, "a suffix match stops at a dot");
  assert.equal(matchesTagPage("youtube", "https://www.youtube.com/watch"), true, "a word: any host containing it");
  assert.equal(matchesTagPage("tube", "https://www.youtube.com/"), true);
  assert.equal(matchesTagPage("youtube", "https://youtu.be/x"), false);
  assert.equal(matchesTagPage("settings", "chrome://settings/"), true, "internal pages have a host too");
  assert.equal(
    matchesTagPage("youtube.com", "https://example.com/?ref-url=youtube.com"),
    false,
    "a host entry looks at the host only, never the path or query",
  );
  assert.equal(matchesTagPage("youtube", "https://example.com/youtube/youtube.com"), false);
  assert.equal(matchesTagPage("youtube.com", "https://youtube.com.evil.test/"), false, "a suffix, not a prefix");
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
  assert.match(tagPagePatternHint("a.test"), /^a\.test and its subdomains$/);
  assert.match(tagPagePatternHint("*.a.test"), /^a\.test and its subdomains$/);
  assert.match(tagPagePatternHint("youtube"), /^Hosts containing youtube$/);
  assert.match(tagPagePatternHint("https://a.test/*"), /^Pages matching/);
  assert.equal(tagPatternKind("youtube"), "pattern", "a word is a pattern, not a domain");
  assert.equal(tagPatternKind("a.test"), "domain");
});

test("Tag patterns - siteOf: the host without a leading www., what Tag domain… writes", () => {
  assert.equal(siteOf("https://www.youtube.com/watch?v=1"), "youtube.com");
  assert.equal(siteOf("https://WWW.A.test/"), "a.test");
  assert.equal(siteOf("https://www2.a.test/"), "www2.a.test");
  assert.equal(siteOf("https://www.com/"), "www.com", "nothing left to name the site: kept");
  assert.equal(siteOf("https://a.test/"), "a.test");
  assert.equal(siteOf(undefined), "");
});
