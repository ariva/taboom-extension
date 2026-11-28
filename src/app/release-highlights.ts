// The extension's features in a few words each, in two lists the demo film and Settings share.
// RELEASE_HIGHLIGHTS — the new features of each release: what Settings → Changes lists on top
// for the releases VISIBLE_HIGHLIGHTS_RELEASES names, and what the film ticks off under "New in <version>" (a scene names
// its line by key — demo/scenes — so the two can never word a feature differently).
// EVERYTHING_ELSE — the older features, the film's second group (further down).
// Newest release first. A release with nothing new for the user (fixes only) has no entry (or
// an empty one), and neither have the releases before 1.1.0, where this list starts.
// A new release ADDS its entry on top; earlier entries stay as they are. Only the latest is
// shown today, but the history is kept on purpose (an older release's list may be shown later),
// and the demo scenes of those releases still name their lines here.

export interface ReleaseHighlight {
  key: string; // a slug, unique within the release: how a demo scene refers to the line
  text: string;
}

// Settings → Changes, the card on top:
// true - the lines of every visible release in one group, under the one heading "Highlights"
// false - a group per release, each under its own heading ("New in v…")
export const GROUP_HIGHLIGHTS: boolean = false;

// the releases that have lines to show in Settings → Changes
export const VISIBLE_HIGHLIGHTS_RELEASES: readonly string[] = ["1.1.1", "1.1.0"];

export const RELEASE_HIGHLIGHTS: Readonly<Record<string, readonly ReleaseHighlight[]>> = {
  "1.1.1": [
    { key: "keyboard-select", text: "Select and filter from the keyboard" },
    { key: "duplicate-tab", text: "Duplicate tab" },
    { key: "tab-audio", text: "Mute tabs, find the ones with sound" },
  ],
  "1.1.0": [
    { key: "tab-names", text: "Custom Tab Names" },
    { key: "temporary-protection", text: "Temporary protection or keep-alive" },
    { key: "keep-alive-domain", text: "Keep alive by domain" },
    { key: "settings-reorder", text: "Reorder lists in Settings" },
    { key: "tag-fragment", text: "Tagged pages keep their #fragment" },
    { key: "keyboard-menu", text: "Row menus from the keyboard" },
    { key: "settings-tabs", text: "Settings in tabs" },
  ],
};

// Everything else: the features from before the newest release, a few words each, in the order
// the demo film shows them — its "Everything else" group (demo/scenes name their line by key).
// Not shown in Settings today. When a release with features of its own follows, the previous
// one's lines are FOLDED in here — fewer, broader lines, or an existing line its scenes join
// (1.1.0's seven became three new lines plus "Settings" and "Custom tags") — and stay in
// RELEASE_HIGHLIGHTS as they were: one is the history per release, the other the running list
// of what the extension does. A line filmed in several scenes sits where its first scene plays.
export const EVERYTHING_ELSE: readonly ReleaseHighlight[] = [
  { key: "tab-names", text: "Custom Tab Names" },
  { key: "temporary-domain", text: "Temporary and per-domain rules" },
  { key: "settings", text: "Settings" },
  { key: "tags", text: "Custom tags" },
  { key: "keyboard-menu", text: "Row menus from the keyboard" },
  { key: "shared-view", text: "Open panels share one view" },
  { key: "snooze-now", text: "Snooze inactive tabs now" },
  { key: "parked", text: "Park a window, restore it later" },
  { key: "tour", text: "Every window, every tab, one panel" },
  { key: "search-filters", text: "Search and filters" },
  { key: "windows", text: "Windows: names, colors, pins" },
  { key: "sort-group-move", text: "Sort, group, move tabs" },
  { key: "snooze-protect", text: "Snooze, protect, bulk actions" },
  { key: "duplicates", text: "Duplicates" },
];

// The release the film presents as new: the recorded one when it has lines of its own, else
// the newest that has (a fixes-only release keeps showing the last features as "New in …").
export function featureRelease(version: string): string {
  const withLines = (release: string): boolean => (RELEASE_HIGHLIGHTS[release]?.length ?? 0) > 0;
  return withLines(version) ? version : (Object.keys(RELEASE_HIGHLIGHTS).find(withLines) ?? version);
}

// the lines of one release, in their written order; none for a release without an entry
export function releaseHighlights(version: string): string[] {
  return (RELEASE_HIGHLIGHTS[version] ?? []).map((line) => line.text);
}

// what Settings → Changes lists: the named releases in the given order, each with its lines; a
// release with nothing to list is left out
export function visibleHighlights(
  releases: readonly string[] = VISIBLE_HIGHLIGHTS_RELEASES,
): { version: string; lines: string[] }[] {
  return releases
    .map((version) => ({ version, lines: releaseHighlights(version) }))
    .filter((release) => release.lines.length > 0);
}

// one line by its key. Throws on a miss: a caller naming a line that is not there (a demo
// scene after a rename) must fail loudly, not show an empty line
export function highlightText(version: string, key: string): string {
  const line = RELEASE_HIGHLIGHTS[version]?.find((candidate) => candidate.key === key);
  if (!line) {
    throw new Error(`release ${version} has no highlight "${key}"`);
  }
  return line.text;
}

// the everything-else lines, in their written order
export function everythingElse(): string[] {
  return EVERYTHING_ELSE.map((line) => line.text);
}

// one everything-else line by its key; throws on a miss, like highlightText
export function everythingElseText(key: string): string {
  const line = EVERYTHING_ELSE.find((candidate) => candidate.key === key);
  if (!line) {
    throw new Error(`everything else has no line "${key}"`);
  }
  return line.text;
}
