import assert from "node:assert/strict";
import { test } from "vitest";
import { hostsOf } from "../../../../src/pages/sidepanel/model/tab-hosts.ts";

const tabs = [
  { id: 1, url: "https://Example.com/a" },
  { id: 2, url: "https://example.com/b" },
  { id: 3, url: "https://docs.example.org/" },
  { id: 4, url: "not a url" },
  { id: 5 },
];

test("UI - Sidepanel - Tab hosts - Unique hostnames in tab-id order", () => {
  assert.deepEqual(hostsOf(tabs, [3, 1, 2]), ["docs.example.org", "example.com"]);
});

test("UI - Sidepanel - Tab hosts - Unknown ids and tabs without a usable URL are dropped", () => {
  assert.deepEqual(hostsOf(tabs, [99, 4, 5, 1]), ["example.com"]);
  assert.deepEqual(hostsOf(tabs, []), []);
});
