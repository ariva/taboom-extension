// Which recorded pane a page's frames belong to (demo/streams.ts). The Settings page keeps its
// selected tab in the address (#tags): matched by exact address it stopped being "the Settings
// page" after the first tab switch, and the film showed a dark tile from then on.
import assert from "node:assert/strict";
import { test } from "vitest";
import { documentOf, missingStreams, streamOfUrl } from "../../demo/streams.ts";

const panes = {
  story: "http://story.test/",
  settings: "chrome-extension://abc/options/index.html",
};

test("Demo - Streams - the story and the Settings page map to their panes", () => {
  assert.equal(streamOfUrl("http://story.test/", panes), "story");
  assert.equal(streamOfUrl("chrome-extension://abc/options/index.html", panes), "settings");
});

test("Demo - Streams - the Settings page stays the Settings pane whatever tab its address names", () => {
  assert.equal(streamOfUrl("chrome-extension://abc/options/index.html#tab-names", panes), "settings");
  assert.equal(streamOfUrl("chrome-extension://abc/options/index.html#general", panes), "settings");
  assert.equal(streamOfUrl("chrome-extension://abc/options/index.html#", panes), "settings");
  assert.equal(
    streamOfUrl("moz-extension://uuid/options/index.html#tags", {
      ...panes,
      settings: "moz-extension://uuid/options/index.html",
    }),
    "settings",
  );
});

test("Demo - Streams - any other page belongs to no pane", () => {
  assert.equal(streamOfUrl("chrome-extension://abc/sidepanel/index.html", panes), undefined);
  assert.equal(streamOfUrl("chrome-extension://abc/options/index.html?x=1", panes), undefined, "another document");
  assert.equal(streamOfUrl("http://docs.example.test/options/index.html#tags", panes), undefined);
  assert.equal(streamOfUrl("http://story.test/other", panes), undefined);
  assert.equal(streamOfUrl("", panes), undefined);
});

test("Demo - Streams - a take is checked for the panes it lacks", () => {
  assert.deepEqual(missingStreams(["panel", "story", "settings"]), []);
  assert.deepEqual(missingStreams(["story", "panel"]), ["settings"], "the dark-tile case");
  assert.deepEqual(missingStreams([]), ["panel", "story", "settings"]);
});

// "is this page the active tab of its window" compares two reports of one address: the browser's
// tab list names the fragment, a page object may not have heard of it (Firefox BiDi reports
// navigations, not fragment changes) — both sides are compared as documents
test("Demo - Streams - an address is compared as its document, fragment aside", () => {
  assert.equal(
    documentOf("moz-extension://uuid/options/index.html#tab-names"),
    "moz-extension://uuid/options/index.html",
  );
  assert.equal(documentOf("moz-extension://uuid/options/index.html"), "moz-extension://uuid/options/index.html");
  assert.equal(documentOf("http://a.test/x?q=1#frag#more"), "http://a.test/x?q=1");
  assert.equal(documentOf(""), "");
});
