// Temporary protection rules and keep-alive marks (T-0157): an entry with `expiresAt` stops
// counting at that time and the worker's expiry sweep drops it. Pure — no DOM, no chrome.*.

// the durations the row menu's submenus and the Settings "Expires" dropdowns offer
export const EXPIRY_CHOICES: readonly { hours: number; label: string }[] = [
  { hours: 1, label: "1 hour" },
  { hours: 2, label: "2 hours" },
  { hours: 3, label: "3 hours" },
  { hours: 6, label: "6 hours" },
  { hours: 12, label: "12 hours" },
  { hours: 24, label: "1 day" },
  { hours: 168, label: "1 week" },
];

const HOUR_MS = 3_600_000;

export function expiryAt(hours: number, now: number): number {
  return now + hours * HOUR_MS;
}

export interface Expiring {
  expiresAt?: number; // ms timestamp; absent = permanent
}

export function isExpired(entry: Expiring, now: number): boolean {
  return entry.expiresAt !== undefined && entry.expiresAt <= now;
}

// the entries still in force — the same array when nothing expired, so a writer skips the write
export function unexpired<T extends Expiring>(list: T[], now: number): T[] {
  return list.some((entry) => isExpired(entry, now)) ? list.filter((entry) => !isExpired(entry, now)) : list;
}

// whether the expiry sweep alarm has anything to wait for
export function hasExpiring(list: Expiring[]): boolean {
  return list.some((entry) => entry.expiresAt !== undefined);
}

// the entry with a new expiry from a duration, or permanent again (the key removed, not undefined-valued)
export function withExpiry<T extends Expiring>(entry: T, hours: number | null, now: number): T {
  const { expiresAt: _previous, ...permanent } = entry;
  // `as T`: a rest-spread of T minus an optional key is still a T to the caller, not to the checker
  return hours === null ? (permanent as T) : ({ ...permanent, expiresAt: expiryAt(hours, now) } as T);
}

// the Settings dropdown's value for a temporary entry: the smallest choice that still covers the
// time left — as a rule the duration the user picked (5h 29m left reads as "6 hours"); the longest
// choice beyond it, the shortest once it is over
export function expiryChoiceFor(expiresAt: number, now: number): number {
  const left = expiresAt - now;
  const covering = EXPIRY_CHOICES.find((choice) => choice.hours * HOUR_MS >= left);
  return (covering ?? EXPIRY_CHOICES[EXPIRY_CHOICES.length - 1])?.hours ?? 1;
}

// when a set of covering entries stops as a whole: the latest expiry — undefined when the set is
// empty or any of them is permanent (then the cover is permanent: no "temporary" badge)
export function temporaryUntil(entries: Expiring[]): number | undefined {
  if (entries.length === 0 || entries.some((entry) => entry.expiresAt === undefined)) {
    return undefined;
  }
  return Math.max(...entries.map((entry) => entry.expiresAt ?? 0));
}

// "2d 3h", "5h 40m", "12m", "<1m", "now" — the Settings Time left column and the hover tip
export function formatTimeLeft(expiresAt: number, now: number): string {
  const left = expiresAt - now;
  if (left <= 0) {
    return "now";
  }
  const minutes = Math.floor(left / 60_000);
  if (minutes < 1) {
    return "<1m";
  }
  const hours = Math.floor(minutes / 60);
  if (hours < 1) {
    return `${minutes}m`;
  }
  const days = Math.floor(hours / 24);
  if (days < 1) {
    return `${hours}h ${minutes % 60}m`;
  }
  return `${days}d ${hours % 24}h`;
}
