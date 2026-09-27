// Pure view logic for the options page - easier to test.

import type { PerfMetrics, PerfSnapshot, ProtectionRule } from "../../app/types.ts";

// one "## " section of CHANGES.md
export interface ReleaseSection {
  title: string;
  body: string;
}

export const FONT_SIZE_MIN = 0.6;
export const FONT_SIZE_MAX = 1.5;

export function clampFontSize(value: string | number): number {
  return Math.min(FONT_SIZE_MAX, Math.max(FONT_SIZE_MIN, Number(value) || 1));
}

// numeric setting inputs clamp to their floor; empty/garbage falls back to floor
export function clampedNumber(value: string | number, floor: number): number {
  return Math.max(floor, Number(value) || floor);
}

export function hasRule(rules: Pick<ProtectionRule, "pattern">[], pattern: string): boolean {
  return rules.some((rule) => rule.pattern === pattern);
}

export function aboutText(version: string): string {
  return `Taboom ${version}`;
}

// snapshots [{at, metrics}] → text blocks, newest first, timestamp header per block
export function snapshotBlocks(snapshots: PerfSnapshot[]): string[] {
  return [...snapshots]
    .reverse()
    .map((snapshot) =>
      [new Date(snapshot.at).toLocaleString(), ...perfLines(snapshot.metrics).map((line) => `  ${line}`)].join("\n"),
    );
}

// perf metrics ({key: {count, avg, min, max, last}}) → readable lines
export function perfLines(metrics: PerfMetrics): string[] {
  return Object.entries(metrics).map(
    ([key, m]) =>
      `${key}: count ${m.count} · avg ${m.avg.toFixed(1)}ms · ` +
      `min ${m.min.toFixed(1)} · max ${m.max.toFixed(1)} · last ${m.last.toFixed(1)}`,
  );
}

// "What's new" shows this many releases up front; a Show-more button then
// reveals SHOW_MORE_PAGE per click until everything is visible.
export const SHOW_INITIAL_CHANGES = 5;
export const SHOW_MORE_PAGE = 5;

// Newest `count` release sections of CHANGES.md as [{ title, body }], newest
// first — all of them by default.
export function releaseSections(markdown: string, count = Infinity): ReleaseSection[] {
  return markdown
    .split(/^## /m)
    .slice(1, count + 1)
    .map((section) => {
      const [title, ...body] = section.split("\n");
      // title!: split() always yields at least one element
      return { title: title!.trim(), body: body.join("\n").trim() };
    });
}

// Section of CHANGES.md for `version`, falling back to the newest section.
// Returns { title, body } or null when the markdown has no "## " sections.
export function releaseNotes(markdown: string, version: string): ReleaseSection | null {
  const sections = markdown.split(/^## /m).slice(1);
  if (sections.length === 0) {
    return null;
  }
  const match = sections.find((s) => s.startsWith(`v${version} `) || s.startsWith(`v${version}\n`));
  // sections[0]!: non-empty, checked above; title!: split() always yields at least one element
  const [title, ...body] = (match ?? sections[0]!).split("\n");
  return { title: title!.trim(), body: body.join("\n").trim() };
}
