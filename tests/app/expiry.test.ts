import assert from "node:assert/strict";
import { test } from "vitest";
import {
  EXPIRY_CHOICES,
  expiryAt,
  expiryChoiceFor,
  formatTimeLeft,
  hasExpiring,
  isExpired,
  unexpired,
  withExpiry,
} from "../../src/app/expiry.ts";
import type { Expiring } from "../../src/app/expiry.ts";

const NOW = 1_700_000_000_000;
const HOUR = 3_600_000;
type Entry = Expiring & { id: string };

test("Expiry - the seven choices of the menus and the Settings dropdowns, in hours", () => {
  assert.deepEqual(
    EXPIRY_CHOICES.map((choice) => [choice.hours, choice.label]),
    [
      [1, "1 hour"],
      [2, "2 hours"],
      [3, "3 hours"],
      [6, "6 hours"],
      [12, "12 hours"],
      [24, "1 day"],
      [168, "1 week"],
    ],
  );
  assert.equal(expiryAt(6, NOW), NOW + 6 * HOUR);
});

test("Expiry - isExpired / unexpired: a permanent entry never expires; the same array back when nothing expired", () => {
  const permanent: Entry = { id: "p" };
  const fresh: Entry = { id: "f", expiresAt: NOW + HOUR };
  const gone: Entry = { id: "g", expiresAt: NOW - 1 };
  assert.equal(isExpired(permanent, NOW), false);
  assert.equal(isExpired(fresh, NOW), false);
  assert.equal(isExpired(gone, NOW), true);
  const edge: Entry = { id: "edge", expiresAt: NOW };
  assert.equal(isExpired(edge, NOW), true, "due now = expired");
  const list: Entry[] = [permanent, fresh, gone];
  assert.deepEqual(unexpired(list, NOW), [permanent, fresh]);
  const nothing: Entry[] = [permanent, fresh];
  assert.equal(unexpired(nothing, NOW), nothing, "nothing expired: the same array (no needless write)");
  assert.equal(hasExpiring(list), true);
  assert.equal(hasExpiring([permanent]), false, "no alarm needed");
});

test("Expiry - withExpiry sets the key from a duration and removes it for Always (absent, not undefined)", () => {
  const entry: Entry = { id: "x", expiresAt: NOW };
  assert.deepEqual(withExpiry(entry, 24, NOW), { id: "x", expiresAt: NOW + 24 * HOUR });
  assert.deepEqual(withExpiry(entry, null, NOW), { id: "x" });
  assert.ok(!("expiresAt" in withExpiry(entry, null, NOW)));
});

test("Expiry - formatTimeLeft: days and hours, hours and minutes, minutes, then 'now'", () => {
  assert.equal(formatTimeLeft(NOW + 2 * 24 * HOUR + 3 * HOUR + 59 * 60_000, NOW), "2d 3h");
  assert.equal(formatTimeLeft(NOW + 5 * HOUR + 40 * 60_000 + 30_000, NOW), "5h 40m");
  assert.equal(formatTimeLeft(NOW + 12 * 60_000 + 1000, NOW), "12m");
  assert.equal(formatTimeLeft(NOW + 59_000, NOW), "<1m");
  assert.equal(formatTimeLeft(NOW, NOW), "now");
  assert.equal(formatTimeLeft(NOW - 5000, NOW), "now");
});

test("Expiry - expiryChoiceFor: the Settings dropdown shows the smallest choice that still covers the time left (the pick the user made, as a rule)", () => {
  assert.equal(expiryChoiceFor(NOW + 5 * HOUR + 29 * 60_000, NOW), 6);
  assert.equal(expiryChoiceFor(NOW + 6 * HOUR, NOW), 6, "exactly on a choice");
  assert.equal(expiryChoiceFor(NOW + 30 * 60_000, NOW), 1);
  assert.equal(expiryChoiceFor(NOW + 2 * 24 * HOUR, NOW), 168, "above 1 day: the week");
  assert.equal(expiryChoiceFor(NOW + 30 * 24 * HOUR, NOW), 168, "beyond the longest choice: the longest");
  assert.equal(expiryChoiceFor(NOW - 1, NOW), 1, "already over: the shortest");
});
