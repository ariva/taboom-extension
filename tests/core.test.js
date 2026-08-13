import assert from "node:assert/strict";
import { test } from "node:test";
import {
  formatAge,
  hostnameOf,
  isEligibleForAutoSnooze,
  isProtected,
  isSupportedUrl,
  makeRule,
  matchesRule,
  matchesSearch,
  selectAutoSnoozeTargets,
} from "../core/core.js";

const NOW = 1_700_000_000_000;
const HOUR = 60 * 60 * 1000;
const settings = {
  autoSnoozeEnabled: true,
  inactivityMinutes: 60,
  checkIntervalMinutes: 5,
  excludePinned: true,
  excludeAudible: true,
};

function tab(overrides = {}) {
  return {
    id: 1,
    active: false,
    discarded: false,
    pinned: false,
    audible: false,
    url: "https://example.com/page",
    title: "Example Page",
    lastAccessed: NOW - 2 * HOUR,
    ...overrides,
  };
}

test("eligibility", () => {
  assert.equal(isEligibleForAutoSnooze(tab(), settings, [], NOW), true);
  assert.equal(isEligibleForAutoSnooze(tab({ active: true }), settings, [], NOW), false);
  assert.equal(isEligibleForAutoSnooze(tab({ discarded: true }), settings, [], NOW), false);
  assert.equal(isEligibleForAutoSnooze(tab({ pinned: true }), settings, [], NOW), false);
  assert.equal(isEligibleForAutoSnooze(tab({ audible: true }), settings, [], NOW), false);
  assert.equal(isEligibleForAutoSnooze(tab({ id: undefined }), settings, [], NOW), false);
  assert.equal(
    isEligibleForAutoSnooze(tab({ lastAccessed: NOW - 30 * 60_000 }), settings, [], NOW),
    false,
    "recently accessed excluded",
  );
  assert.equal(
    isEligibleForAutoSnooze(tab({ url: "chrome://settings" }), settings, [], NOW),
    false,
    "unsupported scheme excluded",
  );
  assert.equal(
    isEligibleForAutoSnooze(tab({ url: undefined }), settings, [], NOW),
    false,
    "missing url handled",
  );
  const rules = [makeRule("example.com")];
  assert.equal(isEligibleForAutoSnooze(tab(), settings, rules, NOW), false, "protected excluded");
  const relaxed = { ...settings, excludePinned: false, excludeAudible: false };
  assert.equal(isEligibleForAutoSnooze(tab({ pinned: true, audible: true }), relaxed, [], NOW), true);
});

test("selectAutoSnoozeTargets respects minAwakePerWindow", () => {
  // window 1: active tab + 3 old eligible tabs = 4 awake
  const tabs = [
    tab({ id: 1, windowId: 1, active: true, lastAccessed: NOW }),
    tab({ id: 2, windowId: 1, lastAccessed: NOW - 5 * HOUR }),
    tab({ id: 3, windowId: 1, lastAccessed: NOW - 3 * HOUR }),
    tab({ id: 4, windowId: 1, lastAccessed: NOW - 2 * HOUR }),
    tab({ id: 5, windowId: 2, lastAccessed: NOW - 2 * HOUR }),
    tab({ id: 6, windowId: 2, discarded: true }),
  ];

  const noLimit = { ...settings, minAwakePerWindow: 0 };
  assert.deepEqual(selectAutoSnoozeTargets(tabs, noLimit, [], NOW).sort(), [2, 3, 4, 5]);

  const keep2 = { ...settings, minAwakePerWindow: 2 };
  // window 1 discards oldest until 2 awake remain (ids 2,3); window 2 has
  // only 1 awake tab → nothing discarded there
  assert.deepEqual(selectAutoSnoozeTargets(tabs, keep2, [], NOW), [2, 3]);

  const keep9 = { ...settings, minAwakePerWindow: 9 };
  assert.deepEqual(selectAutoSnoozeTargets(tabs, keep9, [], NOW), []);
});

test("protection rules", () => {
  const host = { id: "1", type: "host", pattern: "mail.google.com" };
  assert.equal(matchesRule("mail.google.com", host), true);
  assert.equal(matchesRule("google.com", host), false);
  assert.equal(matchesRule("evilmail.google.com.attacker.io", host), false);

  const domain = { id: "2", type: "domain", pattern: "*.github.com" };
  assert.equal(matchesRule("github.com", domain), true);
  assert.equal(matchesRule("gist.github.com", domain), true);
  assert.equal(matchesRule("notgithub.com", domain), false);

  assert.equal(isProtected("https://MAIL.GOOGLE.COM/inbox", [host]), true, "case normalized");
  assert.equal(isProtected("https://mail.google.com./inbox", [host]), true, "trailing dot");
  assert.equal(isProtected("http://localhost:3000/", [{ id: "3", type: "host", pattern: "localhost" }]), true, "port ignored");
  assert.equal(isProtected("not a url", [host]), false);
});

test("search", () => {
  const t = tab({ title: "Rust Async Book", url: "https://rust-lang.github.io/async-book/" });
  assert.equal(matchesSearch(t, "rust"), true, "title substring");
  assert.equal(matchesSearch(t, "async-book"), true, "url substring");
  assert.equal(matchesSearch(t, "github.io"), true, "hostname");
  assert.equal(matchesSearch(t, "github rust"), true, "multiple tokens");
  assert.equal(matchesSearch(t, "RUST"), true, "case-insensitive");
  assert.equal(matchesSearch(t, ""), true, "empty query matches all");
  assert.equal(matchesSearch(t, "python"), false);
});

test("url helpers", () => {
  assert.equal(isSupportedUrl("https://a.com"), true);
  assert.equal(isSupportedUrl("http://a.com"), true);
  assert.equal(isSupportedUrl("file:///tmp/x.html"), true);
  assert.equal(isSupportedUrl("chrome://extensions"), false);
  assert.equal(isSupportedUrl("chrome-extension://abc/x.html"), false);
  assert.equal(isSupportedUrl(undefined), false);
  assert.equal(hostnameOf("https://Sub.Example.COM/x"), "sub.example.com");
  assert.equal(hostnameOf("garbage"), "");
});

test("formatAge", () => {
  assert.equal(formatAge(30_000), "now");
  assert.equal(formatAge(4 * 60_000), "4m");
  assert.equal(formatAge(2 * HOUR + 14 * 60_000), "2h 14m");
  assert.equal(formatAge(3 * 24 * HOUR), "3d");
});

test("makeRule", () => {
  assert.equal(makeRule("  "), null);
  assert.equal(makeRule("*.GitHub.com").type, "domain");
  assert.equal(makeRule("mail.google.com").type, "host");
  assert.equal(makeRule("Mail.Google.Com").pattern, "mail.google.com");
});

test("ui defaults", async () => {
  const { DEFAULTS } = await import("../core/core.js");
  assert.equal(DEFAULTS.ui.fontSize, 1);
  assert.equal(DEFAULTS.ui.density, "comfortable");
});
